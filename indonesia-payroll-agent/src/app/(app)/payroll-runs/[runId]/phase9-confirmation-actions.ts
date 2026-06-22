"use server";
import { revalidatePath } from "next/cache";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { textValue } from "@/app/(app)/payroll-runs/[runId]/phase8-form-utils";
import { recalculatePendingCustomerConfirmationCount } from "@/app/(app)/payroll-runs/[runId]/phase9-counts";
import {
  loadRunForConfirmationPack,
  packSnapshotFromRun,
} from "@/app/(app)/payroll-runs/[runId]/phase9-pack-snapshot";
import { recordCustomerConfirmationInTransaction } from "@/app/(app)/payroll-runs/[runId]/phase9-record-confirmation";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  buildCustomerConfirmationPackDraft,
  assertPackHasNoCriticalOmissions,
  assertPackItemCanChangeVisibility,
  CUSTOMER_CONFIRMATION_PACK_ITEM_STATUSES,
  type CustomerConfirmationPackItemStatus,
} from "@/domain/confirmation-packs/customer-confirmation-pack-service";
import {
  parseCoverageScopeJson,
} from "@/domain/confirmation-packs/pack-coverage-service";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject } from "@/lib/json/input-json";

export async function generateCustomerConfirmationPackAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const runId = textValue(formData, "runId");
  const run = await loadRunForConfirmationPack(runId);
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);

  const snapshot = packSnapshotFromRun(run);
  const draft = buildCustomerConfirmationPackDraft(snapshot);
  assertPackHasNoCriticalOmissions({ items: draft.items, source: snapshot });

  await prisma.$transaction(async (tx) => {
    const latest = await tx.customerConfirmationPack.findFirst({
      where: { runId },
      orderBy: { versionNumber: "desc" },
      select: { id: true, versionNumber: true, status: true },
    });
    if (latest && ["DRAFT", "READY_FOR_CUSTOMER", "PARTIALLY_CONFIRMED"].includes(latest.status)) {
      await tx.customerConfirmationPack.update({
        where: { id: latest.id },
        data: {
          status: "SUPERSEDED",
          invalidationReason: "生成新客户确认包版本",
          invalidatedAt: new Date(),
        },
      });
    }
    const pack = await tx.customerConfirmationPack.create({
      data: {
        clientId: draft.clientId,
        runId: draft.runId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        previousPackId: latest?.id,
        status: draft.status,
        dataVersionRef: draft.dataVersionRef,
        resultVersionRef: draft.resultVersionRef,
        exportPreviewVersionRef: draft.exportPreviewVersionRef,
        sourceSnapshot: toInputJsonObject(draft.sourceSnapshot),
        generatedMessage: draft.generatedMessage,
        editableMessage: draft.generatedMessage,
        generatedById: auditFields.actorUserId,
        items: {
          create: draft.items.map((item) => ({
            clientId: draft.clientId,
            runId: draft.runId,
            targetEmployeeId: item.targetEmployeeId,
            category: item.category,
            status: item.status,
            sourceObjectType: item.sourceObjectType,
            sourceObjectId: item.sourceObjectId,
            targetField: item.targetField,
            title: item.title,
            detail: item.detail,
            riskLevel: item.riskLevel,
            isCritical: item.isCritical,
            isSystemRequired: item.isSystemRequired,
            coverageScopeType: item.coverageScope.type,
            coverageScope: toInputJsonObject(item.coverageScope),
            evidenceRefs: item.evidenceRefs,
            sortOrder: item.sortOrder,
          })),
        },
      },
      include: { items: true },
    });
    await tx.auditLog.create({
      data: {
        action: "CUSTOMER_CONFIRMATION_PACK_CREATED",
        objectType: "CUSTOMER_CONFIRMATION_PACK",
        objectId: pack.id,
        riskLevel: "R2",
        ...auditFields,
        clientId: pack.clientId,
        runId: pack.runId,
        metadata: {
          versionNumber: pack.versionNumber,
          itemCount: pack.items.length,
          criticalCount: pack.items.filter((item) => item.isCritical || item.isSystemRequired).length,
          inputSummary: "客户确认包草稿已生成；未锁定 run 时仅为核对材料",
        },
      },
    });
    await recalculatePendingCustomerConfirmationCount(tx, runId);
  });

  revalidatePath(`/payroll-runs/${runId}/customer-confirmation`);
  revalidatePath(`/payroll-runs/${runId}/evidence`);
}

