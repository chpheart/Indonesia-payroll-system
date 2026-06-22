import { randomUUID } from "node:crypto";
import { type AuditService } from "@/domain/audit/audit-service";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  type CoverageScope,
  type CoverageScopeType,
  assertExplicitCoverage,
  normalizeCoverageScope,
} from "@/domain/confirmation-packs/pack-coverage-service";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";

export const EVIDENCE_KINDS = [
  "WECHAT_TEXT",
  "WECHAT_SCREENSHOT",
  "CUSTOMER_FILE",
  "CUSTOMER_CONFIRMATION",
  "INTERNAL_NOTE",
  "SYSTEM_GENERATED",
  "OTHER",
] as const;

export const EVIDENCE_LINK_OBJECT_TYPES = [
  "CLIENT",
  "PAYROLL_RUN",
  "RAW_INPUT_ITEM",
  "UPLOADED_FILE_VERSION",
  "WORKBOOK_CELL",
  "CHANGE_PROPOSAL",
  "CHANGE_LEDGER_ENTRY",
  "CUSTOMER_CONFIRMATION_PACK",
  "CUSTOMER_CONFIRMATION_PACK_ITEM",
  "CUSTOMER_CONFIRMATION",
  "QUESTION_ITEM",
  "EMPLOYEE",
  "EMPLOYEE_MASTER_VERSION",
  "FIELD_MAPPING_VERSION",
  "STANDARDIZED_PAYROLL_INPUT",
  "RULE_VERSION",
  "FX_RATE_VERSION",
  "CLIENT_SCOPE",
  "HIGH_RISK_ISSUE",
  "CORRECTION_RUN",
  "EXPORT_PREVIEW",
] as const;

export const EVIDENCE_LIFECYCLE_STATUSES = ["VALID", "STALE", "VOIDED"] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export type EvidenceLinkObjectType = (typeof EVIDENCE_LINK_OBJECT_TYPES)[number];
export type EvidenceLifecycleStatus = (typeof EVIDENCE_LIFECYCLE_STATUSES)[number];

