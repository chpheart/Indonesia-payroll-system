import { recalculatePendingCustomerConfirmationCount } from "@/app/(app)/payroll-runs/[runId]/phase9-counts";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  type CoverageScope,
  assertConfirmationReplyHasCoverage,
  assertCoverageScopeBelongsToRun,
  assertCoverageScopeCovers,
  coverageScopeCovers,
  parseCoverageScopeJson,
} from "@/domain/confirmation-packs/pack-coverage-service";
import { type PrismaClient } from "@/generated/prisma/client";
import { type RequestAuditFields } from "@/lib/audit/request-audit-fields";
import { toInputJsonObject } from "@/lib/json/input-json";

type RecordConfirmationTx = Pick<
  PrismaClient,
  | "customerConfirmationPack"
  | "customerConfirmationPackItem"
  | "customerConfirmation"
  | "evidence"
  | "evidenceLink"
  | "auditLog"
  | "questionItem"
  | "payrollRun"
>;

type PackItemForConfirmation = {
  id: string;
  category: string;
  status: string;
  coverageScope: unknown;
};

const CONFIRMABLE_PACK_ITEM_CATEGORIES = [
  "MONTHLY_CHANGE",
  "MISSING_INFORMATION",
  "EXCEPTION",
  "CONFIRMATION_REQUIRED",
] as const;
const CONFIRMABLE_PACK_ITEM_CATEGORY_SET = new Set<string>(CONFIRMABLE_PACK_ITEM_CATEGORIES);

export async function recordCustomerConfirmationInTransaction(
  tx: RecordConfirmationTx,
  input: {
    actor: ActorContext;
    auditFields: RequestAuditFields;
    runId: string;
    packId?: string;
    evidenceId: string;
    coverageScope: CoverageScope;
    confirmationText: string;
    confirmedByName?: string;
  },
) {
  assertConfirmationReplyHasCoverage({
    confirmationText: input.confirmationText,
    coverageScope: input.coverageScope,
  });

  const pack = input.packId
    ? await tx.customerConfirmationPack.findUnique({
        where: { id: input.packId },
        include: { items: true },
      })
    : await tx.customerConfirmationPack.findFirst({
        where: { runId: input.runId, status: { notIn: ["INVALIDATED", "SUPERSEDED"] } },
        orderBy: { versionNumber: "desc" },
        include: { items: true },
      });
  if (!pack || pack.runId !== input.runId) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_NOT_FOUND");
  }
  if (["INVALIDATED", "SUPERSEDED"].includes(pack.status)) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_NOT_CONFIRMABLE");
  }
  assertClientActionAllowed(input.actor, "updatePayrollRun", pack.clientId);
  assertCoverageScopeBelongsToRun({
    coverageScope: input.coverageScope,
    runId: pack.runId,
    resultVersionRef: pack.resultVersionRef,
    exportPreviewVersionRef: pack.exportPreviewVersionRef,
    errorCode: "CUSTOMER_CONFIRMATION_COVERAGE_SCOPE_MISMATCH",
  });

  const evidence = await tx.evidence.findUnique({
    where: { id: input.evidenceId },
    select: { id: true, clientId: true, runId: true, status: true, coverageScope: true },
  });
  if (!evidence || evidence.clientId !== pack.clientId || evidence.runId !== pack.runId || evidence.status !== "VALID") {
    throw new Error("CUSTOMER_CONFIRMATION_EVIDENCE_SCOPE_MISMATCH");
  }
  assertCoverageScopeCovers({
    evidenceScope: parseCoverageScopeJson(evidence.coverageScope),
    requestedScope: input.coverageScope,
    errorCode: "CUSTOMER_CONFIRMATION_EVIDENCE_COVERAGE_MISMATCH",
  });

  const openConfirmableItems = pack.items.filter(isOpenConfirmablePackItem);
  const coveredByPackItems = openConfirmableItems.filter((item) =>
    coverageScopeCovers({
      evidenceScope: parseCoverageScopeJson(item.coverageScope),
      requestedScope: input.coverageScope,
    }),
  );
  if (coveredByPackItems.length === 0) {
    throw new Error("CUSTOMER_CONFIRMATION_COVERAGE_NOT_IN_PACK");
  }

  const confirmedItems = openConfirmableItems.filter((item) =>
    coverageScopeCovers({
      evidenceScope: input.coverageScope,
      requestedScope: parseCoverageScopeJson(item.coverageScope),
    }),
  );
  if (confirmedItems.length === 0) {
    throw new Error("CUSTOMER_CONFIRMATION_COVERAGE_DOES_NOT_CLOSE_PACK_ITEM");
  }
  const confirmedItemIds = confirmedItems.map((item) => item.id);

  const confirmation = await tx.customerConfirmation.create({
    data: {
      packId: pack.id,
      clientId: pack.clientId,
      runId: pack.runId,
      evidenceId: evidence.id,
      coverageScopeType: input.coverageScope.type,
      coverageScope: toInputJsonObject(input.coverageScope),
      dataVersionRef: pack.dataVersionRef,
      resultVersionRef: pack.resultVersionRef,
      exportPreviewVersionRef: pack.exportPreviewVersionRef,
      confirmationText: input.confirmationText,
      confirmedByName: input.confirmedByName,
      backfilledById: input.auditFields.actorUserId,
    },
  });
  await tx.evidenceLink.create({
    data: {
      evidenceId: evidence.id,
      clientId: pack.clientId,
      runId: pack.runId,
      objectType: "CUSTOMER_CONFIRMATION",
      objectId: confirmation.id,
      objectLabel: "客户回复回填",
      coverageScopeType: input.coverageScope.type,
      coverageScope: toInputJsonObject(input.coverageScope),
      linkedById: input.auditFields.actorUserId,
    },
  });
  await tx.customerConfirmationPackItem.updateMany({
    where: { id: { in: confirmedItemIds }, status: "OPEN" },
    data: {
      status: "CONFIRMED",
      handlingReason: "客户回复证据覆盖该确认项",
      editedById: input.auditFields.actorUserId,
    },
  });
  const remainingOpenItemCount = openConfirmableItems.filter((item) => !confirmedItemIds.includes(item.id)).length;
  const packStatus = remainingOpenItemCount === 0 ? "CONFIRMED" : "PARTIALLY_CONFIRMED";
  await tx.customerConfirmationPack.update({
    where: { id: pack.id },
    data: { status: packStatus },
  });
  await tx.auditLog.create({
    data: {
      action: "CUSTOMER_CONFIRMATION_RECORDED",
      objectType: "CUSTOMER_CONFIRMATION",
      objectId: confirmation.id,
      riskLevel: "R2",
      ...input.auditFields,
      clientId: confirmation.clientId,
      runId: confirmation.runId,
      metadata: {
        packId: confirmation.packId,
        evidenceId: evidence.id,
        coverageScopeType: confirmation.coverageScopeType,
        confirmedItemIds,
        packStatus,
        inputSummary: "客户回复已绑定确认包版本、证据和覆盖范围；仅结清被该范围覆盖的已展示确认项",
      },
    },
  });
  await recalculatePendingCustomerConfirmationCount(tx, input.runId);

  return confirmation;
}

function isOpenConfirmablePackItem(item: PackItemForConfirmation) {
  return item.status === "OPEN" && CONFIRMABLE_PACK_ITEM_CATEGORY_SET.has(item.category);
}
