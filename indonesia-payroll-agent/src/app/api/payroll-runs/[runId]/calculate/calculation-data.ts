import {
  loadPayrollPrecheck,
  type LoadedPrecheck,
} from "@/app/api/payroll-runs/[runId]/precheck/precheck-data";
import { type ActorContext } from "@/domain/auth/permissions";
import {
  type FXRateRef,
  type PayrollEngineInput,
  type PayrollRuleRef,
} from "@/domain/payroll-engine/engine-types";
import { prisma } from "@/lib/db/prisma";

type BpjsBillEmployeeItem = NonNullable<
  NonNullable<PayrollEngineInput["postcheckContext"]>["bpjsBillEmployeeItems"]
>[number];

export type CalculationGate = {
  loadedPrecheck: LoadedPrecheck;
  resultVersionRef: string;
};

export async function assertCalculationGate(
  runId: string,
  actor: ActorContext,
): Promise<CalculationGate> {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!run) throw new Error("PAYROLL_RUN_NOT_FOUND");
  if (run.status !== "PENDING_CALCULATION") {
    throw new Error("PAYROLL_RUN_NOT_READY_FOR_CALCULATION");
  }

  const latestPrecheck = await prisma.precheckRun.findFirst({
    where: { runId },
    orderBy: { createdAt: "desc" },
  });
  if (!latestPrecheck) throw new Error("PAYROLL_PRECHECK_REQUIRED");
  if (latestPrecheck.status !== "PASSED") throw new Error("PAYROLL_PRECHECK_BLOCKED");

  const openBlockingIssueCount = await prisma.blockingIssue.count({
    where: { runId, status: "OPEN" },
  });
  if (openBlockingIssueCount > 0) throw new Error("PAYROLL_BLOCKING_ISSUES_OPEN");

  const loadedPrecheck = await loadPayrollPrecheck(runId, actor);
  if (loadedPrecheck.evaluation.status !== "PASSED") {
    throw new Error("PAYROLL_PRECHECK_STALE_OR_BLOCKED");
  }

  return {
    loadedPrecheck,
    resultVersionRef: `run:${runId}:calc:${new Date().toISOString()}`,
  };
}

export async function loadCalculationInput(
  gate: CalculationGate,
): Promise<PayrollEngineInput> {
  const run = gate.loadedPrecheck.run;
  const [clientConfig, rules, fxRates, inputs, previousRun] = await Promise.all([
    prisma.clientConfigVersion.findFirst({
      where: { clientId: run.clientId, status: "EFFECTIVE", effectiveMonth: { lte: run.payrollMonth } },
      orderBy: [{ effectiveMonth: "desc" }, { versionNumber: "desc" }],
    }),
    prisma.ruleVersion.findMany({
      where: {
        status: "PUBLISHED",
        effectiveMonth: { lte: run.payrollMonth },
        OR: [{ scopeType: "PUBLIC" }, { clientId: run.clientId }],
      },
      orderBy: [{ ruleType: "asc" }, { versionNumber: "desc" }],
    }),
    prisma.fXRateVersion.findMany({
      where: { clientId: run.clientId, payrollMonth: run.payrollMonth, status: "CONFIRMED" },
      orderBy: [{ currencyCode: "asc" }, { versionNumber: "desc" }],
    }),
    prisma.standardizedPayrollInput.findMany({
      where: { runId: run.id, status: "CONFIRMED" },
      include: {
        employee: { select: { id: true, employeeCode: true, fullName: true, status: true, npwp: true } },
        payrollComponent: true,
      },
    }),
    prisma.payrollRun.findFirst({
      where: {
        clientId: run.clientId,
        payrollMonth: { lt: run.payrollMonth },
        payrollResults: { some: { status: "FINAL" } },
      },
      orderBy: { payrollMonth: "desc" },
      include: { payrollResults: { where: { status: "FINAL" } } },
    }),
  ]);

  if (!clientConfig) throw new Error("CLIENT_CONFIG_MISSING");
  return {
    runId: run.id,
    clientId: run.clientId,
    payrollMonth: run.payrollMonth,
    resultVersionRef: gate.resultVersionRef,
    employees: uniqueEmployees(inputs),
    standardizedInputs: inputs.map((input) => ({
      id: input.id,
      employeeId: input.employeeId ?? "",
      versionNumber: input.versionNumber,
      standardField: input.standardField,
      componentCode: input.componentCode,
      amount: input.amount === null ? null : Number(input.amount),
      currencyCode: input.currencyCode,
      value: asRecord(input.value),
      evidenceRefs: input.evidenceRefs,
      sourceCellId: input.sourceCellId,
      sourceSheetName: input.sourceSheetName,
      payrollComponent: input.payrollComponent
        ? {
            id: input.payrollComponent.id,
            code: input.payrollComponent.code,
            name: input.payrollComponent.name,
            componentType: input.payrollComponent.componentType,
            taxableCash: input.payrollComponent.taxableCash,
            bpjsHealthBase: input.payrollComponent.bpjsHealthBase,
            bpjsEmploymentBase: input.payrollComponent.bpjsEmploymentBase,
            paidOut: input.payrollComponent.paidOut,
            affectsNetPay: input.payrollComponent.affectsNetPay,
            affectsEmployerCost: input.payrollComponent.affectsEmployerCost,
          }
        : null,
    })),
    ruleVersions: rules.map(ruleRef),
    fxRates: latestFxByCurrency(fxRates).map((rate) => ({
      id: rate.id,
      currencyCode: rate.currencyCode,
      rate: Number(rate.rate),
      employeeOverrides: parseEmployeeFxOverrides(rate.employeeOverrides),
    })),
    clientConfig: {
      id: clientConfig.id,
      grossUpDefault: clientConfig.grossUpDefault,
      bpjsConfig: asRecord(clientConfig.bpjsConfig),
      ruleConfig: asRecord(clientConfig.ruleConfig),
    },
    postcheckContext: {
      previousTotals: previousRun ? previousTotals(previousRun.payrollResults) : undefined,
      previousEmployeeResults: previousRun
        ? previousEmployeeResults(previousRun.payrollResults)
        : undefined,
      bpjsBillTotals: bpjsBillTotals(inputs),
      bpjsBillEmployeeItems: bpjsBillEmployeeItems(inputs),
      exportPreviewEmployeeCount: numberInput(inputs, "exportPreviewEmployeeCount"),
    },
  };
}

