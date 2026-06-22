import { randomUUID } from "node:crypto";
import { type AuditService } from "@/domain/audit/audit-service";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  type ChangeImpactScope,
  type CoverageScope,
  type CoverageScopeType,
  assertConfirmationReplyHasCoverage,
  coverageIntersectsChange,
  normalizeCoverageScope,
} from "@/domain/confirmation-packs/pack-coverage-service";

export const CUSTOMER_CONFIRMATION_STATUSES = ["VALID", "STALE", "VOIDED"] as const;

export type CustomerConfirmationStatus = (typeof CUSTOMER_CONFIRMATION_STATUSES)[number];

export type CustomerConfirmationRecord = {
  id: string;
  packId: string;
  clientId: string;
  runId: string;
  evidenceId?: string | null;
  status: CustomerConfirmationStatus;
  coverageScopeType: CoverageScopeType;
  coverageScope: CoverageScope;
  dataVersionRef: string;
  resultVersionRef?: string | null;
  exportPreviewVersionRef?: string | null;
  confirmationText: string;
  confirmedByName?: string | null;
  backfilledById?: string | null;
  backfilledAt: Date;
  invalidatedAt?: Date | null;
  invalidationReason?: string | null;
  createdAt: Date;
};

export type CustomerConfirmationPackRef = {
  id: string;
  clientId: string;
  runId: string;
  status: string;
  dataVersionRef: string;
  resultVersionRef?: string | null;
  exportPreviewVersionRef?: string | null;
};

export type ConfirmationStore = {
  findPackById(id: string): Promise<CustomerConfirmationPackRef | null>;
  createConfirmation(input: CustomerConfirmationRecord): Promise<CustomerConfirmationRecord>;
  markConfirmationsStale(input: {
    runId: string;
    reason: string;
    changedAt: Date;
  }): Promise<CustomerConfirmationRecord[]>;
};

const INVALIDATING_FIELDS = new Set([
  "amount",
  "salaryAmount",
  "grossSalaryAmount",
  "netPayAmount",
  "bonusAmount",
  "deductionAmount",
  "bankAccountNumber",
  "bankName",
  "npwp",
  "ptkpStatus",
  "bpjsHealthNumber",
  "bpjsEmploymentNumber",
  "employeeScope",
  "exportTemplateField",
  "resultVersion",
]);

export class ConfirmationService {
  constructor(
    private readonly store: ConfirmationStore,
    private readonly auditService: AuditService,
  ) {}

  async recordCustomerConfirmation(input: {
    actor: ActorContext;
    packId: string;
    evidenceId: string;
    coverageScope: CoverageScope;
    confirmationText: string;
    confirmedByName?: string;
  }): Promise<CustomerConfirmationRecord> {
    const pack = await this.store.findPackById(input.packId);
    if (!pack) {
      throw new ConfirmationServiceError("CUSTOMER_CONFIRMATION_PACK_NOT_FOUND");
    }
    if (pack.status === "INVALIDATED" || pack.status === "SUPERSEDED") {
      throw new ConfirmationServiceError("CUSTOMER_CONFIRMATION_PACK_NOT_CONFIRMABLE");
    }
    assertClientActionAllowed(input.actor, "updatePayrollRun", pack.clientId);
    assertConfirmationReplyHasCoverage({
      confirmationText: input.confirmationText,
      coverageScope: input.coverageScope,
    });

    const now = new Date();
    const normalizedCoverage = normalizeCoverageScope(input.coverageScope);
    const confirmation = await this.store.createConfirmation({
      id: randomUUID(),
      packId: pack.id,
      clientId: pack.clientId,
      runId: pack.runId,
      evidenceId: input.evidenceId,
      status: "VALID",
      coverageScopeType: normalizedCoverage.type,
      coverageScope: normalizedCoverage,
      dataVersionRef: pack.dataVersionRef,
      resultVersionRef: pack.resultVersionRef ?? null,
      exportPreviewVersionRef: pack.exportPreviewVersionRef ?? null,
      confirmationText: input.confirmationText.trim(),
      confirmedByName: input.confirmedByName?.trim() || null,
      backfilledById: input.actor.id,
      backfilledAt: now,
      invalidatedAt: null,
      invalidationReason: null,
      createdAt: now,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CUSTOMER_CONFIRMATION_RECORDED",
      objectType: "CUSTOMER_CONFIRMATION",
      objectId: confirmation.id,
      riskLevel: "R2",
      clientId: confirmation.clientId,
      runId: confirmation.runId,
      metadata: {
        packId: confirmation.packId,
        evidenceId: confirmation.evidenceId ?? "",
        coverageScopeType: confirmation.coverageScopeType,
        inputSummary: "客户回复已回填为版本化确认；覆盖范围不会自动扩大",
      },
    });

    return confirmation;
  }

  async invalidateForChange(input: {
    actor: ActorContext;
    clientId: string;
    runId: string;
    targetField?: string | null;
    reason?: string;
  }) {
    assertClientActionAllowed(input.actor, "updatePayrollRun", input.clientId);
    if (!isCriticalConfirmationInvalidationField(input.targetField)) {
      return [];
    }

    const reason =
      input.reason ??
      `关键字段 ${input.targetField ?? "unknown"} 变化，旧客户确认按 fail-closed 失效`;
    const changedAt = new Date();
    const invalidated = await this.store.markConfirmationsStale({
      runId: input.runId,
      reason,
      changedAt,
    });

    for (const confirmation of invalidated) {
      await this.auditService.record({
        actor: input.actor,
        action: "CUSTOMER_CONFIRMATION_INVALIDATED",
        objectType: "CUSTOMER_CONFIRMATION",
        objectId: confirmation.id,
        riskLevel: "R2",
        clientId: confirmation.clientId,
        runId: confirmation.runId,
        metadata: { reason, targetField: input.targetField ?? "" },
      });
    }

    return invalidated;
  }
}

export function isCriticalConfirmationInvalidationField(field?: string | null): boolean {
  if (!field) {
    return false;
  }
  return INVALIDATING_FIELDS.has(field) || /amount|salary|bank|bpjs|tax|npwp|template|employee/i.test(field);
}

export function shouldInvalidateConfirmation(input: {
  confirmation: Pick<CustomerConfirmationRecord, "coverageScope" | "status">;
  change: ChangeImpactScope;
}): boolean {
  if (input.confirmation.status !== "VALID") {
    return false;
  }
  return coverageIntersectsChange(input.confirmation.coverageScope, input.change);
}

export class ConfirmationServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ConfirmationServiceError";
  }
}
