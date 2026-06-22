import { canPerformClientAction, type ActorContext } from "@/domain/auth/permissions";
import {
  employeeWithoutCalculablePayrollInputCount,
  grossUpOverrideEmployeeCount,
  isGrossUpOverrideInput,
  isNetPayModeInput,
  netPayModeWithoutGrossUpEmployeeCount,
} from "@/app/api/payroll-runs/[runId]/precheck/precheck-input-gates";
import {
  evaluatePayrollPrecheck,
  type PrecheckEvaluation,
  type PrecheckSnapshot,
} from "@/domain/prechecks/precheck-service";
import { isCriticalStandardField } from "@/domain/standardization/standardization-policy";
import { type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonArray, toInputJsonObject } from "@/lib/json/input-json";

type AuditFields = {
  actorUserId?: string;
  actorEmail: string;
  actorRoleCodes: string[];
  ipAddress?: string;
  userAgent?: string;
};

export type LoadedPrecheck = {
  run: {
    id: string;
    clientId: string;
    payrollMonth: string;
    status: string;
    lockedAt?: Date | null;
    pendingCustomerConfirmationCount: number;
  };
  evaluation: PrecheckEvaluation;
  ruleVersionSnapshot: Record<string, string | number | null>[];
  fxRateSnapshot: Record<string, string | number | null>[];
};

