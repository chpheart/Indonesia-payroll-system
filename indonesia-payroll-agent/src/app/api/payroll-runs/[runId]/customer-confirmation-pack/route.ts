import { NextResponse, type NextRequest } from "next/server";
import { handleApi } from "@/app/api/_utils/errors";
import {
  loadRunForConfirmationPack,
  packSnapshotFromRun as buildPackSnapshotFromRun,
} from "@/app/(app)/payroll-runs/[runId]/phase9-pack-snapshot";
import { recalculatePendingCustomerConfirmationCount } from "@/app/(app)/payroll-runs/[runId]/phase9-counts";
import { recordCustomerConfirmationInTransaction } from "@/app/(app)/payroll-runs/[runId]/phase9-record-confirmation";
import { listCustomerConfirmationPacks } from "@/app/api/payroll-runs/[runId]/customer-confirmation-pack/route-read";
import { updateCustomerConfirmationPackMessage } from "@/app/api/payroll-runs/[runId]/customer-confirmation-pack/route-message";
import { packRequestSchema } from "@/app/api/payroll-runs/[runId]/customer-confirmation-pack/route-schemas";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  buildCustomerConfirmationPackDraft,
  assertPackHasNoCriticalOmissions,
  assertPackItemCanChangeVisibility,
} from "@/domain/confirmation-packs/customer-confirmation-pack-service";
import {
  parseCoverageScopeJson,
} from "@/domain/confirmation-packs/pack-coverage-service";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject } from "@/lib/json/input-json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const { runId } = await context.params;
    return listCustomerConfirmationPacks(request, runId);
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { runId } = await context.params;
    const body = packRequestSchema.parse(await request.json());
    const run = await loadRunForConfirmationPack(runId);
    if (!run) {
      throw new Error("PAYROLL_RUN_NOT_FOUND");
    }
    assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);

    if (body.action === "generate") {
      const snapshot = buildPackSnapshotFromRun(run);
      const draft = buildCustomerConfirmationPackDraft(snapshot);
      assertPackHasNoCriticalOmissions({
        items: draft.items,
        source: snapshot,
      });

      const created = await prisma.$transaction(async (tx) => {
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
        return pack;
      });

      return NextResponse.json({ pack: created }, { status: 201 });
    }

    if (body.action === "recordConfirmation") {
      const coverageScope = parseCoverageScopeJson(body.coverageScope);

      const created = await prisma.$transaction(async (tx) => {
        return recordCustomerConfirmationInTransaction(tx, {
          actor,
          auditFields,
          runId,
          packId: body.packId,
          evidenceId: body.evidenceId,
          coverageScope,
          confirmationText: body.confirmationText,
          confirmedByName: body.confirmedByName,
        });
      });

      return NextResponse.json({ confirmation: created }, { status: 201 });
    }

    if (body.action === "updateMessage") {
      const updated = await prisma.$transaction((tx) =>
        updateCustomerConfirmationPackMessage(tx, {
          runId,
          packId: body.packId,
          editableMessage: body.editableMessage,
          auditFields,
        }),
      );

      return NextResponse.json({ pack: updated });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.customerConfirmationPackItem.findUnique({
        where: { id: body.itemId },
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
      assertPackItemCanChangeVisibility({
        item,
        nextStatus: body.status,
        handlingReason: body.handlingReason,
      });
      const result = await tx.customerConfirmationPackItem.update({
        where: { id: item.id },
        data: {
          status: body.status,
          handlingReason: body.handlingReason,
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
            toStatus: body.status,
            handlingReason: body.handlingReason ?? "",
          },
        },
      });
      await recalculatePendingCustomerConfirmationCount(tx, runId);
      return result;
    });

    return NextResponse.json({ item: updated });
  });
}
