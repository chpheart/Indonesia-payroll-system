import { assertClientActionAllowed, type ActorContext } from "@/domain/auth/permissions";
import {
  buildPayrollConfirmationPackage,
  type PayrollConfirmationInput,
} from "@/domain/confirmation-package/package-service";
import { prisma } from "@/lib/db/prisma";
import { buildPhase11Traceability } from "./phase11-traceability";

export async function loadPayrollConfirmationData(actor: ActorContext, runId: string) {
  const run = await fetchPayrollConfirmationRun(runId);
  if (!run) return null;
  assertClientActionAllowed(actor, "viewClient", run.clientId);
  const input = toConfirmationInput(run);
  return {
    run,
    latestPackageDraft: buildPayrollConfirmationPackage(input),
    packageInput: input,
  };
}

async function fetchPayrollConfirmationRun(runId: string) {
  return prisma.payrollRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      clientId: true,
      payrollMonth: true,
      status: true,
      blockingIssueCount: true,
      highRiskIssueCount: true,
      pendingCustomerConfirmationCount: true,
      ruleVersionSnapshot: true,
      client: { select: { code: true, name: true } },
      payrollResults: {
        where: { status: "FINAL" },
        select: {
          id: true,
          employeeId: true,
          resultVersionRef: true,
          grossPay: true,
          netPay: true,
          pph21: true,
          bpjsHealthEmployee: true,
          bpjsEmploymentEmployee: true,
          bpjsHealthEmployer: true,
          bpjsEmploymentEmployer: true,
          employerCost: true,
          employee: { select: { employeeCode: true, fullName: true, status: true } },
          _count: { select: { lines: true, traces: true } },
        },
        orderBy: [{ resultVersionRef: "desc" }, { employeeId: "asc" }],
      },
      customerComparisonValues: {
        where: { status: "DIFF" },
        select: { employeeId: true },
      },
      changeLedgerEntries: {
        select: {
          id: true,
          entryType: true,
          targetEmployeeId: true,
          targetObjectType: true,
          targetField: true,
          riskLevel: true,
          reviewedAt: true,
          evidenceRefs: true,
        },
        orderBy: { reviewedAt: "desc" },
        take: 50,
      },
      fieldMappingVersions: {
        where: { status: "CONFIRMED" },
        select: {
          id: true,
          sourceSheetName: true,
          sourceColumnLabel: true,
          targetField: true,
          confidence: true,
          evidenceRefs: true,
        },
        take: 80,
      },
      standardizedInputs: {
        where: { status: "CONFIRMED" },
        select: {
          id: true,
          employeeId: true,
          standardField: true,
          currencyCode: true,
          value: true,
          sourceSheetName: true,
          sourceRowIndex: true,
          sourceCellId: true,
          evidenceRefs: true,
        },
        take: 120,
      },
      rawInputItems: {
        select: {
          id: true,
          sourceChannel: true,
          inputType: true,
          redactedSummary: true,
          attachmentFileName: true,
          securityFlags: true,
        },
        take: 50,
      },
      uploadedFileVersions: {
        select: {
          id: true,
          fileName: true,
          purpose: true,
          versionNumber: true,
          parseStatus: true,
        },
        take: 50,
      },
      highRiskIssues: {
        select: {
          id: true,
          issueType: true,
          status: true,
          riskLevel: true,
          targetEmployeeId: true,
          targetField: true,
          title: true,
          detail: true,
          approvalReason: true,
          evidenceRefs: true,
          approvals: {
            select: {
              id: true,
              decision: true,
              reason: true,
              createdAt: true,
              approvedBy: { select: { displayName: true, email: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      },
      reconciliationChecks: {
        select: {
          id: true,
          checkType: true,
          status: true,
          riskLevel: true,
          targetEmployeeId: true,
          targetField: true,
          expectedValue: true,
          actualValue: true,
          deltaValue: true,
          message: true,
          detail: true,
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      },
      customerConfirmationPacks: {
        select: {
          id: true,
          status: true,
          versionNumber: true,
          items: {
            where: { status: "OPEN", OR: [{ isCritical: true }, { isSystemRequired: true }] },
            select: { id: true },
          },
          confirmations: {
            where: { status: "VALID" },
            select: { id: true },
          },
        },
        orderBy: { versionNumber: "desc" },
        take: 1,
      },
      payrollConfirmationPackages: {
        select: {
          id: true,
          versionNumber: true,
          status: true,
          resultVersionRef: true,
          summary: true,
          gateSnapshot: true,
          previewDiff: true,
          generatedAt: true,
          generatedBy: { select: { displayName: true, email: true } },
        },
        orderBy: { versionNumber: "desc" },
        take: 3,
      },
      auditLogs: {
        where: {
          action: {
            in: [
              "PAYROLL_RESULT_CREATED",
              "PRECHECK_RUN_CREATED",
              "BLOCKING_ISSUE_RESOLVED",
              "HIGH_RISK_RELEASED",
              "CUSTOMER_CONFIRMATION_RECORDED",
            ],
          },
        },
        select: { id: true, action: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

function toConfirmationInput(
  run: NonNullable<Awaited<ReturnType<typeof fetchPayrollConfirmationRun>>>,
) {
  const latestCustomerPack = run.customerConfirmationPacks[0];
  const latestResultVersion = run.payrollResults[0]?.resultVersionRef ?? "missing-result";
  const comparisonDiffCountByEmployee = new Map<string, number>();
  for (const comparison of run.customerComparisonValues) {
    if (!comparison.employeeId) continue;
    comparisonDiffCountByEmployee.set(
      comparison.employeeId,
      (comparisonDiffCountByEmployee.get(comparison.employeeId) ?? 0) + 1,
    );
  }
  const grossUpEmployeeIds = new Set(
    run.standardizedInputs
      .filter((input) => input.employeeId && isGrossUpInput(input))
      .map((input) => input.employeeId),
  );
  const foreignCurrencyEmployeeIds = new Set(
    run.standardizedInputs
      .filter((input) => input.employeeId && input.currencyCode.trim().toUpperCase() !== "IDR")
      .map((input) => input.employeeId),
  );
  return {
    run: {
      id: run.id,
      clientId: run.clientId,
      clientCode: run.client.code,
      clientName: run.client.name,
      payrollMonth: run.payrollMonth,
      blockingIssueCount: run.blockingIssueCount,
      highRiskIssueCount: run.highRiskIssueCount,
      pendingCustomerConfirmationCount: run.pendingCustomerConfirmationCount,
      status: run.status,
    },
    resultVersionRef: latestResultVersion,
    results: run.payrollResults.map((result) => ({
      id: result.id,
      employeeId: result.employeeId,
      employeeCode: result.employee.employeeCode,
      fullName: result.employee.fullName,
      employeeStatus: result.employee.status,
      grossPay: Number(result.grossPay),
      netPay: Number(result.netPay),
      pph21: Number(result.pph21),
      bpjsHealthEmployee: Number(result.bpjsHealthEmployee),
      bpjsEmploymentEmployee: Number(result.bpjsEmploymentEmployee),
      bpjsHealthEmployer: Number(result.bpjsHealthEmployer),
      bpjsEmploymentEmployer: Number(result.bpjsEmploymentEmployer),
      employerCost: Number(result.employerCost),
      traceCount: result._count.traces,
      lineCount: result._count.lines,
      comparisonDiffCount: comparisonDiffCountByEmployee.get(result.employeeId) ?? 0,
      isGrossUpEmployee: grossUpEmployeeIds.has(result.employeeId),
      hasForeignCurrencyInput: foreignCurrencyEmployeeIds.has(result.employeeId),
    })),
    highRiskIssues: run.highRiskIssues.map((issue) => ({
      id: issue.id,
      issueType: issue.issueType,
      status: issue.status,
      riskLevel: issue.riskLevel,
      targetEmployeeId: issue.targetEmployeeId,
      targetField: issue.targetField,
      title: issue.title,
      detail: issue.detail,
      approvalReason: issue.approvalReason,
      evidenceRefs: issue.evidenceRefs,
    })),
    reconciliationChecks: run.reconciliationChecks.map((check) => ({
      id: check.id,
      checkType: check.checkType,
      status: check.status,
      riskLevel: check.riskLevel,
      targetEmployeeId: check.targetEmployeeId,
      targetField: check.targetField,
      message: check.message,
      detail: check.detail,
    })),
    customerConfirmationSummary: {
      latestPackId: latestCustomerPack?.id ?? null,
      latestPackStatus: latestCustomerPack?.status ?? null,
      openCriticalItemCount: latestCustomerPack?.items.length ?? 0,
      validConfirmationCount: latestCustomerPack?.confirmations.length ?? 0,
    },
    traceability: buildPhase11Traceability(run),
    auditEntryRefs: run.auditLogs.map((audit) => audit.id),
  } satisfies PayrollConfirmationInput;
}

function isGrossUpInput(input: { standardField: string; value: unknown }) {
  const value = asRecord(input.value).value ?? asRecord(input.value).enabled;
  return /grossUpOverride/i.test(input.standardField) && value === true;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
