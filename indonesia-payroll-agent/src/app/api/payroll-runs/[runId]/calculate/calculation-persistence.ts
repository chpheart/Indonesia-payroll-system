import {
  type PayrollEngineOutput,
  type PayrollResultDraft,
} from "@/domain/payroll-engine/engine-types";
import { type PostCalculationEvaluation } from "@/domain/payroll-engine/postcheck";
import { assertTraceSetComplete } from "@/domain/payroll-engine/trace-completeness";
import { PAYROLL_RUN_STATUSES, type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";
import { type ReconciliationEvaluation } from "@/domain/reconciliation/reconciliation-service";
import { type HighRiskIssueDraft } from "@/domain/risks/risk-service";
import { type Prisma } from "@/generated/prisma/client";
import { toInputJsonArray, toInputJsonObject } from "@/lib/json/input-json";
import {
  persistHighRiskIssues,
  persistReconciliationChecks,
  resetPhase11CalculationArtifacts,
} from "./calculation-phase11-persistence";

type AuditFields = {
  actorUserId?: string;
  actorEmail: string;
  actorRoleCodes: string[];
  ipAddress?: string;
  userAgent?: string;
};

type RunForPersistence = {
  id: string;
  clientId: string;
  status: string;
};

export async function persistPayrollCalculation(
  tx: Prisma.TransactionClient,
  run: RunForPersistence,
  output: PayrollEngineOutput,
  reconciliation: ReconciliationEvaluation,
  highRiskIssues: HighRiskIssueDraft[],
  auditFields: AuditFields,
) {
  await tx.payrollResult.updateMany({
    where: { runId: run.id, status: "FINAL" },
    data: { status: "INVALIDATED", invalidatedAt: new Date() },
  });
  await resetPhase11CalculationArtifacts(tx, run);

  for (const result of output.results) {
    await createPayrollResult(tx, run, result, auditFields);
  }
  await persistReconciliationChecks(tx, run, output.resultVersionRef, reconciliation);
  await persistHighRiskIssues(tx, run, highRiskIssues);
  const openHighRiskIssueCount = await tx.highRiskIssue.count({
    where: { runId: run.id, status: "OPEN" },
  });
  const nextStatus = openHighRiskIssueCount > 0
    ? "PENDING_HIGH_RISK_RELEASE"
    : "PENDING_PAYROLL_CONFIRMATION";

  await tx.payrollRun.update({
    where: { id: run.id },
    data: {
      status: nextStatus,
      statusReason: openHighRiskIssueCount > 0
        ? "Phase 11 high risk release required before payroll confirmation"
        : "Phase 11 reconciliation completed",
      blockingIssueCount: 0,
      highRiskIssueCount: openHighRiskIssueCount,
    },
  });
  await tx.runStatusEvent.create({
    data: {
      runId: run.id,
      fromStatus: statusForEvent(run.status),
      toStatus: nextStatus,
      sourceType: "PAYROLL_RESULT",
      reason: openHighRiskIssueCount > 0
        ? "Phase 11 reconciliation created high risk release gate"
        : "Phase 11 reconciliation completed without open high risk",
      triggeredById: auditFields.actorUserId,
      metadata: {
        resultVersionRef: output.resultVersionRef,
        reconciliationCheckCount: reconciliation.checks.length,
        highRiskIssueCount: openHighRiskIssueCount,
      },
    },
  });
}

function statusForEvent(status: string): PayrollRunStatus {
  if (PAYROLL_RUN_STATUSES.includes(status as PayrollRunStatus)) {
    return status as PayrollRunStatus;
  }
  throw new Error("PAYROLL_RUN_STATUS_INVALID");
}

export async function persistPostCalculationBlockers(
  tx: Prisma.TransactionClient,
  run: RunForPersistence,
  postcheck: PostCalculationEvaluation,
  auditFields: AuditFields,
) {
  if (postcheck.issues.length === 0) return;
  await tx.blockingIssue.createMany({
    data: postcheck.issues.map((issue) => ({
      clientId: run.clientId,
      runId: run.id,
      source: "CALCULATION",
      issueType: issue.issueType,
      status: "OPEN",
      riskLevel: issue.riskLevel,
      targetEmployeeId: issue.targetEmployeeId,
      targetField: issue.targetField,
      title: issue.title,
      detail: issue.detail,
    })),
  });
  const openBlockingIssueCount = await tx.blockingIssue.count({
    where: { runId: run.id, status: "OPEN" },
  });
  await tx.payrollRun.update({
    where: { id: run.id },
    data: {
      blockingIssueCount: openBlockingIssueCount,
      statusReason: "Phase 10 post-calculation check blocked calculation",
    },
  });
  await tx.auditLog.create({
    data: {
      action: "BLOCKING_ISSUE_CREATED",
      objectType: "PAYROLL_RUN",
      objectId: run.id,
      riskLevel: "R4",
      ...auditFields,
      clientId: run.clientId,
      runId: run.id,
      metadata: {
        source: "CALCULATION",
        issueCount: postcheck.issues.length,
        blockedChecks: postcheck.checks.filter((check) => check.status === "BLOCKED").map((check) => check.code),
      },
    },
  });
}

export async function persistCalculationErrorBlocker(
  tx: Prisma.TransactionClient,
  run: RunForPersistence,
  errorCode: string,
  auditFields: AuditFields,
) {
  await tx.blockingIssue.create({
    data: {
      clientId: run.clientId,
      runId: run.id,
      source: "CALCULATION",
      issueType: errorCode,
      status: "OPEN",
      riskLevel: "R4",
      title: "算薪引擎执行失败",
      detail: `算薪引擎在生成 PayrollResult 前 fail closed：${errorCode}`,
    },
  });
  const openBlockingIssueCount = await tx.blockingIssue.count({
    where: { runId: run.id, status: "OPEN" },
  });
  await tx.payrollRun.update({
    where: { id: run.id },
    data: {
      blockingIssueCount: openBlockingIssueCount,
      statusReason: "Phase 10 calculation engine failed closed",
    },
  });
  await tx.auditLog.create({
    data: {
      action: "BLOCKING_ISSUE_CREATED",
      objectType: "PAYROLL_RUN",
      objectId: run.id,
      riskLevel: "R4",
      ...auditFields,
      clientId: run.clientId,
      runId: run.id,
      metadata: { source: "CALCULATION", errorCode },
    },
  });
}

function assertTraceComplete(result: PayrollResultDraft) {
  assertTraceSetComplete(result.traces);
}

async function createPayrollResult(
  tx: Prisma.TransactionClient,
  run: RunForPersistence,
  result: PayrollResultDraft,
  auditFields: AuditFields,
) {
  assertTraceComplete(result);
  const created = await tx.payrollResult.create({
    data: {
      clientId: run.clientId,
      runId: run.id,
      employeeId: result.employeeId,
      resultVersionRef: result.resultVersionRef,
      grossPay: result.grossPay,
      taxableIncome: result.taxableIncome,
      pph21: result.pph21,
      bpjsHealthEmployee: result.bpjsHealthEmployee,
      bpjsEmploymentEmployee: result.bpjsEmploymentEmployee,
      bpjsHealthEmployer: result.bpjsHealthEmployer,
      bpjsEmploymentEmployer: result.bpjsEmploymentEmployer,
      totalDeductions: result.totalDeductions,
      netPay: result.netPay,
      employerCost: result.employerCost,
      currencyCode: result.currencyCode,
      sourceVersionSnapshot: toInputJsonObject(result.sourceVersionSnapshot),
      calculatedById: auditFields.actorUserId,
      lines: {
        create: result.lines.map((line) => ({
          clientId: run.clientId,
          runId: run.id,
          employeeId: result.employeeId,
          lineType: line.lineType,
          componentCode: line.componentCode,
          label: line.label,
          amount: line.amount,
          currencyCode: line.currencyCode,
          taxableCash: line.taxableCash,
          bpjsHealthBase: line.bpjsHealthBase,
          bpjsEmploymentBase: line.bpjsEmploymentBase,
          paidOut: line.paidOut,
          affectsNetPay: line.affectsNetPay,
          affectsEmployerCost: line.affectsEmployerCost,
          sourceInputIds: line.sourceInputIds,
          ruleVersionRefs: line.ruleVersionRefs,
          traceRef: line.traceRef,
        })),
      },
      traces: {
        create: result.traces.map((trace) => ({
          clientId: run.clientId,
          runId: run.id,
          employeeId: result.employeeId,
          resultField: trace.resultField,
          traceType: trace.traceType,
          inputRefs: toInputJsonArray(trace.inputRefs),
          ruleVersionRefs: trace.ruleVersionRefs,
          formula: trace.formula,
          parameters: toInputJsonObject(trace.parameters),
          intermediateValues: toInputJsonObject(trace.intermediateValues),
          rounding: toInputJsonObject(trace.rounding),
          outputValue: trace.outputValue,
        })),
      },
    },
  });

  if (result.comparisonValues.length > 0) {
    await tx.customerComparisonValue.createMany({
      data: result.comparisonValues.map((comparison) => ({
        clientId: run.clientId,
        runId: run.id,
        employeeId: comparison.employeeId,
        sourceInputId: comparison.sourceInputId,
        targetField: comparison.targetField,
        customerValue: comparison.customerValue,
        systemValue: comparison.systemValue,
        delta: comparison.delta,
        status: comparison.status,
        currencyCode: comparison.currencyCode,
        sourceLabel: comparison.sourceLabel,
        sourceCellId: comparison.sourceCellId,
        resultVersionRef: result.resultVersionRef,
      })),
    });
  }

  await tx.auditLog.create({
    data: {
      action: "PAYROLL_RESULT_CREATED",
      objectType: "PAYROLL_RESULT",
      objectId: created.id,
      riskLevel: "R3",
      ...auditFields,
      clientId: run.clientId,
      runId: run.id,
      metadata: {
        employeeId: result.employeeId,
        resultVersionRef: result.resultVersionRef,
        traceCount: result.traces.length,
        comparisonValueCount: result.comparisonValues.length,
      },
    },
  });
}
