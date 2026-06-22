"use server";
import { revalidatePath } from "next/cache";
import { currentRequestContext } from "@/app/(app)/server-actor";
import {
  evidenceList,
  textValue,
} from "@/app/(app)/payroll-runs/[runId]/phase8-form-utils";
import { recalculatePendingCustomerConfirmationCount } from "@/app/(app)/payroll-runs/[runId]/phase9-counts";
import { loadQuestionResolutionGuardContext } from "@/app/(app)/payroll-runs/[runId]/phase9-question-resolution";
import { assertQuestionSourceScope } from "@/app/(app)/payroll-runs/[runId]/phase9-question-scope";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  QUESTION_SOURCES,
  QUESTION_STATUSES,
  assertQuestionResolutionAllowed,
  assertQuestionTransitionAllowed,
  type QuestionSource,
  type QuestionStatus,
} from "@/domain/questions/question-service";
import { prisma } from "@/lib/db/prisma";

export async function createQuestionAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const runId = textValue(formData, "runId");
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, clientId: true },
  });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);
  const source = parseQuestionSource(textValue(formData, "source") || "MANUAL");
  const riskLevel = parseRiskLevel(textValue(formData, "riskLevel") || "R1");
  const rawInputItemId = textValue(formData, "rawInputItemId") || undefined;
  const changeProposalId = textValue(formData, "changeProposalId") || undefined;
  await assertQuestionSourceScope(prisma, {
    clientId: run.clientId,
    runId: run.id,
    rawInputItemId,
    changeProposalId,
  });

  await prisma.$transaction(async (tx) => {
    const question = await tx.questionItem.create({
      data: {
        clientId: run.clientId,
        runId: run.id,
        rawInputItemId,
        changeProposalId,
        source,
        riskLevel,
        title: textValue(formData, "title"),
        detail: textValue(formData, "detail"),
        reason: textValue(formData, "reason"),
        impactSummary: textValue(formData, "impactSummary"),
        targetObjectType: textValue(formData, "targetObjectType") || undefined,
        targetObjectId: textValue(formData, "targetObjectId") || undefined,
        targetField: textValue(formData, "targetField") || undefined,
        blockingIssueRef: textValue(formData, "blockingIssueRef") || undefined,
        requiredEvidenceTypes: evidenceList(textValue(formData, "requiredEvidenceTypes")),
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
        riskLevel,
        ...auditFields,
        clientId: run.clientId,
        runId: run.id,
        metadata: {
          source,
          targetField: question.targetField ?? "",
          inputSummary: "追问已创建；未解决前保持可追溯状态",
        },
      },
    });
    await recalculatePendingCustomerConfirmationCount(tx, run.id);
  });

  revalidatePath(`/payroll-runs/${run.id}/evidence`);
  revalidatePath(`/payroll-runs/${run.id}/customer-confirmation`);
}

export async function transitionQuestionAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const questionId = textValue(formData, "questionId");
  const toStatus = parseQuestionStatus(textValue(formData, "toStatus"));
  const reason = textValue(formData, "reason");
  const evidenceRef = textValue(formData, "evidenceRef") || undefined;
  const evidenceId = textValue(formData, "evidenceId") || undefined;
  const resolutionNote = textValue(formData, "resolutionNote") || undefined;
  const question = await prisma.questionItem.findUnique({
    where: { id: questionId },
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
  assertQuestionTransitionAllowed(question.status, toStatus);
  const guard = await loadQuestionResolutionGuardContext(prisma, question, evidenceId);
  const verifiedEvidenceRef = guard.submittedEvidenceRef ?? evidenceRef;
  assertQuestionResolutionAllowed({
    question,
    toStatus,
    evidenceRef: verifiedEvidenceRef,
    resolutionNote,
    verifiedEvidenceCount: guard.verifiedEvidenceCount,
    blockingStatus: guard.blockingStatus,
  });

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const evidenceRefs = verifiedEvidenceRef
      ? Array.from(new Set([...question.evidenceRefs, verifiedEvidenceRef]))
      : question.evidenceRefs;
    await tx.questionItem.update({
      where: { id: question.id },
      data: {
        status: toStatus,
        evidenceRefs,
        resolutionNote: resolutionNote || question.resolutionNote,
        resolvedById: toStatus === "RESOLVED" ? auditFields.actorUserId : undefined,
        resolvedAt: toStatus === "RESOLVED" ? now : undefined,
        closedById: toStatus === "CLOSED" ? auditFields.actorUserId : undefined,
        closedAt: toStatus === "CLOSED" ? now : undefined,
      },
    });
    await tx.questionStatusEvent.create({
      data: {
        questionId: question.id,
        fromStatus: question.status,
        toStatus,
        changedById: auditFields.actorUserId,
        evidenceId,
        reason,
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
          toStatus,
          evidenceRef: verifiedEvidenceRef ?? "",
        },
      },
    });
    await recalculatePendingCustomerConfirmationCount(tx, question.runId);
  });

  revalidatePath(`/payroll-runs/${question.runId}/evidence`);
  revalidatePath(`/payroll-runs/${question.runId}/customer-confirmation`);
}

function parseQuestionSource(value: string): QuestionSource {
  if (!QUESTION_SOURCES.includes(value as QuestionSource)) {
    throw new Error("QUESTION_SOURCE_INVALID");
  }
  return value as QuestionSource;
}

function parseQuestionStatus(value: string): QuestionStatus {
  if (!QUESTION_STATUSES.includes(value as QuestionStatus)) {
    throw new Error("QUESTION_STATUS_INVALID");
  }
  return value as QuestionStatus;
}

function parseRiskLevel(value: string) {
  if (!["R0", "R1", "R2", "R3", "R4"].includes(value)) {
    throw new Error("RISK_LEVEL_INVALID");
  }
  return value as "R0" | "R1" | "R2" | "R3" | "R4";
}