export async function recordCustomerConfirmationAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const runId = textValue(formData, "runId");
  const coverageScope = coverageScopeFromForm(formData, runId);
  const confirmationText = textValue(formData, "confirmationText");

  await prisma.$transaction(async (tx) => {
    await recordCustomerConfirmationInTransaction(tx, {
      actor,
      auditFields,
      runId,
      packId: textValue(formData, "packId") || undefined,
      evidenceId: textValue(formData, "evidenceId"),
      coverageScope,
      confirmationText,
      confirmedByName: textValue(formData, "confirmedByName") || undefined,
    });
  });

  revalidatePath(`/payroll-runs/${runId}/customer-confirmation`);
  revalidatePath(`/payroll-runs/${runId}/evidence`);
}

export async function updateConfirmationPackItemAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const runId = textValue(formData, "runId");
  const status = parsePackItemStatus(textValue(formData, "status"));
  const handlingReason = textValue(formData, "handlingReason");

  await prisma.$transaction(async (tx) => {
    const item = await tx.customerConfirmationPackItem.findUnique({
      where: { id: textValue(formData, "itemId") },
      select: {
        id: true,
        clientId: true,
        runId: true,
        title: true,
        isCritical: true,
        isSystemRequired: true,
        status: true,
        riskLevel: true,
      },
    });
    if (!item || item.runId !== runId) {
      throw new Error("CUSTOMER_CONFIRMATION_PACK_ITEM_NOT_FOUND");
    }
    assertClientActionAllowed(actor, "updatePayrollRun", item.clientId);
    assertPackItemCanChangeVisibility({ item, nextStatus: status, handlingReason });
    await tx.customerConfirmationPackItem.update({
      where: { id: item.id },
      data: {
        status,
        handlingReason: handlingReason || undefined,
        editedById: auditFields.actorUserId,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "CUSTOMER_CONFIRMATION_PACK_UPDATED",
        objectType: "CUSTOMER_CONFIRMATION_PACK_ITEM",
        objectId: item.id,
        riskLevel: item.riskLevel,
        ...auditFields,
        clientId: item.clientId,
        runId: item.runId,
        metadata: {
          fromStatus: item.status,
          toStatus: status,
          handlingReason,
        },
      },
    });
    await recalculatePendingCustomerConfirmationCount(tx, runId);
  });

  revalidatePath(`/payroll-runs/${runId}/customer-confirmation`);
}

function coverageScopeFromForm(formData: FormData, runId: string) {
  const raw = textValue(formData, "coverageScope");
  if (raw) {
    return parseCoverageScopeJson(JSON.parse(raw) as Record<string, unknown>);
  }

  return parseCoverageScopeJson({
    type: textValue(formData, "coverageScopeType") || "MIXED",
    runId,
    employeeIds: splitField(textValue(formData, "employeeIds")),
    fields: splitField(textValue(formData, "fields")),
    clientScopeKeys: splitField(textValue(formData, "clientScopeKeys")),
    fileVersionIds: splitField(textValue(formData, "fileVersionIds")),
    sourceObjectRefs: splitField(textValue(formData, "sourceObjectRefs")),
    exportPreviewVersionRef: textValue(formData, "exportPreviewVersionRef"),
    resultVersionRef: textValue(formData, "resultVersionRef"),
  });
}

function parsePackItemStatus(value: string): CustomerConfirmationPackItemStatus {
  if (!CUSTOMER_CONFIRMATION_PACK_ITEM_STATUSES.includes(value as CustomerConfirmationPackItemStatus)) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_ITEM_STATUS_INVALID");
  }
  return value as CustomerConfirmationPackItemStatus;
}

function splitField(value?: string) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}
