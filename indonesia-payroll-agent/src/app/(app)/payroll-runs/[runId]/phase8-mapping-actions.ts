"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentRequestContext } from "@/app/(app)/server-actor";
import {
  assertReviewableMappingCandidate,
  assertRunWritable,
} from "@/app/(app)/payroll-runs/[runId]/phase8-action-guards";
import { textValue } from "@/app/(app)/payroll-runs/[runId]/phase8-form-utils";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { CONFIDENCE_BANDS } from "@/domain/changes/change-review-policy";
import { prisma } from "@/lib/db/prisma";

const confirmMappingSchema = z.object({
  runId: z.string().min(1),
  candidateId: z.string().min(1),
  confidence: z.enum(CONFIDENCE_BANDS),
  targetField: z.string().min(1).max(120),
  rationale: z.string().min(1).max(1000),
});

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
  if (!candidate || candidate.runId !== body.runId) throw new Error("FIELD_MAPPING_CANDIDATE_NOT_FOUND");
  assertRunWritable(candidate.payrollRun);
  assertReviewableMappingCandidate(candidate.status);
  assertClientActionAllowed(actor, "updatePayrollRun", candidate.clientId);

  await prisma.$transaction(async (tx) => {
    const claimResult = await tx.fieldMappingCandidate.updateMany({
      where: { id: candidate.id, status: "CANDIDATE" },
      data: { status: "CONFIRMED" },
    });
    if (claimResult.count !== 1) {
      throw new Error("FIELD_MAPPING_CANDIDATE_NOT_REVIEWABLE");
    }
    const maxVersion = await tx.fieldMappingVersion.aggregate({
      where: {
        runId: candidate.runId,
        sourceSheetName: candidate.sourceSheetName,
        sourceColumnLabel: candidate.sourceColumnLabel,
      },
      _max: { versionNumber: true },
    });
    const version = await tx.fieldMappingVersion.create({
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
    await tx.auditLog.create({
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
  });
  revalidatePath(`/payroll-runs/${body.runId}/mappings`);
}
