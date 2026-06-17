import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import {
  assertClientActionAllowed,
  isSystemAdmin,
  type ActorContext,
} from "@/domain/auth/permissions";
import { assertPayrollMonth } from "@/domain/payroll-runs/run-service";
import { PAYROLL_RUN_STATUSES } from "@/domain/payroll-runs/run-state-machine";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const createRunSchema = z.object({
  clientId: z.string().min(1),
  payrollMonth: z.string().min(7).max(7),
  targetCompletionDate: z.string().date().optional(),
  payDate: z.string().date().optional(),
  deliveryOwnerId: z.string().min(1).optional(),
  payrollOwnerId: z.string().min(1).optional(),
});

const statusSchema = z.enum(PAYROLL_RUN_STATUSES);

function scopedClientWhere(actor: ActorContext, clientId: string | null) {
  if (clientId) {
    assertClientActionAllowed(actor, "viewClient", clientId);
    return clientId;
  }

  return isSystemAdmin(actor) ? undefined : actor.authorizedClientIds;
}

function parseDate(value?: string) {
  return value ? new Date(`${value}T00:00:00.000Z`) : undefined;
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const clientScope = scopedClientWhere(actor, searchParams.get("clientId"));
    const statusValue = searchParams.get("status")?.trim() || undefined;
    const ownerId = searchParams.get("ownerId")?.trim() || undefined;
    const risk = searchParams.get("risk")?.trim() || undefined;
    const payrollMonth = searchParams.get("payrollMonth")?.trim() || undefined;
    const status = statusValue ? statusSchema.parse(statusValue) : undefined;
    const today = new Date();

    const baseWhere = {
      clientId: Array.isArray(clientScope)
        ? { in: clientScope }
        : clientScope
          ? clientScope
          : undefined,
      payrollMonth,
      status,
      assignments: ownerId
        ? {
            some: {
              userId: ownerId,
              releasedAt: null,
            },
          }
        : undefined,
      OR:
        risk === "blocking"
          ? [{ blockingIssueCount: { gt: 0 } }]
          : risk === "high"
            ? [{ highRiskIssueCount: { gt: 0 } }]
            : undefined,
    };

    const [runs, metrics] = await Promise.all([
      prisma.payrollRun.findMany({
        where: baseWhere,
        include: {
          client: { select: { code: true, name: true } },
          assignments: {
            where: { releasedAt: null },
            include: { user: { select: { id: true, displayName: true, email: true } } },
            orderBy: { assignedAt: "desc" },
          },
          reminders: {
            where: { status: "OPEN" },
            orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
            take: 4,
          },
        },
        orderBy: [
          { blockingIssueCount: "desc" },
          { highRiskIssueCount: "desc" },
          { targetCompletionDate: "asc" },
          { createdAt: "desc" },
        ],
        take: 100,
      }),
      prisma.payrollRun.aggregate({
        where: baseWhere,
        _count: { _all: true },
        _sum: {
          pendingIntakeAssignmentCount: true,
          pendingProposalReviewCount: true,
          blockingIssueCount: true,
          highRiskIssueCount: true,
          pendingCustomerConfirmationCount: true,
        },
      }),
    ]);

    const overdueCount = runs.filter(
      (run) =>
        run.targetCompletionDate &&
        run.targetCompletionDate < today &&
        !["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(run.status),
    ).length;

    return NextResponse.json({
      runs,
      metrics: {
        pendingRuns: metrics._count._all,
        pendingIntakeAssignments: metrics._sum.pendingIntakeAssignmentCount ?? 0,
        pendingProposalReviews: metrics._sum.pendingProposalReviewCount ?? 0,
        blockers: metrics._sum.blockingIssueCount ?? 0,
        highRisk: metrics._sum.highRiskIssueCount ?? 0,
        pendingCustomerConfirmations: metrics._sum.pendingCustomerConfirmationCount ?? 0,
        overdue: overdueCount,
      },
    });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = createRunSchema.parse(await request.json());
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
        statusEvents: {
          create: {
            toStatus: "DRAFT",
            sourceType: "MANUAL_STAGE_ROLLBACK",
            reason: "Payroll run created in draft state",
            triggeredById: auditFields.actorUserId,
          },
        },
      },
      include: { client: { select: { code: true, name: true } } },
    });

    const assignmentData = [
      body.deliveryOwnerId
        ? { runId: run.id, role: "DELIVERY_OWNER" as const, userId: body.deliveryOwnerId }
        : null,
      body.payrollOwnerId
        ? { runId: run.id, role: "PAYROLL_OWNER" as const, userId: body.payrollOwnerId }
        : null,
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (assignmentData.length > 0) {
      await prisma.runAssignment.createMany({
        data: assignmentData.map((assignment) => ({
          ...assignment,
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
          assignmentCount: assignmentData.length,
          inputSummary: "新建客户月度 payroll run，不触发算薪或导出",
          outputSummary: "run 已进入草稿状态，等待 intake 和映射确认",
        },
      },
    });

    return NextResponse.json({ run }, { status: 201 });
  });
}
