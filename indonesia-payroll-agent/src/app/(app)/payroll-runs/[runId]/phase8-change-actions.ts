"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentRequestContext } from "@/app/(app)/server-actor";
import {
  assertPendingProposalStatus,
  assertRunWritable,
} from "@/app/(app)/payroll-runs/[runId]/phase8-action-guards";
import { invalidateCustomerConfirmationsForChange } from "@/app/(app)/payroll-runs/[runId]/phase9-confirmation-invalidation";
import {
  evidenceList,
  jsonObjectValue,
  textValue,
} from "@/app/(app)/payroll-runs/[runId]/phase8-form-utils";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { assertProposalCanBeApproved, CONFIDENCE_BANDS } from "@/domain/changes/change-review-policy";
import {
  assertRelatedProposalScope,
  CLOSE_CHANGE_PROPOSAL_ACTIONS,
  CLOSE_CHANGE_PROPOSAL_STATUS,
  closeActionRequiresRelatedProposalLookup,
  formalObjectReferenceForProposal,
} from "@/domain/changes/change-review-workflow";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject, toInputJsonValue } from "@/lib/json/input-json";

const approveProposalSchema = z.object({
  runId: z.string().min(1),
  proposalId: z.string().min(1),
  confidence: z.enum(CONFIDENCE_BANDS).optional(),
  evidenceRefs: z.string().optional(),
  proposedValue: z.string().optional(),
  formalObjectType: z.string().max(80).optional(),
  formalObjectId: z.string().max(120).optional(),
  formalObjectVersionRef: z.string().max(160).optional(),
  reviewNote: z.string().min(1).max(1000),
});
const closeProposalSchema = z.object({
  runId: z.string().min(1),
  proposalId: z.string().min(1),
  action: z.enum(CLOSE_CHANGE_PROPOSAL_ACTIONS),
  relatedProposalIds: z.string().optional(),
  reviewNote: z.string().min(1).max(1000),
});

export async function approveChangeProposalAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = approveProposalSchema.parse({
    runId: textValue(formData, "runId"),
    proposalId: textValue(formData, "proposalId"),
    confidence: textValue(formData, "confidence") || undefined,
    evidenceRefs: textValue(formData, "evidenceRefs"),
    proposedValue: textValue(formData, "proposedValue"),
    formalObjectType: textValue(formData, "formalObjectType") || undefined,
    formalObjectId: textValue(formData, "formalObjectId") || undefined,
    formalObjectVersionRef: textValue(formData, "formalObjectVersionRef") || undefined,
    reviewNote: textValue(formData, "reviewNote"),
  });
  const proposal = await prisma.changeProposal.findUnique({
    where: { id: body.proposalId },
    include: {
      payrollRun: { select: { clientId: true, status: true, lockedAt: true } },
      ledgerEntry: { select: { id: true } },
    },
  });
  if (!proposal || proposal.runId !== body.runId) throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
  assertRunWritable(proposal.payrollRun);
  assertPendingProposalStatus(proposal.status, Boolean(proposal.ledgerEntry));
  assertClientActionAllowed(actor, "updatePayrollRun", proposal.clientId);

  const refs = evidenceList(body.evidenceRefs);
  const evidenceRefs = refs.length > 0 ? refs : proposal.evidenceRefs;
  const confidence = body.confidence ?? proposal.confidence;
  const parsedProposedValue = jsonObjectValue(body.proposedValue);
  const nextProposedValue =
    parsedProposedValue ?? (proposal.proposedValue as Record<string, unknown>);
  assertProposalCanBeApproved({
    proposalType: proposal.proposalType,
    targetField: proposal.targetField,
    riskLevel: proposal.riskLevel,
    confidence,
    evidenceRefs,
    requiredEvidenceRefs: proposal.requiredEvidenceRefs,
  });

  await prisma.$transaction(async (tx) => {
    const reviewedAt = new Date();
    const modified =
      Boolean(parsedProposedValue) ||
      (body.confidence !== undefined && body.confidence !== proposal.confidence) ||
      (refs.length > 0 && !sameList(refs, proposal.evidenceRefs));
    const updateResult = await tx.changeProposal.updateMany({
      where: { id: proposal.id, status: "PENDING_REVIEW" },
      data: {
        status: modified ? "APPROVED_WITH_MODIFICATION" : "APPROVED",
        reviewedById: auditFields.actorUserId,
        reviewedAt,
        reviewNote: body.reviewNote,
        proposedValue: toInputJsonObject(nextProposedValue),
        evidenceRefs,
        confidence,
      },
    });
    if (updateResult.count !== 1) {
      throw new Error("CHANGE_PROPOSAL_ALREADY_REVIEWED");
    }
    const updated = await tx.changeProposal.findUnique({ where: { id: proposal.id } });
    if (!updated) {
      throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
    }
    const formalObjectRef = formalObjectReferenceForProposal(proposal, body);
    const ledgerEntry = await tx.changeLedgerEntry.create({
      data: {
        proposalId: proposal.id,
        clientId: proposal.clientId,
        runId: proposal.runId,
        reviewedById: auditFields.actorUserId,
        targetEmployeeId: proposal.targetEmployeeId,
        entryType: proposal.proposalType,
        targetObjectType: proposal.targetObjectType,
        targetObjectId: proposal.targetObjectId,
        targetField: proposal.targetField,
        previousValue: toInputJsonValue(proposal.previousValue) ?? {},
        newValue: toInputJsonObject(nextProposedValue),
        effectiveFrom: proposal.effectiveFrom,
        effectiveTo: proposal.effectiveTo,
        riskLevel: proposal.riskLevel,
        evidenceRefs,
        formalObjectType: formalObjectRef.formalObjectType,
        formalObjectId: formalObjectRef.formalObjectId,
        formalObjectVersionRef: formalObjectRef.formalObjectVersionRef,
        reviewNote: body.reviewNote,
        reviewedAt,
      },
    });
    await invalidateCustomerConfirmationsForChange(tx, {
      clientId: proposal.clientId,
      runId: proposal.runId,
      targetEmployeeId: proposal.targetEmployeeId,
      targetField: proposal.targetField,
      dataVersionRef: formalObjectRef.formalObjectVersionRef,
      riskLevel: proposal.riskLevel,
      auditFields,
      changedAt: reviewedAt,
    });
    await tx.auditLog.createMany({
      data: reviewAuditEntries(proposal, ledgerEntry.id, updated.status, auditFields, body.reviewNote),
    });
  });
  revalidatePath(`/payroll-runs/${body.runId}/changes`);
}