export async function loadPayrollPrecheck(runId: string, actor: ActorContext): Promise<LoadedPrecheck> {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      clientId: true,
      payrollMonth: true,
      status: true,
      lockedAt: true,
      pendingCustomerConfirmationCount: true,
    },
  });
  if (!run) throw new Error("PAYROLL_RUN_NOT_FOUND");

  const [rules, clientConfig, pendingProposalCount, approvedNoLedgerCount, mappingCount, lowConfidenceMappingCount, actorMaintainedKeyDataCount, inputs, confirmedFxRates, unconfirmedFxRates, latestPack, openBlockingIssueCount] = await Promise.all([
    prisma.ruleVersion.findMany({
      where: {
        status: "PUBLISHED",
        effectiveMonth: { lte: run.payrollMonth },
        OR: [{ scopeType: "PUBLIC" }, { clientId: run.clientId }],
      },
      orderBy: [{ ruleType: "asc" }, { versionNumber: "desc" }],
      select: { id: true, ruleType: true, ruleKey: true, scopeType: true, scopeKey: true, versionNumber: true, effectiveMonth: true, publishedAt: true },
    }),
    prisma.clientConfigVersion.findFirst({
      where: { clientId: run.clientId, status: "EFFECTIVE", effectiveMonth: { lte: run.payrollMonth } },
      orderBy: [{ effectiveMonth: "desc" }, { versionNumber: "desc" }],
      select: { id: true, grossUpDefault: true },
    }),
    prisma.changeProposal.count({ where: { runId, status: "PENDING_REVIEW" } }),
    prisma.changeProposal.count({
      where: { runId, status: { in: ["APPROVED", "APPROVED_WITH_MODIFICATION"] }, ledgerEntry: null },
    }),
    prisma.fieldMappingVersion.count({ where: { runId, status: "CONFIRMED" } }),
    prisma.fieldMappingVersion.count({
      where: { runId, status: "CONFIRMED", confidence: { in: ["LOW", "MEDIUM", "CONFLICT"] } },
    }),
    keyDataMaintainedByActorCount(runId, actor.id),
    prisma.standardizedPayrollInput.findMany({
      where: { runId },
      select: {
        status: true,
        employeeId: true,
        standardField: true,
        evidenceStatus: true,
        evidenceRefs: true,
        currencyCode: true,
        amount: true,
        componentCode: true,
        value: true,
        payrollComponent: {
          select: {
            componentType: true,
            taxableCash: true,
            bpjsHealthBase: true,
            bpjsEmploymentBase: true,
            paidOut: true,
            affectsNetPay: true,
            affectsEmployerCost: true,
          },
        },
      },
    }),
    prisma.fXRateVersion.findMany({
      where: { clientId: run.clientId, payrollMonth: run.payrollMonth, status: "CONFIRMED" },
      orderBy: [{ currencyCode: "asc" }, { versionNumber: "desc" }],
      select: { id: true, currencyCode: true, versionNumber: true, rate: true, confirmedAt: true },
    }),
    prisma.fXRateVersion.findMany({
      where: { clientId: run.clientId, payrollMonth: run.payrollMonth, status: { not: "CONFIRMED" } },
      select: { currencyCode: true },
    }),
    prisma.customerConfirmationPack.findFirst({
      where: { runId },
      orderBy: { versionNumber: "desc" },
      select: { id: true, status: true },
    }),
    prisma.blockingIssue.count({ where: { runId, status: "OPEN", source: { not: "PRECHECK" } } }),
  ]);

  const confirmedInputs = inputs.filter((input) => input.status === "CONFIRMED");
  const snapshot: PrecheckSnapshot = {
    run,
    actorCanExecuteCalculation: canPerformClientAction(actor, "executeCalculation", run.clientId),
    publishedRuleTypes: uniqueRuleTypes(rules.map((rule) => rule.ruleType)),
    publishedRuleCount: rules.length,
    effectiveClientConfigCount: clientConfig ? 1 : 0,
    clientGrossUpDefault: clientConfig?.grossUpDefault ?? false,
    pendingChangeProposalCount: pendingProposalCount,
    approvedProposalWithoutLedgerCount: approvedNoLedgerCount,
    confirmedMappingCount: mappingCount,
    confirmedStandardizedInputCount: confirmedInputs.length,
    unconfirmedStandardizedInputCount: inputs.length - confirmedInputs.length,
    criticalInputEvidenceMissingCount: confirmedInputs.filter((input) => isCriticalStandardField(input.standardField) && (input.evidenceStatus !== "VALID" || input.evidenceRefs.length === 0)).length,
    standardizedInputEmployeeMissingCount: confirmedInputs.filter((input) => !input.employeeId).length,
    employeeWithoutCalculablePayrollInputCount: employeeWithoutCalculablePayrollInputCount(
      confirmedInputs,
      clientConfig?.grossUpDefault ?? false,
    ),
    netPayModeInputCount: confirmedInputs.filter(isNetPayModeInput).length,
    grossUpOverrideInputCount: confirmedInputs.filter(isGrossUpOverrideInput).length,
    netPayModeWithoutGrossUpEmployeeCount: netPayModeWithoutGrossUpEmployeeCount(
      confirmedInputs,
      clientConfig?.grossUpDefault ?? false,
    ),
    grossUpEmployeeCount: grossUpOverrideEmployeeCount(confirmedInputs),
    foreignCurrencyEmployeeCount: new Set(
      confirmedInputs
        .filter((input) => input.currencyCode.toUpperCase() !== "IDR")
        .map((input) => input.employeeId)
        .filter(Boolean),
    ).size,
    customerTotalOnlyInputCount: confirmedInputs.filter((input) =>
      ["customerTotalGrossPay", "customerTotalOnlyPay", "customerGrossTotalOnly"].includes(input.standardField),
    ).length,
    lowConfidenceMappingCount,
    templateStructureRiskCount: numberInput(confirmedInputs, "exportPreviewEmployeeCount") === undefined ? 1 : 0,
    segregationOfDutyRiskCount: actorMaintainedKeyDataCount > 0 ? 1 : 0,
    requiredFxCurrencies: [...new Set(confirmedInputs.map((input) => input.currencyCode.toUpperCase()).filter((currency) => currency !== "IDR"))],
    confirmedFxCurrencies: [...new Set(confirmedFxRates.map((rate) => rate.currencyCode.toUpperCase()))],
    unconfirmedFxCurrencies: [...new Set(unconfirmedFxRates.map((rate) => rate.currencyCode.toUpperCase()))],
    latestCustomerConfirmationPack: latestPack,
    openBlockingIssueCount,
  };

  return {
    run,
    evaluation: evaluatePayrollPrecheck(snapshot),
    ruleVersionSnapshot: rules.map((rule) => ({
      id: rule.id,
      ruleKey: rule.ruleKey,
      ruleType: rule.ruleType,
      scopeType: rule.scopeType,
      scopeKey: rule.scopeKey,
      versionNumber: rule.versionNumber,
      effectiveMonth: rule.effectiveMonth,
      publishedAt: rule.publishedAt?.toISOString() ?? null,
    })),
    fxRateSnapshot: confirmedFxRates.map((rate) => ({
      id: rate.id,
      currencyCode: rate.currencyCode,
      versionNumber: rate.versionNumber,
      rate: rate.rate.toString(),
      confirmedAt: rate.confirmedAt?.toISOString() ?? null,
    })),
  };
}

