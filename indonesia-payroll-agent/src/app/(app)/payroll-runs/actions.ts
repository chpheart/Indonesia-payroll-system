"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { assertPayrollMonth } from "@/domain/payroll-runs/run-service";
import {
  actionRequiredForRunTransition,
  riskLevelForRunTransition,
} from "@/domain/payroll-runs/run-transition-permissions";
import {
  assertValidRunTransition,
  PAYROLL_RUN_STATUSES,
  RUN_CHANGE_SOURCE_TYPES,
  targetStatusForRunImpact,
} from "@/domain/payroll-runs/run-state-machine";
import { currentRequestContext } from "@/app/(app)/server-actor";
import {
  buildRunPrecheckUpdate,
  invalidateRunPrecheckUpdate,
} from "@/app/(app)/payroll-runs/precheck-snapshot";
import { statusUpdateData } from "@/app/(app)/payroll-runs/status-write";
import { prisma } from "@/lib/db/prisma";

const createRunSchema = z.object({
  clientId: z.string().min(1),
  payrollMonth: z.string().min(7).max(7),
  targetCompletionDate: z.string().date().optional(),
  payDate: z.string().date().optional(),
  deliveryOwnerId: z.string().optional(),
  payrollOwnerId: z.string().optional(),
});

const transitionSchema = z.object({
  runId: z.string().min(1),
  toStatus: z.enum(PAYROLL_RUN_STATUSES),
  reason: z.string().min(1).max(500),
});

const impactRollbackSchema = z.object({
  runId: z.string().min(1),
  sourceType: z.enum(RUN_CHANGE_SOURCE_TYPES),
  reason: z.string().min(1).max(500),
  impactedObjectType: z.string().max(80).optional(),
  impactedObjectId: z.string().max(120).optional(),
  invalidatedResultScope: z.string().min(1).max(500),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, key: string) {
  return textValue(formData, key) || undefined;
}

function parseDate(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

export async function createPayrollRunAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = createRunSchema.parse({
    clientId: textValue(formData, "clientId"),
    payrollMonth: textValue(formData, "payrollMonth"),
    targetCompletionDate: optionalTextValue(formData, "targetCompletionDate"),
    payDate: optionalTextValue(formData, "payDate"),
    deliveryOwnerId: optionalTextValue(formData, "deliveryOwnerId"),
    payrollOwnerId: optionalTextValue(formData, "payrollOwnerId"),
  });
  assertPayrollMonth(body.payrollMonth);
  assertClientActionAllowed(actor, "createPayrollRun", body.clientId);

  const client = await prisma.client.findUnique({
    where: { id: body.clientId },
    select: { id: true, code: true },
  });
  if (!client) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  const run = await prisma.payrollRun.create({
    data: {
      clientId: body.clientId,
      payrollMonth: body.payrollMonth,
      targetCompletionDate: parseDate(body.targetCompletionDate),
      payDate: parseDate(body.payDate),
      createdById: auditFields.actorUserId,
      reminders: {
        create: {
          type: "STAGE_ACTION",
          title: "完成 intake 归属并推进映射确认",
          dueAt: parseDate(body.targetCompletionDate),
          metadata: {
            expectedNextStatus: "PENDING_MAPPING_CONFIRMATION",
            source: "payroll_run_creation",
          },
        },
      },
      statusEvents: {
        create: {
          toStatus: "DRAFT",
          sourceType: "MANUAL_STAGE_ROLLBACK",
          reason: "Payroll run created in draft state",
          triggeredById: auditFields.actorUserId,
        },
      },
    },
  });

  const assignments = [
    body.deliveryOwnerId
      ? { role: "DELIVERY_OWNER" as const, userId: body.deliveryOwnerId }
      : null,
    body.payrollOwnerId ? { role: "PAYROLL_OWNER" as const, userId: body.payrollOwnerId } : null,
  ].filter((item): item is { role: "DELIVERY_OWNER" | "PAYROLL_OWNER"; userId: string } =>
    Boolean(item),
  );

  if (assignments.length > 0) {
    await prisma.runAssignment.createMany({
      data: assignments.map((assignment) => ({
        runId: run.id,
        role: assignment.role,
        userId: assignment.userId,
        assignedById: auditFields.actorUserId,
      })),
      skipDuplicates: true,
    });
  }

  await prisma.auditLog.create({
    data: {
      action: "PAYROLL_RUN_CREATED",
      objectType: "PAYROLL_RUN",
      objectId: run.id,
      riskLevel: "R1",
      ...auditFields,
      clientId: run.clientId,
      runId: run.id,
      metadata: {
        clientCode: client.code,
        payrollMonth: run.payrollMonth,
        assignmentCount: assignments.length,
        inputSummary: "新建客户月度 payroll run，不触发算薪或导出",
        outputSummary: "run 已进入草稿状态，等待 intake 和映射确认",
      },
    },
  });

  revalidatePath("/");
  revalidatePath("/payroll-runs");
  redirect(`/payroll-runs/${run.id}`);
}

export async function transitionPayrollRunAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = transitionSchema.parse({
    runId: textValue(formData, "runId"),
    toStatus: textValue(formData, "toStatus"),
    reason: textValue(formData, "reason"),
  });
  const run = await prisma.payrollRun.findUnique({ where: { id: body.runId } });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }

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

  await prisma.$transaction([
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

  revalidatePath("/");
  revalidatePath("/payroll-runs");
  revalidatePath(`/payroll-runs/${run.id}`);
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

export async function impactRollbackPayrollRunAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = impactRollbackSchema.parse({
    runId: textValue(formData, "runId"),
    sourceType: textValue(formData, "sourceType"),
    reason: textValue(formData, "reason"),
    impactedObjectType: optionalTextValue(formData, "impactedObjectType"),
    impactedObjectId: optionalTextValue(formData, "impactedObjectId"),
    invalidatedResultScope: textValue(formData, "invalidatedResultScope"),
  });
  const run = await prisma.payrollRun.findUnique({ where: { id: body.runId } });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }

  assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);
  const targetStatus = targetStatusForRunImpact(run.status, body.sourceType);
  if (targetStatus === run.status) {
    return;
  }
  const precheckInvalidation =
    targetStatus === "PENDING_PRECHECK"
      ? invalidateRunPrecheckUpdate(body.reason)
      : {};

  await prisma.$transaction([
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

  revalidatePath("/");
  revalidatePath("/payroll-runs");
  revalidatePath(`/payroll-runs/${run.id}`);
}
