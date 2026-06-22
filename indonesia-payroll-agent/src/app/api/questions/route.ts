import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import { loadQuestionResolutionGuardContext } from "@/app/(app)/payroll-runs/[runId]/phase9-question-resolution";
import { assertQuestionSourceScope } from "@/app/(app)/payroll-runs/[runId]/phase9-question-scope";
import { recalculatePendingCustomerConfirmationCount } from "@/app/(app)/payroll-runs/[runId]/phase9-counts";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed, isSystemAdmin } from "@/domain/auth/permissions";
import { AUDIT_RISK_LEVELS } from "@/domain/audit/audit-service";
import {
  QUESTION_SOURCES,
  QUESTION_STATUSES,
  assertQuestionResolutionAllowed,
  assertQuestionTransitionAllowed,
} from "@/domain/questions/question-service";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const createQuestionSchema = z.object({
  action: z.literal("create").default("create"),
  clientId: z.string().min(1),
  runId: z.string().min(1),
  rawInputItemId: z.string().min(1).optional(),
  changeProposalId: z.string().min(1).optional(),
  source: z.enum(QUESTION_SOURCES).default("MANUAL"),
  riskLevel: z.enum(AUDIT_RISK_LEVELS).default("R1"),
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(2000),
  reason: z.string().min(1).max(2000),
  impactSummary: z.string().min(1).max(500),
  targetObjectType: z.string().max(120).optional(),
  targetObjectId: z.string().max(160).optional(),
  targetField: z.string().max(120).optional(),
  blockingIssueRef: z.string().max(160).optional(),
  dueAt: z.string().datetime().optional(),
  requiredEvidenceTypes: z.array(z.string().min(1)).default([]),
});

const transitionQuestionSchema = z.object({
  action: z.literal("transition"),
  questionId: z.string().min(1),
  toStatus: z.enum(QUESTION_STATUSES),
  reason: z.string().min(1).max(1000),
  evidenceRef: z.string().max(200).optional(),
  evidenceId: z.string().min(1).optional(),
  resolutionNote: z.string().max(2000).optional(),
});