export async function persistPayrollPrecheck(
  tx: Prisma.TransactionClient,
  loaded: LoadedPrecheck,
  auditFields: AuditFields,
) {
  const createdAt = new Date();
  await tx.blockingIssue.updateMany({
    where: { runId: loaded.run.id, source: "PRECHECK", status: "OPEN" },
    data: { status: "RESOLVED", resolutionNote: "被新的预检查运行替代", resolvedById: auditFields.actorUserId, resolvedAt: createdAt },
  });
  await tx.highRiskIssue.updateMany({
    where: { runId: loaded.run.id, status: "OPEN", targetObjectType: "PRECHECK_RUN" },
    data: { status: "VOIDED", approvalReason: "被新的预检查运行替代" },
  });
  const precheck = await tx.precheckRun.create({
    data: {
      clientId: loaded.run.clientId,
      runId: loaded.run.id,
      status: loaded.evaluation.status,
      gateResults: toInputJsonArray(loaded.evaluation.gates),
      issueCount: loaded.evaluation.issues.length,
      runById: auditFields.actorUserId,
      passedAt: loaded.evaluation.status === "PASSED" ? createdAt : null,
    },
  });
  if (loaded.evaluation.issues.length > 0) {
    await tx.blockingIssue.createMany({
      data: loaded.evaluation.issues.map((issue) => ({
        clientId: loaded.run.clientId,
        runId: loaded.run.id,
        precheckRunId: precheck.id,
        source: "PRECHECK",
        issueType: issue.issueType,
        status: "OPEN",
        riskLevel: issue.riskLevel,
        targetObjectType: issue.targetObjectType,
        targetObjectId: issue.targetObjectId,
        targetEmployeeId: issue.targetEmployeeId,
        targetField: issue.targetField,
        title: issue.title,
        detail: issue.detail,
        evidenceRefs: issue.evidenceRefs,
      })),
    });
  }
  if (loaded.evaluation.highRiskIssues.length > 0) {
    await tx.highRiskIssue.createMany({
      data: loaded.evaluation.highRiskIssues.map((issue) => ({
        clientId: loaded.run.clientId,
        runId: loaded.run.id,
        issueType: issue.issueType,
        status: "OPEN",
        riskLevel: issue.riskLevel,
        targetObjectType: issue.targetObjectType ?? "PRECHECK_RUN",
        targetObjectId: issue.targetObjectId ?? precheck.id,
        targetEmployeeId: issue.targetEmployeeId,
        targetField: issue.targetField,
        title: issue.title,
        detail: issue.detail,
        evidenceRefs: issue.evidenceRefs,
      })),
    });
  }
  const openBlockingIssueCount = await tx.blockingIssue.count({
    where: { runId: loaded.run.id, status: "OPEN" },
  });
  const openHighRiskIssueCount = await tx.highRiskIssue.count({
    where: { runId: loaded.run.id, status: "OPEN" },
  });
  await tx.payrollRun.update({
    where: { id: loaded.run.id },
    data: {
      ruleVersionSnapshot: toInputJsonArray(loaded.ruleVersionSnapshot),
      fxRateSnapshot: toInputJsonArray(loaded.fxRateSnapshot),
      precheckSnapshot: toInputJsonObject({
        generatedAt: createdAt.toISOString(),
        status: loaded.evaluation.status,
        gateCount: loaded.evaluation.gates.length,
        issueCount: openBlockingIssueCount,
      }),
      blockingIssueCount: openBlockingIssueCount,
      highRiskIssueCount: openHighRiskIssueCount,
    },
  });
  await tx.auditLog.create({
    data: {
      action: "PRECHECK_RUN_CREATED",
      objectType: "PRECHECK_RUN",
      objectId: precheck.id,
      riskLevel: loaded.evaluation.status === "PASSED" ? "R1" : "R3",
      ...auditFields,
      clientId: loaded.run.clientId,
      runId: loaded.run.id,
      metadata: {
        status: loaded.evaluation.status,
        issueCount: loaded.evaluation.issues.length,
        highRiskIssueCount: loaded.evaluation.highRiskIssues.length,
        blockedGates: loaded.evaluation.gates.filter((gate) => gate.status === "BLOCKED").map((gate) => gate.code),
      },
    },
  });
  return precheck;
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

function numberInput(inputs: { standardField: string; amount: unknown }[], field: string) {
  const amount = inputs.find((input) => input.standardField === field)?.amount;
  if (amount === null || amount === undefined) return undefined;
  const value = Number(amount);
  return Number.isFinite(value) ? value : undefined;
}

function uniqueRuleTypes(values: string[]) {
  const allowed = new Set(["PPH21", "BPJS", "THR", "GROSS_UP", "ROUNDING"] as const);
  return [...new Set(values)].filter((value): value is "PPH21" | "BPJS" | "THR" | "GROSS_UP" | "ROUNDING" =>
    allowed.has(value as "PPH21"),
  );
}
