"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { buildPayrollConfirmationPackage } from "@/domain/confirmation-package/package-service";
import { evaluateRiskApprovalGate } from "@/domain/risks/risk-service";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { loadPayrollConfirmationData } from "@/app/(app)/payroll-runs/[runId]/phase11-confirmation-data";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";

const approveRiskSchema = z.object({
  runId: z.string().min(1),
  issueId: z.string().min(1),
  reason: z.string().min(10).max(1000),
});

const generatePackageSchema = z.object({
  runId: z.string().min(1),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function approveHighRiskIssueAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = approveRiskSchema.parse({
    runId: textValue(formData, "runId"),
    issueId: textValue(formData, "issueId"),
    reason: textValue(formData, "reason"),
  });
  const issue = await prisma.highRiskIssue.findUnique({
    where: { id: body.issueId },
    include: { payrollRun: true },
  });
  if (!issue || issue.runId !== body.runId) {
    throw new Error("HIGH_RISK_ISSUE_NOT_FOUND");
  }

  const actorMaintainedKeyDataCount = await keyDataMaintainedByActorCount(issue.runId, actor.id);
  const gate = evaluateRiskApprovalGate(actor, issue.clientId, { actorMaintainedKeyDataCount });
  if (!gate.allowed) {
    throw new Error(gate.code);
  }

  await assertClientActionAllowed(actor, "releaseHighRisk", issue.clientId);
  await prisma.$transaction(async (tx) => {
    await tx.riskApproval.create({
      data: {
        clientId: issue.clientId,
        runId: issue.runId,
        issueId: issue.id,
        decision: "APPROVED",
        reason: body.reason,
        approverRoleCodes: actor.roleCodes,
        approvedById: auditFields.actorUserId,
        approvalSnapshot: {
          issueType: issue.issueType,
          riskLevel: issue.riskLevel,
          targetEmployeeId: issue.targetEmployeeId,
          targetField: issue.targetField,
          previousStatus: issue.status,
        },
      },
    });
    await tx.highRiskIssue.update({
      where: { id: issue.id },
      data: { status: "APPROVED", approvalReason: body.reason },
    });
    const openCount = await tx.highRiskIssue.count({
      where: { runId: issue.runId, status: "OPEN" },
    });
    await tx.payrollRun.update({
      where: { id: issue.runId },
      data: { highRiskIssueCount: openCount },
    });
    await tx.auditLog.create({
      data: {
        action: "HIGH_RISK_RELEASED",
        objectType: "HIGH_RISK_ISSUE",
        objectId: issue.id,
        riskLevel: issue.riskLevel,
        ...auditFields,
        clientId: issue.clientId,
        runId: issue.runId,
        metadata: {
          issueType: issue.issueType,
          reason: body.reason,
          approvalGate: gate.code,
          actorMaintainedKeyDataCount,
        },
      },
    });
  });

  revalidatePath(`/payroll-runs/${issue.runId}`);
  revalidatePath(`/payroll-runs/${issue.runId}/confirmation`);
}

export async function generatePayrollConfirmationPackageAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = generatePackageSchema.parse({ runId: textValue(formData, "runId") });
  const data = await loadPayrollConfirmationData(actor, body.runId);
  if (!data) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  assertClientActionAllowed(actor, "updatePayrollRun", data.run.clientId);
  const draft = buildPayrollConfirmationPackage(data.packageInput);
  const nextVersion = await prisma.payrollConfirmationPackage.count({
    where: { runId: data.run.id },
  }) + 1;

  await prisma.$transaction([
    prisma.payrollConfirmationPackage.create({
      data: {
        clientId: data.run.clientId,
        runId: data.run.id,
        versionNumber: nextVersion,
        status: draft.status,
        resultVersionRef: data.packageInput.resultVersionRef,
        sourceSnapshot: {
          status: data.run.status,
          generatedFrom: "phase11-confirmation-page",
        },
        summary: draft.summary as Prisma.InputJsonValue,
        drilldown: draft.drilldown as Prisma.InputJsonValue,
        gateSnapshot: draft.gateSnapshot as Prisma.InputJsonValue,
        previewDiff: draft.previewDiff as Prisma.InputJsonValue,
        auditEntryRefs: draft.auditEntryRefs,
        generatedById: auditFields.actorUserId,
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "PAYROLL_CONFIRMATION_PACKAGE_CREATED",
        objectType: "PAYROLL_CONFIRMATION_PACKAGE",
        objectId: `${data.run.id}:v${nextVersion}`,
        riskLevel: draft.status === "READY_FOR_REVIEW" ? "R2" : "R3",
        ...auditFields,
        clientId: data.run.clientId,
        runId: data.run.id,
        metadata: {
          versionNumber: nextVersion,
          status: draft.status,
          gateSnapshot: draft.gateSnapshot as Prisma.InputJsonValue,
        },
      },
    }),
  ]);

  revalidatePath(`/payroll-runs/${data.run.id}`);
  revalidatePath(`/payroll-runs/${data.run.id}/confirmation`);
}

async function keyDataMaintainedByActorCount(runId: string, actorId: string) {
  const [ledger, mappings, inputs] = await Promise.all([
    prisma.changeLedgerEntry.count({ where: { runId, reviewedById: actorId } }),
    prisma.fieldMappingVersion.count({ where: { runId, confirmedById: actorId } }),
    prisma.standardizedPayrollInput.count({
      where: { runId, OR: [{ confirmedById: actorId }, { modifiedById: actorId }] },
    }),
  ]);
  return ledger + mappings + inputs;
}
