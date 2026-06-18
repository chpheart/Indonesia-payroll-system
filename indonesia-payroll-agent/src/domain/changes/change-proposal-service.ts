import { randomUUID } from "node:crypto";
import { type AuditService } from "@/domain/audit/audit-service";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  assertProposalCanBeApproved,
  type ChangeProposalSource,
  type ChangeProposalStatus,
  type ChangeProposalType,
  type ConfidenceBand,
} from "@/domain/changes/change-review-policy";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";

export type ChangeProposalRecord = {
  id: string;
  clientId: string;
  runId: string;
  rawInputItemId?: string | null;
  sourceAgentRunId?: string | null;
  createdById?: string | null;
  reviewedById?: string | null;
  targetEmployeeId?: string | null;
  source: ChangeProposalSource;
  proposalType: ChangeProposalType;
  status: ChangeProposalStatus;
  targetObjectType: string;
  targetObjectId?: string | null;
  targetField: string;
  previousValue: Record<string, unknown>;
  proposedValue: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo?: string | null;
  riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  confidence: ConfidenceBand;
  reason: string;
  differencePreview: Record<string, unknown>;
  evidenceRefs: string[];
  requiredEvidenceRefs: string[];
  relatedProposalIds: string[];
  reviewNote?: string | null;
  reviewedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ChangeProposalDraft = Omit<
  ChangeProposalRecord,
  "id" | "status" | "createdAt" | "updatedAt" | "createdById" | "reviewedById" | "reviewedAt"
>;

export type ChangeProposalStore = {
  findRunById(id: string): Promise<{
    id: string;
    clientId: string;
    payrollMonth: string;
    status: PayrollRunStatus;
    lockedAt?: Date | null;
  } | null>;
  findRawInputById(id: string): Promise<{
    id: string;
    clientId?: string | null;
    payrollMonth?: string | null;
    runId?: string | null;
    evidenceCandidateRefs: string[];
  } | null>;
  createProposal(input: ChangeProposalRecord): Promise<ChangeProposalRecord>;
  findProposalById(id: string): Promise<ChangeProposalRecord | null>;
  updateProposal(input: {
    id: string;
    status: ChangeProposalStatus;
    reviewedById?: string;
    reviewNote?: string;
    reviewedAt?: Date;
    proposedValue?: Record<string, unknown>;
    evidenceRefs?: string[];
    confidence?: ConfidenceBand;
  }): Promise<ChangeProposalRecord>;
};

const HISTORY_STATUSES = new Set<PayrollRunStatus>([
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
]);

export class ChangeProposalService {
  constructor(
    private readonly store: ChangeProposalStore,
    private readonly auditService: AuditService,
  ) {}

  async createProposal(input: {
    actor: ActorContext;
    draft: ChangeProposalDraft;
  }): Promise<ChangeProposalRecord> {
    const run = await this.requireWritableRun(input.draft.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    assertDraftMatchesRun(input.draft, run);
    await this.assertRawInputBinding(input.draft);

    if (input.draft.evidenceRefs.length === 0) {
      throw new ChangeProposalServiceError("CHANGE_PROPOSAL_EVIDENCE_REQUIRED");
    }

    const now = new Date();
    const created = await this.store.createProposal({
      ...input.draft,
      id: randomUUID(),
      status: "PENDING_REVIEW",
      createdById: input.actor.id,
      reviewedById: null,
      reviewedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CHANGE_PROPOSAL_CREATED",
      objectType: "CHANGE_PROPOSAL",
      objectId: created.id,
      riskLevel: created.riskLevel,
      clientId: created.clientId,
      runId: created.runId,
      metadata: {
        proposalType: created.proposalType,
        source: created.source,
        targetField: created.targetField,
        inputSummary: "候选变更已创建，未审核前不得写入 ChangeLedger 或正式对象版本",
      },
    });

    return created;
  }

  async rejectProposal(input: {
    actor: ActorContext;
    proposalId: string;
    status: Extract<ChangeProposalStatus, "REJECTED" | "RETURNED" | "NO_ACTION" | "CONVERTED_TO_QUESTION">;
    reviewNote: string;
  }): Promise<ChangeProposalRecord> {
    const proposal = await this.requireProposal(input.proposalId);
    const run = await this.requireWritableRun(proposal.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    if (proposal.status !== "PENDING_REVIEW") {
      throw new ChangeProposalServiceError("CHANGE_PROPOSAL_ALREADY_REVIEWED");
    }

    const updated = await this.store.updateProposal({
      id: proposal.id,
      status: input.status,
      reviewedById: input.actor.id,
      reviewedAt: new Date(),
      reviewNote: input.reviewNote.trim(),
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CHANGE_PROPOSAL_REVIEWED",
      objectType: "CHANGE_PROPOSAL",
      objectId: proposal.id,
      riskLevel: proposal.riskLevel,
      clientId: proposal.clientId,
      runId: proposal.runId,
      metadata: { status: updated.status, reviewNote: updated.reviewNote ?? "" },
    });

    return updated;
  }

  async assertApprovalAllowed(proposal: ChangeProposalRecord): Promise<void> {
    await this.requireWritableRun(proposal.runId);
    assertProposalCanBeApproved(proposal);
  }

  private async requireProposal(id: string): Promise<ChangeProposalRecord> {
    const proposal = await this.store.findProposalById(id);
    if (!proposal) {
      throw new ChangeProposalServiceError("CHANGE_PROPOSAL_NOT_FOUND");
    }
    return proposal;
  }

  private async requireWritableRun(runId: string) {
    const run = await this.store.findRunById(runId);
    if (!run) {
      throw new ChangeProposalServiceError("PAYROLL_RUN_NOT_FOUND");
    }
    if (HISTORY_STATUSES.has(run.status) || run.lockedAt) {
      throw new ChangeProposalServiceError("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    return run;
  }

  private async assertRawInputBinding(draft: ChangeProposalDraft) {
    if (!draft.rawInputItemId) {
      return;
    }
    const rawInput = await this.store.findRawInputById(draft.rawInputItemId);
    if (!rawInput) {
      throw new ChangeProposalServiceError("RAW_INPUT_NOT_FOUND");
    }
    if (rawInput.runId !== draft.runId || rawInput.clientId !== draft.clientId) {
      throw new ChangeProposalServiceError("CHANGE_PROPOSAL_RAW_INPUT_SCOPE_MISMATCH");
    }
  }
}

function assertDraftMatchesRun(
  draft: Pick<ChangeProposalDraft, "clientId">,
  run: { clientId: string; payrollMonth: string },
) {
  if (draft.clientId !== run.clientId || !run.payrollMonth) {
    throw new ChangeProposalServiceError("CHANGE_PROPOSAL_RUN_SCOPE_MISMATCH");
  }
}

export class ChangeProposalServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ChangeProposalServiceError";
  }
}
