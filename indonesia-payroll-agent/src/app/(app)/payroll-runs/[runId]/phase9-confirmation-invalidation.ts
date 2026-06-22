import { type PrismaClient } from "@/generated/prisma/client";
import { type AuditRiskLevel } from "@/domain/audit/audit-service";
import { isCriticalConfirmationInvalidationField, shouldInvalidateConfirmation } from "@/domain/confirmations/confirmation-service";
import { coverageIntersectsChange, parseCoverageScopeJson } from "@/domain/confirmation-packs/pack-coverage-service";
import { type RequestAuditFields } from "@/lib/audit/request-audit-fields";
import { recalculatePendingCustomerConfirmationCount } from "@/app/(app)/payroll-runs/[runId]/phase9-counts";

type InvalidationTx = Pick<
  PrismaClient,
  "customerConfirmation" | "customerConfirmationPack" | "customerConfirmationPackItem" | "payrollRun" | "auditLog" | "questionItem"
>;

export async function invalidateCustomerConfirmationsForChange(
  tx: InvalidationTx,
  input: {
    clientId: string;
    runId: string;
    targetEmployeeId?: string | null;
    targetField?: string | null;
    dataVersionRef?: string | null;
    resultVersionRef?: string | null;
    exportPreviewVersionRef?: string | null;
    riskLevel: AuditRiskLevel;
    auditFields: RequestAuditFields;
    changedAt: Date;
  },
) {
  if (!isCriticalConfirmationInvalidationField(input.targetField)) {
    return [];
  }

  const change = {
    runId: input.runId,
    targetEmployeeId: input.targetEmployeeId,
    targetField: input.targetField,
    dataVersionRef: input.dataVersionRef,
    resultVersionRef: input.resultVersionRef,
    exportPreviewVersionRef: input.exportPreviewVersionRef,
  };
  const confirmations = await tx.customerConfirmation.findMany({
    where: { runId: input.runId, status: "VALID" },
    select: { id: true, packId: true, status: true, coverageScope: true },
  });
  const invalidatedConfirmations = confirmations.filter((confirmation) =>
    shouldInvalidateConfirmation({
      confirmation: {
        status: confirmation.status,
        coverageScope: parseCoverageScopeJson(confirmation.coverageScope),
      },
      change,
    }),
  );
  const packItems = await tx.customerConfirmationPackItem.findMany({
    where: {
      runId: input.runId,
      status: "OPEN",
      pack: { status: { in: ["DRAFT", "READY_FOR_CUSTOMER", "PARTIALLY_CONFIRMED", "CONFIRMED"] } },
    },
    select: { packId: true, coverageScope: true },
  });
  const invalidatedPackIds = new Set([
    ...invalidatedConfirmations.map((confirmation) => confirmation.packId),
    ...packItems
      .filter((item) => coverageIntersectsChange(parseCoverageScopeJson(item.coverageScope), change))
      .map((item) => item.packId),
  ]);

  if (invalidatedConfirmations.length === 0 && invalidatedPackIds.size === 0) {
    return { confirmations: [], packIds: [] };
  }

  const invalidationReason = `关键字段 ${input.targetField} 已变更，旧客户确认按影响范围失效`;
  if (invalidatedConfirmations.length > 0) {
    await tx.customerConfirmation.updateMany({
      where: { id: { in: invalidatedConfirmations.map((confirmation) => confirmation.id) } },
      data: {
        status: "STALE",
        invalidatedAt: input.changedAt,
        invalidationReason,
      },
    });
  }
  await tx.customerConfirmationPack.updateMany({
    where: {
      runId: input.runId,
      id: { in: [...invalidatedPackIds] },
      status: { in: ["DRAFT", "READY_FOR_CUSTOMER", "PARTIALLY_CONFIRMED", "CONFIRMED"] },
    },
    data: {
      status: "INVALIDATED",
      invalidatedAt: input.changedAt,
      invalidationReason,
    },
  });
  await recalculatePendingCustomerConfirmationCount(tx, input.runId);
  await tx.auditLog.createMany({
    data: [
      ...invalidatedConfirmations.map((confirmation) => ({
        action: "CUSTOMER_CONFIRMATION_INVALIDATED" as const,
        objectType: "CUSTOMER_CONFIRMATION" as const,
        objectId: confirmation.id,
        riskLevel: input.riskLevel,
        ...input.auditFields,
        clientId: input.clientId,
        runId: input.runId,
        metadata: { reason: invalidationReason, targetField: input.targetField ?? "" },
      })),
      ...[...invalidatedPackIds].map((packId) => ({
        action: "CUSTOMER_CONFIRMATION_INVALIDATED" as const,
        objectType: "CUSTOMER_CONFIRMATION_PACK" as const,
        objectId: packId,
        riskLevel: input.riskLevel,
        ...input.auditFields,
        clientId: input.clientId,
        runId: input.runId,
        metadata: { reason: invalidationReason, targetField: input.targetField ?? "" },
      })),
    ],
  });

  return { confirmations: invalidatedConfirmations, packIds: [...invalidatedPackIds] };
}
