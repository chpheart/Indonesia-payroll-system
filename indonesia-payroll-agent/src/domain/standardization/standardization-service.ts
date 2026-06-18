import { randomUUID } from "node:crypto";
import { type AuditService } from "@/domain/audit/audit-service";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";
import {
  REVIEWABLE_STANDARDIZED_INPUT_STATUSES,
  assertReviewableStandardizedInputStatus,
  isCriticalStandardField,
  type EvidenceStatus,
  type StandardizationIssue,
  type StandardizedInputStatus,
  validateStandardizedInputReferences,
} from "@/domain/standardization/standardization-policy";

export type StandardizedPayrollInputRecord = {
  id: string;
  clientId: string;
  runId: string;
  fieldMappingVersionId?: string | null;
  employeeId?: string | null;
  employeeMatchCandidateId?: string | null;
  payrollComponentId?: string | null;
  rawInputItemId?: string | null;
  fileVersionId?: string | null;
  sheetId?: string | null;
  sourceCellId?: string | null;
  versionNumber: number;
  status: StandardizedInputStatus;
  standardField: string;
  componentCode?: string | null;
  amount?: string | number | null;
  currencyCode: string;
  value: Record<string, unknown>;
  sourceSheetName?: string | null;
  sourceRowIndex?: number | null;
  storeCode?: string | null;
  storeName?: string | null;
  evidenceStatus: EvidenceStatus;
  evidenceRefs: string[];
  validationIssues: StandardizationIssue[];
  optimisticLockVersion: number;
  modifiedById?: string | null;
  confirmedById?: string | null;
  confirmedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StandardizationStore = {
  findRunById(id: string): Promise<{
    id: string;
    clientId: string;
    status: PayrollRunStatus;
    lockedAt?: Date | null;
  } | null>;
  findMappingVersionById(id: string): Promise<{
    id: string;
    clientId: string;
    runId: string;
    status: "CONFIRMED" | "CANDIDATE" | "REJECTED" | "SUPERSEDED";
    confidence: "LOW" | "MEDIUM" | "HIGH" | "CONFLICT";
  } | null>;
  findEmployeeMatchCandidateById(id: string): Promise<{
    id: string;
    clientId: string;
    runId: string;
    employeeId?: string | null;
    status: "CANDIDATE" | "CONFIRMED" | "REJECTED" | "BLOCKED";
    confidence: "LOW" | "MEDIUM" | "HIGH" | "CONFLICT";
	  } | null>;
  createInput(input: StandardizedPayrollInputRecord): Promise<StandardizedPayrollInputRecord>;
  findInputById(id: string): Promise<StandardizedPayrollInputRecord | null>;
  updateInput(input: {
    id: string;
    status: StandardizedInputStatus;
    evidenceStatus?: EvidenceStatus;
    evidenceRefs?: string[];
    value?: Record<string, unknown>;
    amount?: string | number | null;
	    validationIssues?: StandardizationIssue[];
	    expectedLockVersion: number;
	    reviewableStatuses: readonly StandardizedInputStatus[];
	    optimisticLockVersion: number;
    modifiedById?: string;
    confirmedById?: string;
    confirmedAt?: Date;
	  }): Promise<StandardizedPayrollInputRecord | null>;
};

const HISTORY_STATUSES = new Set<PayrollRunStatus>([
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
]);

export class StandardizationService {
  constructor(
    private readonly store: StandardizationStore,
    private readonly auditService: AuditService,
  ) {}

  async createPreview(input: {
    actor: ActorContext;
    draft: Omit<
      StandardizedPayrollInputRecord,
      | "id"
      | "status"
      | "versionNumber"
      | "validationIssues"
      | "optimisticLockVersion"
      | "modifiedById"
      | "confirmedById"
      | "confirmedAt"
      | "createdAt"
      | "updatedAt"
    >;
  }): Promise<StandardizedPayrollInputRecord> {
    const run = await this.requireWritableRun(input.draft.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    if (input.draft.clientId !== run.clientId) {
      throw new StandardizationServiceError("STANDARDIZED_INPUT_RUN_SCOPE_MISMATCH");
    }

    const issues = await this.validateDraft(input.draft);
    const now = new Date();
    const created = await this.store.createInput({
      ...input.draft,
      id: randomUUID(),
      status: issues.some((issue) => issue.severity === "BLOCKING") ? "BLOCKED" : "PREVIEW",
      versionNumber: 1,
      validationIssues: issues,
      optimisticLockVersion: 1,
      modifiedById: input.actor.id,
      confirmedById: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "STANDARDIZED_INPUT_PREVIEW_CREATED",
      objectType: "STANDARDIZED_PAYROLL_INPUT",
      objectId: created.id,
      riskLevel: issues.some((issue) => issue.severity === "BLOCKING") ? "R3" : "R2",
      clientId: created.clientId,
      runId: created.runId,
      metadata: {
        status: created.status,
        standardField: created.standardField,
        issueCodes: issues.map((issue) => issue.code),
      },
    });

    return created;
  }

  async confirmInput(input: {
    actor: ActorContext;
    inputId: string;
    expectedLockVersion: number;
    evidenceRefs?: string[];
    value?: Record<string, unknown>;
    amount?: string | number | null;
  }): Promise<StandardizedPayrollInputRecord> {
    const current = await this.requireInput(input.inputId);
    const run = await this.requireWritableRun(current.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    try {
      assertReviewableStandardizedInputStatus(current.status);
    } catch {
      throw new StandardizationServiceError("STANDARDIZED_INPUT_NOT_REVIEWABLE");
    }
    if (current.optimisticLockVersion !== input.expectedLockVersion) {
      throw new StandardizationServiceError("STANDARDIZED_INPUT_STALE_VERSION");
    }
    const nextEvidenceRefs = input.evidenceRefs ?? current.evidenceRefs;
    const nextEvidenceStatus = nextEvidenceRefs.length > 0 ? "VALID" : current.evidenceStatus;
    const nextIssues = await this.validateDraft({
      ...current,
      evidenceRefs: nextEvidenceRefs,
      evidenceStatus: nextEvidenceStatus,
      value: input.value ?? current.value,
      amount: input.amount ?? current.amount,
    });
    if (nextIssues.some((issue) => issue.severity === "BLOCKING")) {
      throw new StandardizationServiceError("STANDARDIZED_INPUT_BLOCKING_ISSUES");
    }
    if (isCriticalStandardField(current.standardField) && nextEvidenceStatus !== "VALID") {
      throw new StandardizationServiceError("CRITICAL_STANDARDIZED_INPUT_EVIDENCE_REQUIRED");
    }

	    const updated = await this.store.updateInput({
	      id: current.id,
	      status: "CONFIRMED",
      evidenceStatus: nextEvidenceStatus,
      evidenceRefs: nextEvidenceRefs,
      value: input.value ?? current.value,
	      amount: input.amount ?? current.amount,
	      validationIssues: nextIssues,
	      expectedLockVersion: input.expectedLockVersion,
	      reviewableStatuses: REVIEWABLE_STANDARDIZED_INPUT_STATUSES,
	      optimisticLockVersion: current.optimisticLockVersion + 1,
      modifiedById: input.actor.id,
	      confirmedById: input.actor.id,
	      confirmedAt: new Date(),
	    });
	    if (!updated) {
	      throw new StandardizationServiceError("STANDARDIZED_INPUT_STALE_VERSION");
	    }

    await this.auditService.record({
      actor: input.actor,
      action: "STANDARDIZED_INPUT_CONFIRMED",
      objectType: "STANDARDIZED_PAYROLL_INPUT",
      objectId: updated.id,
      riskLevel: "R2",
      clientId: updated.clientId,
      runId: updated.runId,
      metadata: {
        standardField: updated.standardField,
        optimisticLockVersion: updated.optimisticLockVersion,
        inputSummary: "标准化输入经人工确认后生效；关键字段已校验证据",
      },
    });

    return updated;
  }

  private async validateDraft(
    draft: Pick<
      StandardizedPayrollInputRecord,
	      | "fieldMappingVersionId"
	      | "employeeMatchCandidateId"
	      | "clientId"
	      | "runId"
	      | "standardField"
	      | "evidenceRefs"
	      | "evidenceStatus"
      | "value"
      | "amount"
	    >,
	  ): Promise<StandardizationIssue[]> {
	    const [mapping, match] = await Promise.all([
	      draft.fieldMappingVersionId ? this.store.findMappingVersionById(draft.fieldMappingVersionId) : null,
	      draft.employeeMatchCandidateId
	        ? this.store.findEmployeeMatchCandidateById(draft.employeeMatchCandidateId)
	        : null,
	    ]);
	    return validateStandardizedInputReferences({
	      clientId: draft.clientId,
	      runId: draft.runId,
	      fieldMappingVersionId: draft.fieldMappingVersionId,
	      employeeMatchCandidateId: draft.employeeMatchCandidateId,
	      standardField: draft.standardField,
	      evidenceRefs: draft.evidenceRefs,
	      evidenceStatus: draft.evidenceStatus,
	      fieldMappingVersion: mapping,
	      employeeMatchCandidate: match,
	    });
	  }

  private async requireInput(id: string) {
    const input = await this.store.findInputById(id);
    if (!input) {
      throw new StandardizationServiceError("STANDARDIZED_INPUT_NOT_FOUND");
    }
    return input;
  }

  private async requireWritableRun(runId: string) {
    const run = await this.store.findRunById(runId);
    if (!run) {
      throw new StandardizationServiceError("PAYROLL_RUN_NOT_FOUND");
    }
    if (HISTORY_STATUSES.has(run.status) || run.lockedAt) {
      throw new StandardizationServiceError("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    return run;
  }
}

export class StandardizationServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StandardizationServiceError";
  }
}
