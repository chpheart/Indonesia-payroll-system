import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  assertValidRunTransition,
  PAYROLL_RUN_STATUSES,
  RUN_CHANGE_SOURCE_TYPES,
  targetStatusForRunImpact,
} from "@/domain/payroll-runs/run-state-machine";
import {
  actionRequiredForRunTransition,
  riskLevelForRunTransition,
} from "@/domain/payroll-runs/run-transition-permissions";
import { handleApi } from "@/app/api/_utils/errors";
import {
  buildRunPrecheckUpdate,
  invalidateRunPrecheckUpdate,
} from "@/app/(app)/payroll-runs/precheck-snapshot";
import { statusUpdateData } from "@/app/(app)/payroll-runs/status-write";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

const transitionSchema = z.object({
  action: z.literal("transition"),
  toStatus: z.enum(PAYROLL_RUN_STATUSES),
  reason: z.string().min(1).max(500),
});

const rollbackSchema = z.object({
  action: z.literal("impactRollback"),
  sourceType: z.enum(RUN_CHANGE_SOURCE_TYPES),
  reason: z.string().min(1).max(500),
  impactedObjectType: z.string().max(80).optional(),
  impactedObjectId: z.string().max(120).optional(),
  invalidatedResultScope: z.string().min(1).max(500),
});

const patchSchema = z.discriminatedUnion("action", [transitionSchema, rollbackSchema]);

async function loadRun(runId: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      client: { select: { id: true, code: true, name: true } },
      assignments: {
        where: { releasedAt: null },
        include: { user: { select: { id: true, displayName: true, email: true } } },
        orderBy: { assignedAt: "desc" },
      },
      reminders: {
        orderBy: [{ status: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
      },
      statusEvents: {
        include: { triggeredBy: { select: { displayName: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }

  return run;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { runId } = await context.params;
    const run = await loadRun(runId);
    assertClientActionAllowed(actor, "viewClient", run.clientId);

    return NextResponse.json({ run });
  });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { runId } = await context.params;
    const body = patchSchema.parse(await request.json());
    const run = await loadRun(runId);

    if (body.action === "transition") {
      assertClientActionAllowed(
        actor,
        actionRequiredForRunTransition(run.status, body.toStatus),
        run.clientId,
      );
      assertValidRunTransition(
        run.status,
        body.toStatus,
        await runGateCountsForTransition(run, body.toStatus),
      );
      const precheckUpdate =
        body.toStatus === "PENDING_CALCULATION"
          ? await buildRunPrecheckUpdate({
              clientId: run.clientId,
              payrollMonth: run.payrollMonth,
            })
          : {};
      const [updated] = await prisma.$transaction([
        prisma.payrollRun.update({
          where: { id: run.id },
          data: {
            ...statusUpdateData(body.toStatus, body.reason),
            ...precheckUpdate,
          },
        }),
        prisma.runStatusEvent.create({
          data: {
            runId: run.id,
            fromStatus: run.status,
            toStatus: body.toStatus,
            sourceType: "MANUAL_STAGE_ROLLBACK",
            reason: body.reason,
            triggeredById: auditFields.actorUserId,
          },
        }),
        prisma.auditLog.create({
          data: {
            action: "PAYROLL_RUN_STATUS_CHANGED",
            objectType: "PAYROLL_RUN",
            objectId: run.id,
            riskLevel: riskLevelForRunTransition(run.status, body.toStatus),
            ...auditFields,
            clientId: run.clientId,
            runId: run.id,
            metadata: { fromStatus: run.status, toStatus: body.toStatus, reason: body.reason },
          },
        }),
      ]);

      return NextResponse.json({ run: updated });
    }

    assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);
    const targetStatus = targetStatusForRunImpact(run.status, body.sourceType);
    if (targetStatus === run.status) {
      return NextResponse.json({ run, unchanged: true });
    }
    const precheckInvalidation =
      targetStatus === "PENDING_PRECHECK"
        ? invalidateRunPrecheckUpdate(body.reason)
        : {};

    const [updated] = await prisma.$transaction([
      prisma.payrollRun.update({
        where: { id: run.id },
        data: {
          ...statusUpdateData(targetStatus, body.reason),
          ...precheckInvalidation,
        },
      }),
      prisma.runStatusEvent.create({
        data: {
          runId: run.id,
          fromStatus: run.status,
          toStatus: targetStatus,
          sourceType: body.sourceType,
          reason: body.reason,
          impactedObjectType: body.impactedObjectType,
          impactedObjectId: body.impactedObjectId,
          triggeredById: auditFields.actorUserId,
          metadata: { invalidatedResultScope: body.invalidatedResultScope },
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "PAYROLL_RUN_REOPENED",
          objectType: "PAYROLL_RUN",
          objectId: run.id,
          riskLevel: "R2",
          ...auditFields,
          clientId: run.clientId,
          runId: run.id,
          metadata: {
            fromStatus: run.status,
            toStatus: targetStatus,
            sourceType: body.sourceType,
            impactedObjectType: body.impactedObjectType ?? null,
            impactedObjectId: body.impactedObjectId ?? null,
            invalidatedResultScope: body.invalidatedResultScope,
            reason: body.reason,
          },
        },
      }),
    ]);

    return NextResponse.json({ run: updated });
  });
}

async function runGateCountsForTransition<T extends { id: string }>(
  run: T,
  toStatus: string,
) {
  if (toStatus !== "PENDING_PAYROLL_CONFIRMATION" && toStatus !== "LOCKED") {
    return run;
  }
  const [payrollResultCount, calculationTraceCount] = await Promise.all([
    prisma.payrollResult.count({ where: { runId: run.id, status: "FINAL" } }),
    prisma.calculationTrace.count({
      where: { runId: run.id, result: { status: "FINAL" } },
    }),
  ]);
  return { ...run, payrollResultCount, calculationTraceCount };
}