const questionRequestSchema = z.discriminatedUnion("action", [
  createQuestionSchema,
  transitionQuestionSchema,
]);

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const runId = searchParams.get("runId")?.trim() || undefined;
    const clientId = searchParams.get("clientId")?.trim() || undefined;

    if (!runId && !clientId && !isSystemAdmin(actor)) {
      throw new Error("QUESTION_SCOPE_REQUIRED");
    }
    if (runId) {
      const run = await prisma.payrollRun.findUnique({
        where: { id: runId },
        select: { clientId: true },
      });
      if (!run) {
        throw new Error("PAYROLL_RUN_NOT_FOUND");
      }
      assertClientActionAllowed(actor, "viewClient", run.clientId);
    }
    if (clientId) {
      assertClientActionAllowed(actor, "viewClient", clientId);
    }

    const questions = await prisma.questionItem.findMany({
      where: { runId, clientId },
      include: {
        rawInputItem: { select: { id: true, redactedSummary: true, sourceChannel: true } },
        changeProposal: { select: { id: true, targetField: true, reason: true } },
        statusEvents: { orderBy: { createdAt: "desc" }, take: 5 },
      },
      orderBy: [{ status: "asc" }, { riskLevel: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    return NextResponse.json({ questions });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = questionRequestSchema.parse(await request.json());

    if (body.action === "create") {
      const run = await prisma.payrollRun.findUnique({
        where: { id: body.runId },
        select: { clientId: true },
      });
      if (!run) {
        throw new Error("PAYROLL_RUN_NOT_FOUND");
      }
      if (run.clientId !== body.clientId) {
        throw new Error("QUESTION_RUN_SCOPE_MISMATCH");
      }
      assertClientActionAllowed(actor, "updatePayrollRun", body.clientId);
      await assertQuestionSourceScope(prisma, {
        clientId: body.clientId,
        runId: body.runId,
        rawInputItemId: body.rawInputItemId,
        changeProposalId: body.changeProposalId,
      });

      const created = await prisma.$transaction(async (tx) => {
        const question = await tx.questionItem.create({
          data: {
            clientId: body.clientId,
            runId: body.runId,
            rawInputItemId: body.rawInputItemId,
            changeProposalId: body.changeProposalId,
            source: body.source,
            riskLevel: body.riskLevel,
            title: body.title,
            detail: body.detail,
            reason: body.reason,
            impactSummary: body.impactSummary,
            targetObjectType: body.targetObjectType,
            targetObjectId: body.targetObjectId,
            targetField: body.targetField,
            blockingIssueRef: body.blockingIssueRef,
            dueAt: body.dueAt ? new Date(body.dueAt) : undefined,
            requiredEvidenceTypes: body.requiredEvidenceTypes,
            createdById: auditFields.actorUserId,
          },
        });
        await tx.questionStatusEvent.create({
          data: {
            questionId: question.id,
            toStatus: "PENDING",
            changedById: auditFields.actorUserId,
            reason: "追问创建",
          },
        });
        await tx.auditLog.create({
          data: {
            action: "QUESTION_ITEM_CREATED",
            objectType: "QUESTION_ITEM",
            objectId: question.id,
            riskLevel: question.riskLevel,
            ...auditFields,
            clientId: question.clientId,
            runId: question.runId,
            metadata: {
              source: question.source,
              targetField: question.targetField ?? "",
              inputSummary: "追问已创建，关闭前必须保留状态事件和原因",
            },
          },
        });
        await recalculatePendingCustomerConfirmationCount(tx, question.runId);
        return question;
      });

      return NextResponse.json({ question: created }, { status: 201 });
    }

    const question = await prisma.questionItem.findUnique({
      where: { id: body.questionId },
      select: {
        id: true,
        clientId: true,
        runId: true,
        status: true,
        riskLevel: true,
        evidenceRefs: true,
        blockingIssueRef: true,
        resolutionNote: true,
      },
    });
    if (!question) {
      throw new Error("QUESTION_NOT_FOUND");
    }
    assertClientActionAllowed(actor, "updatePayrollRun", question.clientId);
    assertQuestionTransitionAllowed(question.status, body.toStatus);
    const guard = await loadQuestionResolutionGuardContext(prisma, question, body.evidenceId);
    const verifiedEvidenceRef = guard.submittedEvidenceRef ?? body.evidenceRef;
    assertQuestionResolutionAllowed({
      question,
      toStatus: body.toStatus,
      evidenceRef: verifiedEvidenceRef,
      resolutionNote: body.resolutionNote,
      verifiedEvidenceCount: guard.verifiedEvidenceCount,
      blockingStatus: guard.blockingStatus,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const evidenceRefs = verifiedEvidenceRef
        ? Array.from(new Set([...question.evidenceRefs, verifiedEvidenceRef]))
        : question.evidenceRefs;
      const result = await tx.questionItem.update({
        where: { id: question.id },
        data: {
          status: body.toStatus,
          evidenceRefs,
          resolutionNote: body.resolutionNote || question.resolutionNote,
          resolvedById: body.toStatus === "RESOLVED" ? auditFields.actorUserId : undefined,
          resolvedAt: body.toStatus === "RESOLVED" ? now : undefined,
          closedById: body.toStatus === "CLOSED" ? auditFields.actorUserId : undefined,
          closedAt: body.toStatus === "CLOSED" ? now : undefined,
        },
      });
      await tx.questionStatusEvent.create({
        data: {
          questionId: question.id,
          fromStatus: question.status,
          toStatus: body.toStatus,
          changedById: auditFields.actorUserId,
          evidenceId: body.evidenceId,
          reason: body.reason,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "QUESTION_STATUS_CHANGED",
          objectType: "QUESTION_ITEM",
          objectId: question.id,
          riskLevel: question.riskLevel,
          ...auditFields,
          clientId: question.clientId,
          runId: question.runId,
          metadata: {
            fromStatus: question.status,
            toStatus: body.toStatus,
            evidenceRef: verifiedEvidenceRef ?? "",
          },
        },
      });
      await recalculatePendingCustomerConfirmationCount(tx, question.runId);
      return result;
    });

    return NextResponse.json({ question: updated });
  });
}