export async function closeChangeProposalAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = closeProposalSchema.parse({
    runId: textValue(formData, "runId"),
    proposalId: textValue(formData, "proposalId"),
    action: textValue(formData, "action"),
    relatedProposalIds: textValue(formData, "relatedProposalIds"),
    reviewNote: textValue(formData, "reviewNote"),
  });
  const proposal = await prisma.changeProposal.findUnique({
    where: { id: body.proposalId },
    include: {
      payrollRun: { select: { clientId: true, status: true, lockedAt: true } },
      ledgerEntry: { select: { id: true } },
    },
  });
  if (!proposal || proposal.runId !== body.runId) throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
  assertRunWritable(proposal.payrollRun);
  assertPendingProposalStatus(proposal.status, Boolean(proposal.ledgerEntry));
  assertClientActionAllowed(actor, "updatePayrollRun", proposal.clientId);
  const relatedProposalIds = evidenceList(body.relatedProposalIds);
  const relatedProposals = closeActionRequiresRelatedProposalLookup(body.action)
    ? await prisma.changeProposal.findMany({
        where: { id: { in: relatedProposalIds } },
        select: { id: true, clientId: true, runId: true },
      })
    : [];
  assertRelatedProposalScope({
    action: body.action,
    proposalId: proposal.id,
    clientId: proposal.clientId,
    runId: proposal.runId,
    relatedProposalIds,
    relatedProposals,
  });

  await prisma.$transaction(async (tx) => {
    const updateResult = await tx.changeProposal.updateMany({
      where: { id: proposal.id, status: "PENDING_REVIEW" },
      data: {
        status: CLOSE_CHANGE_PROPOSAL_STATUS[body.action],
        reviewedById: auditFields.actorUserId,
        reviewedAt: new Date(),
        reviewNote: body.reviewNote,
        relatedProposalIds,
      },
    });
    if (updateResult.count !== 1) {
      throw new Error("CHANGE_PROPOSAL_ALREADY_REVIEWED");
    }
    const caseItem =
      body.action === "convertToQuestion"
        ? await tx.caseItem.create({
            data: {
              clientId: proposal.clientId,
              runId: proposal.runId,
              rawInputItemId: proposal.rawInputItemId,
              type: "MISSING_INFORMATION",
              riskLevel: proposal.riskLevel,
              title: "ChangeProposal 转追问",
              detail: body.reviewNote,
              metadata: toInputJsonObject({
                proposalId: proposal.id,
                targetField: proposal.targetField,
                source: "CHANGE_PROPOSAL_REVIEW",
              }),
            },
          })
        : null;
    if (body.action === "convertToQuestion" && proposal.rawInputItemId) {
      await tx.rawInputItem.updateMany({
        where: { id: proposal.rawInputItemId },
        data: { status: "NEEDS_QUESTION" },
      });
    }
    if (body.action === "convertToQuestion") {
      await tx.payrollRun.update({
        where: { id: proposal.runId },
        data: { blockingIssueCount: { increment: 1 } },
      });
    }
    await tx.auditLog.create({
      data: {
        action: "CHANGE_PROPOSAL_REVIEWED",
        objectType: "CHANGE_PROPOSAL",
        objectId: proposal.id,
        riskLevel: proposal.riskLevel,
        ...auditFields,
        clientId: proposal.clientId,
        runId: proposal.runId,
        metadata: {
          action: body.action,
          status: CLOSE_CHANGE_PROPOSAL_STATUS[body.action],
          reviewNote: body.reviewNote,
          relatedProposalIds,
          caseItemId: caseItem?.id,
        },
      },
    });
  });
  revalidatePath(`/payroll-runs/${body.runId}/changes`);
}

function reviewAuditEntries(
  proposal: { id: string; riskLevel: "R0" | "R1" | "R2" | "R3" | "R4"; clientId: string; runId: string; targetField: string },
  ledgerEntryId: string,
  status: string,
  auditFields: Awaited<ReturnType<typeof currentRequestContext>>["auditFields"],
  reviewNote: string,
) {
  return [
    {
      action: "CHANGE_PROPOSAL_REVIEWED" as const,
      objectType: "CHANGE_PROPOSAL" as const,
      objectId: proposal.id,
      riskLevel: proposal.riskLevel,
      ...auditFields,
      clientId: proposal.clientId,
      runId: proposal.runId,
      metadata: { status, reviewNote },
    },
    {
      action: "CHANGE_LEDGER_ENTRY_CREATED" as const,
      objectType: "CHANGE_LEDGER_ENTRY" as const,
      objectId: ledgerEntryId,
      riskLevel: proposal.riskLevel,
      ...auditFields,
      clientId: proposal.clientId,
      runId: proposal.runId,
      metadata: { proposalId: proposal.id, targetField: proposal.targetField },
    },
  ];
}

function sameList(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
