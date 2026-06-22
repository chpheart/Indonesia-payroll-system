import { type ReconciliationEvaluation } from "@/domain/reconciliation/reconciliation-service";
import { type HighRiskIssueDraft } from "@/domain/risks/risk-service";
import { type Prisma } from "@/generated/prisma/client";
import { toInputJsonArray } from "@/lib/json/input-json";

type RunForPhase11Persistence = {
  id: string;
  clientId: string;
};

export async function resetPhase11CalculationArtifacts(
  tx: Prisma.TransactionClient,
  run: RunForPhase11Persistence,
) {
  await tx.highRiskIssue.updateMany({
    where: { runId: run.id, status: "OPEN", targetObjectType: { not: "PRECHECK_RUN" } },
    data: { status: "VOIDED", approvalReason: "Superseded by newer payroll calculation." },
  });
  await tx.reconciliationCheck.deleteMany({ where: { runId: run.id } });
  await tx.payrollConfirmationPackage.updateMany({
    where: { runId: run.id, status: { in: ["DRAFT", "READY_FOR_REVIEW", "CONFIRMED"] } },
    data: {
      status: "INVALIDATED",
      invalidationReason: "算薪结果版本已重算，旧确认包不得用于锁定。",
      invalidatedAt: new Date(),
    },
  });
}

export async function persistReconciliationChecks(
  tx: Prisma.TransactionClient,
  run: RunForPhase11Persistence,
  resultVersionRef: string,
  reconciliation: ReconciliationEvaluation,
) {
  if (reconciliation.checks.length === 0) return;
  await tx.reconciliationCheck.createMany({
    data: reconciliation.checks.map((check) => ({
      clientId: run.clientId,
      runId: run.id,
      resultVersionRef,
      checkType: check.checkType,
      status: check.status,
      riskLevel: check.riskLevel,
      targetEmployeeId: check.targetEmployeeId,
      targetField: check.targetField,
      expectedValue: check.expectedValue,
      actualValue: check.actualValue,
      deltaValue: check.deltaValue,
      message: check.message,
      detail: check.detail,
      evidenceRefs: check.evidenceRefs,
      sourceRefs: toInputJsonArray(check.sourceRefs),
    })),
  });
}

export async function persistHighRiskIssues(
  tx: Prisma.TransactionClient,
  run: RunForPhase11Persistence,
  highRiskIssues: HighRiskIssueDraft[],
) {
  if (highRiskIssues.length === 0) return;
  await tx.highRiskIssue.createMany({
    data: highRiskIssues.map((issue) => ({
      clientId: run.clientId,
      runId: run.id,
      issueType: issue.issueType,
      riskLevel: issue.riskLevel,
      targetObjectType: issue.targetObjectType,
      targetObjectId: issue.targetObjectId,
      targetEmployeeId: issue.targetEmployeeId,
      targetField: issue.targetField,
      title: issue.title,
      detail: issue.detail,
      thresholdValue: issue.thresholdValue,
      actualValue: issue.actualValue,
      deltaValue: issue.deltaValue,
      evidenceRefs: issue.evidenceRefs,
      sourceRefs: toInputJsonArray(issue.sourceRefs),
    })),
  });
}
