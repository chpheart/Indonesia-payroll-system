"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentRequestContext } from "@/app/(app)/server-actor";
import {
  assertConfirmedStandardizationDependencies,
  assertReviewableStandardizedInput,
  assertRunWritable,
} from "@/app/(app)/payroll-runs/[runId]/phase8-action-guards";
import { evidenceList, textValue } from "@/app/(app)/payroll-runs/[runId]/phase8-form-utils";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  REVIEWABLE_STANDARDIZED_INPUT_STATUSES,
  isCriticalStandardField,
} from "@/domain/standardization/standardization-policy";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonArray } from "@/lib/json/input-json";

const confirmInputSchema = z.object({
  runId: z.string().min(1),
  inputId: z.string().min(1),
  expectedLockVersion: z.coerce.number().int().positive(),
  evidenceRefs: z.string().optional(),
});

export async function confirmStandardizedInputAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = confirmInputSchema.parse({
    runId: textValue(formData, "runId"),
    inputId: textValue(formData, "inputId"),
    expectedLockVersion: textValue(formData, "expectedLockVersion"),
    evidenceRefs: textValue(formData, "evidenceRefs"),
  });
  const input = await prisma.standardizedPayrollInput.findUnique({
    where: { id: body.inputId },
    include: {
      payrollRun: { select: { clientId: true, status: true, lockedAt: true } },
      fieldMappingVersion: { select: { clientId: true, runId: true, status: true, confidence: true } },
      employeeMatchCandidate: { select: { clientId: true, runId: true, status: true, employeeId: true } },
    },
  });
  if (!input || input.runId !== body.runId) throw new Error("STANDARDIZED_INPUT_NOT_FOUND");
  assertRunWritable(input.payrollRun);
  assertReviewableStandardizedInput(input.status);
  assertClientActionAllowed(actor, "updatePayrollRun", input.clientId);
  if (input.optimisticLockVersion !== body.expectedLockVersion) {
    throw new Error("STANDARDIZED_INPUT_STALE_VERSION");
  }

  const evidenceRefs = evidenceList(body.evidenceRefs);
  const nextEvidenceRefs = evidenceRefs.length > 0 ? evidenceRefs : input.evidenceRefs;
  if (isCriticalStandardField(input.standardField) && nextEvidenceRefs.length === 0) {
    throw new Error("CRITICAL_STANDARDIZED_INPUT_EVIDENCE_REQUIRED");
  }
  assertConfirmedStandardizationDependencies({
    clientId: input.clientId,
    runId: input.runId,
    fieldMappingVersionId: input.fieldMappingVersionId,
    fieldMappingVersion: input.fieldMappingVersion,
    employeeMatchCandidateId: input.employeeMatchCandidateId,
    employeeMatchCandidate: input.employeeMatchCandidate,
  });

  await prisma.$transaction(async (tx) => {
    const updated = await tx.standardizedPayrollInput.updateMany({
      where: {
        id: input.id,
        optimisticLockVersion: body.expectedLockVersion,
        status: { in: [...REVIEWABLE_STANDARDIZED_INPUT_STATUSES] },
      },
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
    if (updated.count !== 1) {
      throw new Error("STANDARDIZED_INPUT_STALE_VERSION");
    }
    await tx.auditLog.create({
      data: {
        action: "STANDARDIZED_INPUT_CONFIRMED",
        objectType: "STANDARDIZED_PAYROLL_INPUT",
        objectId: input.id,
        riskLevel: "R2",
        ...auditFields,
        clientId: input.clientId,
        runId: input.runId,
        metadata: { standardField: input.standardField },
      },
    });
  });
  revalidatePath(`/payroll-runs/${body.runId}/mappings`);
}
