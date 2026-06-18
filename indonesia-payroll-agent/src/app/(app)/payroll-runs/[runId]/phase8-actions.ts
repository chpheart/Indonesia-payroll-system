"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { assertProposalCanBeApproved, CONFIDENCE_BANDS } from "@/domain/changes/change-review-policy";
import { isCriticalStandardField } from "@/domain/standardization/standardization-service";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonArray, toInputJsonValue } from "@/lib/json/input-json";

const closeProposalSchema = z.object({
  runId: z.string().min(1),
  proposalId: z.string().min(1),
  action: z.enum(["REJECTED", "RETURNED", "NO_ACTION"]),
  reviewNote: z.string().min(1).max(1000),
});
const approveProposalSchema = z.object({
  runId: z.string().min(1),
  proposalId: z.string().min(1),
  confidence: z.enum(CONFIDENCE_BANDS).optional(),
  evidenceRefs: z.string().optional(),
  reviewNote: z.string().min(1).max(1000),
});
const confirmMappingSchema = z.object({
  runId: z.string().min(1),
  candidateId: z.string().min(1),
  confidence: z.enum(CONFIDENCE_BANDS),
  targetField: z.string().min(1).max(120),
  rationale: z.string().min(1).max(1000),
});
const confirmInputSchema = z.object({
  runId: z.string().min(1),
  inputId: z.string().min(1),
  expectedLockVersion: z.coerce.number().int().positive(),
  evidenceRefs: z.string().optional(),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
function evidenceList(value?: string) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function approveChangeProposalAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = approveProposalSchema.parse({
    runId: textValue(formData, "runId"),
    proposalId: textValue(formData, "proposalId"),
    confidence: textValue(formData, "confidence") || undefined,
    evidenceRefs: textValue(formData, "evidenceRefs"),
    reviewNote: textValue(formData, "reviewNote"),
  });
  const proposal = await prisma.changeProposal.findUnique({
    where: { id: body.proposalId },
    include: { payrollRun: { select: { clientId: true, status: true, lockedAt: true } } },
  });
  if (!proposal || proposal.runId !== body.runId) {
    throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
  }
  assertRunWritable(proposal.payrollRun);
  assertClientActionAllowed(actor, "updatePayrollRun", proposal.clientId);
  const refs = evidenceList(body.evidenceRefs);
  const evidenceRefs = refs.length > 0 ? refs : proposal.evidenceRefs;
  const confidence = body.confidence ?? proposal.confidence;
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
    const updated = await tx.changeProposal.update({
      where: { id: proposal.id },
      data: {
        status: body.confidence || refs.length > 0 ? "APPROVED_WITH_MODIFICATION" : "APPROVED",
        reviewedById: auditFields.actorUserId,
        reviewedAt,
        reviewNote: body.reviewNote,
        evidenceRefs,
        confidence,
      },
    });
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
        newValue: toInputJsonValue(proposal.proposedValue) ?? {},
        effectiveFrom: proposal.effectiveFrom,
        effectiveTo: proposal.effectiveTo,
        riskLevel: proposal.riskLevel,
        evidenceRefs,
        reviewNote: body.reviewNote,
        reviewedAt,
      },
    });
    await tx.auditLog.createMany({
      data: [
        {
          action: "CHANGE_PROPOSAL_REVIEWED",
          objectType: "CHANGE_PROPOSAL",
          objectId: proposal.id,
          riskLevel: proposal.riskLevel,
          ...auditFields,
          clientId: proposal.clientId,
          runId: proposal.runId,
          metadata: { status: updated.status, reviewNote: body.reviewNote },
        },
        {
          action: "CHANGE_LEDGER_ENTRY_CREATED",
          objectType: "CHANGE_LEDGER_ENTRY",
          objectId: ledgerEntry.id,
          riskLevel: ledgerEntry.riskLevel,
          ...auditFields,
          clientId: proposal.clientId,
          runId: proposal.runId,
          metadata: { proposalId: proposal.id, targetField: proposal.targetField },
        },
      ],
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
    reviewNote: textValue(formData, "reviewNote"),
  });
  const proposal = await prisma.changeProposal.findUnique({ where: { id: body.proposalId } });
  if (!proposal || proposal.runId !== body.runId) {
    throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
  }
  assertClientActionAllowed(actor, "updatePayrollRun", proposal.clientId);
  await prisma.$transaction([
    prisma.changeProposal.update({
      where: { id: proposal.id },
      data: {
        status: body.action,
        reviewedById: auditFields.actorUserId,
        reviewedAt: new Date(),
        reviewNote: body.reviewNote,
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "CHANGE_PROPOSAL_REVIEWED",
        objectType: "CHANGE_PROPOSAL",
        objectId: proposal.id,
        riskLevel: proposal.riskLevel,
        ...auditFields,
        clientId: proposal.clientId,
        runId: proposal.runId,
        metadata: { status: body.action, reviewNote: body.reviewNote },
      },
    }),
  ]);
  revalidatePath(`/payroll-runs/${body.runId}/changes`);
}
export async function confirmMappingCandidateAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = confirmMappingSchema.parse({
    runId: textValue(formData, "runId"),
    candidateId: textValue(formData, "candidateId"),
    confidence: textValue(formData, "confidence"),
    targetField: textValue(formData, "targetField"),
    rationale: textValue(formData, "rationale"),
  });
  if (body.confidence === "LOW" || body.confidence === "CONFLICT") {
    throw new Error("LOW_CONFIDENCE_MAPPING_REQUIRES_MANUAL_TARGET");
  }
  const candidate = await prisma.fieldMappingCandidate.findUnique({
    where: { id: body.candidateId },
    include: { payrollRun: { select: { clientId: true, status: true, lockedAt: true } } },
  });
  if (!candidate || candidate.runId !== body.runId) {
    throw new Error("FIELD_MAPPING_CANDIDATE_NOT_FOUND");
  }
  assertRunWritable(candidate.payrollRun);
  assertClientActionAllowed(actor, "updatePayrollRun", candidate.clientId);
  const maxVersion = await prisma.fieldMappingVersion.aggregate({
    where: {
      runId: candidate.runId,
      sourceSheetName: candidate.sourceSheetName,
      sourceColumnLabel: candidate.sourceColumnLabel,
    },
    _max: { versionNumber: true },
  });
  const version = await prisma.fieldMappingVersion.create({
    data: {
      clientId: candidate.clientId,
      runId: candidate.runId,
      candidateId: candidate.id,
      fileVersionId: candidate.fileVersionId,
      sheetId: candidate.sheetId,
      versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
      source: "MANUAL",
      sourceSheetName: candidate.sourceSheetName,
      sourceColumnLabel: candidate.sourceColumnLabel,
      sourceColumnIndex: candidate.sourceColumnIndex,
      targetField: body.targetField,
      fieldCategory: candidate.fieldCategory,
      confidence: body.confidence,
      rationale: body.rationale,
      evidenceRefs: candidate.evidenceRefs,
      confirmedById: auditFields.actorUserId,
    },
  });
  await prisma.fieldMappingCandidate.update({ where: { id: candidate.id }, data: { status: "CONFIRMED" } });
  await prisma.auditLog.create({
    data: {
      action: "FIELD_MAPPING_VERSION_CONFIRMED",
      objectType: "FIELD_MAPPING_VERSION",
      objectId: version.id,
      riskLevel: "R2",
      ...auditFields,
      clientId: version.clientId,
      runId: version.runId,
      metadata: { candidateId: candidate.id, targetField: version.targetField },
    },
  });
  revalidatePath(`/payroll-runs/${body.runId}/mappings`);
}
export async function confirmStandardizedInputAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = confirmInputSchema.parse({
    runId: textValue(formData, "runId"),
    inputId: textValue(formData, "inputId"),
    expectedLockVersion: textValue(formData, "expectedLockVersion"),
    evidenceRefs: textValue(formData, "evidenceRefs"),
  });
  const input = await prisma.standardizedPayrollInput.findUnique({ where: { id: body.inputId } });
  if (!input || input.runId !== body.runId) {
    throw new Error("STANDARDIZED_INPUT_NOT_FOUND");
  }
  assertClientActionAllowed(actor, "updatePayrollRun", input.clientId);
  if (input.optimisticLockVersion !== body.expectedLockVersion) {
    throw new Error("STANDARDIZED_INPUT_STALE_VERSION");
  }
  const evidenceRefs = evidenceList(body.evidenceRefs);
  const nextEvidenceRefs = evidenceRefs.length > 0 ? evidenceRefs : input.evidenceRefs;
  if (isCriticalStandardField(input.standardField) && nextEvidenceRefs.length === 0) {
    throw new Error("CRITICAL_STANDARDIZED_INPUT_EVIDENCE_REQUIRED");
  }
  const updated = await prisma.standardizedPayrollInput.update({
    where: { id: input.id },
    data: {
      status: "CONFIRMED",
      evidenceStatus: "VALID",
      evidenceRefs: nextEvidenceRefs,
      validationIssues: toInputJsonArray([]),
      optimisticLockVersion: input.optimisticLockVersion + 1,
      modifiedById: auditFields.actorUserId,
      confirmedById: auditFields.actorUserId,
      confirmedAt: new Date(),
    },
  });
  await prisma.auditLog.create({
    data: {
      action: "STANDARDIZED_INPUT_CONFIRMED",
      objectType: "STANDARDIZED_PAYROLL_INPUT",
      objectId: updated.id,
      riskLevel: "R2",
      ...auditFields,
      clientId: updated.clientId,
      runId: updated.runId,
      metadata: { standardField: updated.standardField },
    },
  });
  revalidatePath(`/payroll-runs/${body.runId}/mappings`);
}
function assertRunWritable(run: { status: string; lockedAt?: Date | null }) {
  if (["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(run.status) || run.lockedAt) {
    throw new Error("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
  }
}