function latestFxByCurrency<T extends { currencyCode: string; versionNumber: number }>(rates: T[]): T[] {
  const selected = new Map<string, T>();
  for (const rate of rates) {
    const key = rate.currencyCode.toUpperCase();
    if (!selected.has(key) || rate.versionNumber > selected.get(key)!.versionNumber) {
      selected.set(key, rate);
    }
  }
  return Array.from(selected.values());
}

function uniqueEmployees(inputs: { employee: PayrollEngineInput["employees"][number] | null }[]) {
  const employees = new Map<string, PayrollEngineInput["employees"][number]>();
  for (const input of inputs) {
    if (input.employee) employees.set(input.employee.id, input.employee);
  }
  return Array.from(employees.values());
}

function ruleRef(rule: {
  id: string;
  ruleType: string;
  ruleKey: string;
  versionNumber: number;
  effectiveMonth: string;
  content: unknown;
}): PayrollRuleRef {
  return {
    id: rule.id,
    ruleType: rule.ruleType as PayrollRuleRef["ruleType"],
    ruleKey: rule.ruleKey,
    versionNumber: rule.versionNumber,
    effectiveMonth: rule.effectiveMonth,
    content: asRecord(rule.content),
  };
}

function parseEmployeeFxOverrides(value: unknown): FXRateRef["employeeOverrides"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (typeof record.employeeId !== "string") return [];
    const rate = Number(record.rate);
    return Number.isFinite(rate) ? [{ employeeId: record.employeeId, rate }] : [];
  });
}

function previousTotals(results: {
  employeeId?: string;
  grossPay: unknown;
  netPay: unknown;
  pph21: unknown;
  bpjsHealthEmployee: unknown;
  bpjsEmploymentEmployee: unknown;
  employerCost: unknown;
}[]): NonNullable<PayrollEngineInput["postcheckContext"]>["previousTotals"] {
  return {
    employeeCount: results.length,
    grossPay: sumDecimal(results.map((result) => result.grossPay)),
    netPay: sumDecimal(results.map((result) => result.netPay)),
    pph21: sumDecimal(results.map((result) => result.pph21)),
    bpjsEmployee: sumDecimal(results.map((result) => result.bpjsHealthEmployee)) + sumDecimal(results.map((result) => result.bpjsEmploymentEmployee)),
    employerCost: sumDecimal(results.map((result) => result.employerCost)),
  };
}

function previousEmployeeResults(results: {
  employeeId: string;
  netPay: unknown;
  pph21: unknown;
}[]): NonNullable<PayrollEngineInput["postcheckContext"]>["previousEmployeeResults"] {
  return results.map((result) => ({
    employeeId: result.employeeId,
    netPay: Number(result.netPay ?? 0),
    pph21: Number(result.pph21 ?? 0),
  }));
}

function bpjsBillTotals(inputs: { standardField: string; amount: unknown }[]) {
  const totals = {
    healthEmployee: numberInput(inputs, "bpjsBillHealthEmployeeTotal"),
    employmentEmployee: numberInput(inputs, "bpjsBillEmploymentEmployeeTotal"),
    healthEmployer: numberInput(inputs, "bpjsBillHealthEmployerTotal"),
    employmentEmployer: numberInput(inputs, "bpjsBillEmploymentEmployerTotal"),
  };
  return Object.values(totals).some((value) => value !== undefined) ? totals : undefined;
}

function bpjsBillEmployeeItems(inputs: {
  employeeId: string | null;
  standardField: string;
  amount: unknown;
  evidenceRefs: string[];
}[]): NonNullable<PayrollEngineInput["postcheckContext"]>["bpjsBillEmployeeItems"] | undefined {
  const items = new Map<string, BpjsBillEmployeeItem>();
  const fieldMap = {
    bpjsBillHealthEmployeeAmount: "healthEmployee",
    bpjsBillEmploymentEmployeeAmount: "employmentEmployee",
    bpjsBillHealthEmployerAmount: "healthEmployer",
    bpjsBillEmploymentEmployerAmount: "employmentEmployer",
  } as const;

  for (const input of inputs) {
    const target = fieldMap[input.standardField as keyof typeof fieldMap];
    if (!target || !input.employeeId) continue;
    const value = Number(input.amount ?? 0);
    if (!Number.isFinite(value)) continue;
    const current = items.get(input.employeeId) ?? { employeeId: input.employeeId, evidenceRefs: [] };
    current[target] = value;
    current.evidenceRefs = [...new Set([...(current.evidenceRefs ?? []), ...input.evidenceRefs])];
    items.set(input.employeeId, current);
  }

  return items.size > 0 ? Array.from(items.values()) : undefined;
}

function numberInput(inputs: { standardField: string; amount: unknown }[], field: string) {
  const amount = inputs.find((input) => input.standardField === field)?.amount;
  if (amount === null || amount === undefined) return undefined;
  const value = Number(amount);
  return Number.isFinite(value) ? value : undefined;
}

function sumDecimal(values: unknown[]): number {
  return values.reduce<number>((sum, value) => sum + Number(value ?? 0), 0);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
