import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import {
  assertClientActionAllowed,
  isSystemAdmin,
  PermissionDeniedError,
  type ActorContext,
} from "@/domain/auth/permissions";
import { RAW_INPUT_STATUSES } from "@/domain/intake/intake-service";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ intakeItemId: string }>;
};

const updateRawInputSchema = z.object({
  status: z.enum(RAW_INPUT_STATUSES).optional(),
  clientId: z.string().min(1).nullable().optional(),
  payrollMonth: z.string().min(7).max(7).nullable().optional(),
  runId: z.string().min(1).nullable().optional(),
});

function assertRawInputAccess(
  actor: ActorContext,
  rawInput: { clientId?: string | null; createdById?: string | null },
  action: "viewClient" | "updatePayrollRun",
) {
  if (rawInput.clientId) {
    assertClientActionAllowed(actor, action, rawInput.clientId);
    return;
  }

  if (!isSystemAdmin(actor) && rawInput.createdById !== actor.id) {
    throw new PermissionDeniedError("RAW_INPUT_UNASSIGNED_NOT_OWNED");
  }
}

async function requireRawInputForActor(intakeItemId: string, headers: Headers) {
  const actor = await actorFromHeadersWithDatabase(headers);
  const rawInput = await prisma.rawInputItem.findUnique({
    where: { id: intakeItemId },
    select: {
      id: true,
      clientId: true,
      payrollMonth: true,
      runId: true,
      sourceChannel: true,
      inputType: true,
      status: true,
      redactedSummary: true,
      contentHash: true,
      attachmentFileName: true,
      attachmentMimeType: true,
      attachmentSizeBytes: true,
      duplicateRiskScore: true,
      evidenceCandidateRefs: true,
      securityFlags: true,
      createdById: true,
      createdAt: true,
      updatedAt: true,
      uploadedFiles: {
        select: {
          id: true,
          fileName: true,
          purpose: true,
          versionNumber: true,
          parseStatus: true,
          riskFlags: true,
          createdAt: true,
          workbookParses: {
            orderBy: { startedAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              sheetCount: true,
              dangerousContentFlags: true,
              sheets: { orderBy: { sheetIndex: "asc" } },
            },
          },
        },
      },
      caseItems: { orderBy: { createdAt: "desc" } },
      client: { select: { id: true, code: true, name: true } },
      payrollRun: { select: { id: true, payrollMonth: true, status: true, clientId: true } },
    },
  });

  if (!rawInput) {
    throw new Error("RAW_INPUT_NOT_FOUND");
  }

  const clientId = rawInput.clientId ?? rawInput.payrollRun?.clientId;
  if (clientId) {
    assertClientActionAllowed(actor, "viewClient", clientId);
  } else {
    assertRawInputAccess(actor, rawInput, "viewClient");
  }

  return { actor, rawInput };
}

export async function GET(request: NextRequest, { params }: RouteProps) {
  return handleApi(async () => {
    const { intakeItemId } = await params;
    const { rawInput } = await requireRawInputForActor(intakeItemId, request.headers);

    return NextResponse.json({ rawInput });
  });
}

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  return handleApi(async () => {
    const { intakeItemId } = await params;
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = updateRawInputSchema.parse(await request.json());
    const current = await prisma.rawInputItem.findUnique({
      where: { id: intakeItemId },
      select: {
        id: true,
        clientId: true,
        payrollMonth: true,
        runId: true,
        status: true,
        createdById: true,
      },
    });
    if (!current) {
      throw new Error("RAW_INPUT_NOT_FOUND");
    }
    assertRawInputAccess(actor, current, "updatePayrollRun");

    const run = body.runId
      ? await prisma.payrollRun.findUnique({
          where: { id: body.runId },
          select: { id: true, clientId: true, payrollMonth: true },
        })
      : null;
    if (body.runId && !run) {
      throw new Error("PAYROLL_RUN_NOT_FOUND");
    }

    const nextClientId = run?.clientId ?? body.clientId ?? current.clientId;
    const nextPayrollMonth = run?.payrollMonth ?? body.payrollMonth ?? current.payrollMonth;
    const nextRunId = body.runId === null ? null : run?.id ?? current.runId;

    if (nextClientId) {
      assertClientActionAllowed(actor, "updatePayrollRun", nextClientId);
    }

    if (run && body.clientId && body.clientId !== run.clientId) {
      throw new Error("RAW_INPUT_BINDING_MISMATCH");
    }

    if (run && body.payrollMonth && body.payrollMonth !== run.payrollMonth) {
      throw new Error("RAW_INPUT_BINDING_MISMATCH");
    }

    const nextStatus = resolveNextStatus({
      requestedStatus: body.status,
      currentStatus: current.status,
      nextClientId,
      nextPayrollMonth,
    });
    const updated = await prisma.$transaction(async (tx) => {
      const rawInput = await tx.rawInputItem.update({
        where: { id: current.id },
        data: {
          clientId: nextClientId,
          payrollMonth: nextPayrollMonth,
          runId: nextRunId,
          status: nextStatus,
        },
      });

      await tx.auditLog.create({
        data: {
          action:
            current.clientId !== rawInput.clientId ||
            current.payrollMonth !== rawInput.payrollMonth ||
            current.runId !== rawInput.runId
              ? "RAW_INPUT_BOUND"
              : "RAW_INPUT_STATUS_CHANGED",
          objectType: "RAW_INPUT_ITEM",
          objectId: rawInput.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: rawInput.clientId,
          runId: rawInput.runId,
          metadata: {
            fromStatus: current.status,
            toStatus: rawInput.status,
            payrollMonth: rawInput.payrollMonth,
            inputSummary: "更新 RawInputItem 归属或处理状态，不触发生效 payroll 写入",
          },
        },
      });

      return rawInput;
    });

    return NextResponse.json({ rawInput: updated });
  });
}

function resolveNextStatus(input: {
  requestedStatus?: (typeof RAW_INPUT_STATUSES)[number];
  currentStatus: (typeof RAW_INPUT_STATUSES)[number];
  nextClientId?: string | null;
  nextPayrollMonth?: string | null;
}) {
  const isAssigned = Boolean(input.nextClientId && input.nextPayrollMonth);

  if (!isAssigned) {
    if (
      input.requestedStatus &&
      !["PENDING_ASSIGNMENT", "REJECTED", "VOIDED"].includes(input.requestedStatus)
    ) {
      throw new Error("RAW_INPUT_ASSIGNMENT_REQUIRED");
    }

    return input.requestedStatus ?? "PENDING_ASSIGNMENT";
  }

  return (
    input.requestedStatus ??
    (input.currentStatus === "PENDING_ASSIGNMENT" ? "PENDING_EXTRACTION" : input.currentStatus)
  );
}
