import { randomUUID } from "node:crypto";
import { type AuditService } from "@/domain/audit/audit-service";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  assertProposalCanBeApproved,
  type ChangeProposalStatus,
  type ConfidenceBand,
} from "@/domain/changes/change-review-policy";
import {
  type ChangeProposalRecord,
  type ChangeProposalStore,
} from "@/domain/changes/change-proposal-service";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";

export type ChangeLedgerEntryRecord = {
  id: string;
  proposalId: string;
  clientId: string;
  runId: string;
  reviewedById?: string | null;
  targetEmployeeId?: string | null;
  entryType: ChangeProposalRecord["proposalType"];
  targetObjectType: string;
  targetObjectId?: string | null;
  targetField: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo?: string | null;
  riskLevel: ChangeProposalRecord["riskLevel"];
  evidenceRefs: string[];
  formalObjectType?: string | null;
  formalObjectId?: string | null;
  formalObjectVersionRef?: string | null;
  reviewNote?: string | null;
  reviewedAt: Date;
  createdAt: Date;
};

export type ChangeLedgerStore = ChangeProposalStore & {
  createLedgerEntry(input: ChangeLedgerEntryRecord): Promise<ChangeLedgerEntryRecord>;
  findLedgerEntryByProposalId(proposalId: string): Promise<ChangeLedgerEntryRecord | null>;
};

const HISTORY_STATUSES = new Set<PayrollRunStatus>([
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
]);

export class ChangeLedgerService {
  constructor(
    private readonly store: ChangeLedgerStore,
    private readonly auditService: AuditService,
  ) {}

  async approveProposal(input: {
    actor: ActorContext;
    proposalId: string;
    reviewNote: string;
    proposedValue?: Record<string, unknown>;
    evidenceRefs?: string[];
    confidence?: Exclude<ConfidenceBand, "LOW" | "CONFLICT">;
    formalObjectType?: string;
    formalObjectId?: string;
    formalObjectVersionRef?: string;
  }): Promise<{ proposal: ChangeProposalRecord; ledgerEntry: ChangeLedgerEntryRecord }> {
    const proposal = await this.requireProposal(input.proposalId);
    const run = await this.requireWritableRun(proposal.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);

    if (proposal.status !== "PENDING_REVIEW") {
      throw new ChangeLedgerServiceError("CHANGE_PROPOSAL_ALREADY_REVIEWED");
    }
    if (await this.store.findLedgerEntryByProposalId(proposal.id)) {
      throw new ChangeLedgerServiceError("CHANGE_LEDGER_ENTRY_ALREADY_EXISTS");
    }

    const effectiveProposal = {
      ...proposal,
      proposedValue: input.proposedValue ?? proposal.proposedValue,
      evidenceRefs: input.evidenceRefs ?? proposal.evidenceRefs,
      confidence: input.confidence ?? proposal.confidence,
    };
    assertProposalCanBeApproved(effectiveProposal);

    const reviewedAt = new Date();
    const nextStatus: ChangeProposalStatus =
      input.proposedValue || input.evidenceRefs || input.confidence
        ? "APPROVED_WITH_MODIFICATION"
        : "APPROVED";
    const updatedProposal = await this.store.updateProposal({
      id: proposal.id,
      status: nextStatus,
      reviewedById: input.actor.id,
      reviewedAt,
      reviewNote: input.reviewNote.trim(),
      proposedValue: effectiveProposal.proposedValue,
      evidenceRefs: effectiveProposal.evidenceRefs,
      confidence: effectiveProposal.confidence,
    });
    const ledgerEntry = await this.store.createLedgerEntry({
      id: randomUUID(),
      proposalId: proposal.id,
      clientId: proposal.clientId,
      runId: proposal.runId,
      reviewedById: input.actor.id,
      targetEmployeeId: proposal.targetEmployeeId ?? null,
      entryType: proposal.proposalType,
      targetObjectType: proposal.targetObjectType,
      targetObjectId: proposal.targetObjectId ?? null,
      targetField: proposal.targetField,
      previousValue: proposal.previousValue,
      newValue: effectiveProposal.proposedValue,
      effectiveFrom: proposal.effectiveFrom,
      effectiveTo: proposal.effectiveTo ?? null,
      riskLevel: proposal.riskLevel,
      evidenceRefs: effectiveProposal.evidenceRefs,
      formalObjectType: input.formalObjectType ?? null,
      formalObjectId: input.formalObjectId ?? null,
      formalObjectVersionRef: input.formalObjectVersionRef ?? null,
      reviewNote: input.reviewNote.trim(),
      reviewedAt,
      createdAt: reviewedAt,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CHANGE_PROPOSAL_REVIEWED",
      objectType: "CHANGE_PROPOSAL",
      objectId: proposal.id,
      riskLevel: proposal.riskLevel,
      clientId: proposal.clientId,
      runId: proposal.runId,
      metadata: { status: updatedProposal.status, reviewNote: updatedProposal.reviewNote ?? "" },
    });
    await this.auditService.record({
      actor: input.actor,
      action: "CHANGE_LEDGER_ENTRY_CREATED",
      objectType: "CHANGE_LEDGER_ENTRY",
      objectId: ledgerEntry.id,
      riskLevel: ledgerEntry.riskLevel,
      clientId: ledgerEntry.clientId,
      runId: ledgerEntry.runId,
      metadata: {
        proposalId: proposal.id,
        targetField: ledgerEntry.targetField,
        inputSummary: "经人工审核后追加正式 ChangeLedgerEntry；entry 不可编辑不可删除",
      },
    });

    return { proposal: updatedProposal, ledgerEntry };
  }

  private async requireProposal(id: string) {
    const proposal = await this.store.findProposalById(id);
    if (!proposal) {
      throw new ChangeLedgerServiceError("CHANGE_PROPOSAL_NOT_FOUND");
    }
    return proposal;
  }

  private async requireWritableRun(runId: string) {
    const run = await this.store.findRunById(runId);
    if (!run) {
      throw new ChangeLedgerServiceError("PAYROLL_RUN_NOT_FOUND");
    }
    if (HISTORY_STATUSES.has(run.status) || run.lockedAt) {
      throw new ChangeLedgerServiceError("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    return run;
  }
}

export class ChangeLedgerServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ChangeLedgerServiceError";
  }
}