export type EvidenceRecord = {
  id: string;
  clientId: string;
  runId?: string | null;
  rawInputItemId?: string | null;
  fileVersionId?: string | null;
  kind: EvidenceKind;
  sourceChannel?: string | null;
  status: EvidenceLifecycleStatus;
  redactedSummary: string;
  contentText?: string | null;
  attachmentKey?: string | null;
  attachmentFileName?: string | null;
  attachmentMimeType?: string | null;
  attachmentSizeBytes?: number | null;
  contentHash?: string | null;
  applicableMonth?: string | null;
  sourceLabel: string;
  coverageScopeType: CoverageScopeType;
  coverageScope: CoverageScope;
  notes?: string | null;
  uploadedById?: string | null;
  confirmedById?: string | null;
  confirmedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EvidenceLinkRecord = {
  id: string;
  evidenceId: string;
  clientId: string;
  runId?: string | null;
  objectType: EvidenceLinkObjectType;
  objectId: string;
  objectLabel?: string | null;
  targetField?: string | null;
  coverageScopeType: CoverageScopeType;
  coverageScope: CoverageScope;
  status: EvidenceLifecycleStatus;
  linkedById?: string | null;
  linkedAt: Date;
};

export type EvidenceDraft = Omit<
  EvidenceRecord,
  | "id"
  | "status"
  | "coverageScopeType"
  | "uploadedById"
  | "confirmedById"
  | "confirmedAt"
  | "createdAt"
  | "updatedAt"
> & {
  links: Array<
    Omit<EvidenceLinkRecord, "id" | "evidenceId" | "status" | "coverageScopeType" | "linkedById" | "linkedAt">
  >;
};

export type EvidenceStore = {
  findRunById(id: string): Promise<{
    id: string;
    clientId: string;
    payrollMonth: string;
    status: PayrollRunStatus;
    lockedAt?: Date | null;
  } | null>;
  createEvidence(input: EvidenceRecord): Promise<EvidenceRecord>;
  createEvidenceLink(input: EvidenceLinkRecord): Promise<EvidenceLinkRecord>;
};

const HISTORY_STATUSES = new Set<PayrollRunStatus>([
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
]);

export class EvidenceService {
  constructor(
    private readonly store: EvidenceStore,
    private readonly auditService: AuditService,
  ) {}

  async createEvidence(input: {
    actor: ActorContext;
    draft: EvidenceDraft;
  }): Promise<{ evidence: EvidenceRecord; links: EvidenceLinkRecord[] }> {
    await this.assertScopeAndPermission(input.actor, input.draft);
    assertEvidenceHasContent(input.draft);
    assertExplicitCoverage(input.draft.coverageScope);

    if (input.draft.links.length === 0) {
      throw new EvidenceServiceError("EVIDENCE_LINK_REQUIRED");
    }

    const now = new Date();
    const evidence = await this.store.createEvidence({
      ...input.draft,
      id: randomUUID(),
      status: "VALID",
      coverageScope: normalizeCoverageScope(input.draft.coverageScope),
      coverageScopeType: input.draft.coverageScope.type,
      uploadedById: input.actor.id,
      confirmedById: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const links: EvidenceLinkRecord[] = [];
    for (const link of input.draft.links) {
      assertExplicitCoverage(link.coverageScope);
      links.push(
        await this.store.createEvidenceLink({
          ...link,
          id: randomUUID(),
          evidenceId: evidence.id,
          status: "VALID",
          coverageScope: normalizeCoverageScope(link.coverageScope),
          coverageScopeType: link.coverageScope.type,
          linkedById: input.actor.id,
          linkedAt: now,
        }),
      );
    }

    await this.auditService.record({
      actor: input.actor,
      action: "EVIDENCE_CREATED",
      objectType: "EVIDENCE",
      objectId: evidence.id,
      riskLevel: "R1",
      clientId: evidence.clientId,
      runId: evidence.runId ?? undefined,
      metadata: {
        kind: evidence.kind,
        sourceLabel: evidence.sourceLabel,
        linkCount: links.length,
        inputSummary: "证据已记录；只作为可追溯输入，不自动改写工资结果",
      },
    });

    return { evidence, links };
  }

  private async assertScopeAndPermission(actor: ActorContext, draft: EvidenceDraft) {
    if (!draft.runId) {
      assertClientActionAllowed(actor, "updatePayrollRun", draft.clientId);
      return;
    }

    const run = await this.store.findRunById(draft.runId);
    if (!run) {
      throw new EvidenceServiceError("PAYROLL_RUN_NOT_FOUND");
    }
    if (run.clientId !== draft.clientId) {
      throw new EvidenceServiceError("EVIDENCE_RUN_SCOPE_MISMATCH");
    }
    if (HISTORY_STATUSES.has(run.status) || run.lockedAt) {
      throw new EvidenceServiceError("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);
  }
}

export function assertEvidenceHasContent(input: {
  contentText?: string | null;
  attachmentKey?: string | null;
  rawInputItemId?: string | null;
  fileVersionId?: string | null;
}) {
  if (
    !input.contentText?.trim() &&
    !input.attachmentKey &&
    !input.rawInputItemId &&
    !input.fileVersionId
  ) {
    throw new EvidenceServiceError("EVIDENCE_CONTENT_REQUIRED");
  }
}

export function isEvidenceKind(value: string): value is EvidenceKind {
  return EVIDENCE_KINDS.includes(value as EvidenceKind);
}

export function isEvidenceLinkObjectType(value: string): value is EvidenceLinkObjectType {
  return EVIDENCE_LINK_OBJECT_TYPES.includes(value as EvidenceLinkObjectType);
}

export class EvidenceServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EvidenceServiceError";
  }
}
