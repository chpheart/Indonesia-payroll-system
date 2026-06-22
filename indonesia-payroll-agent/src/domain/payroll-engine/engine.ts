import { calculateBpjs } from "@/domain/payroll-engine/bpjs";
import { buildBaseLines, buildThrLine } from "@/domain/payroll-engine/employee-lines";
import {
  groupInputsByEmployee,
  readBooleanField,
  readNumberField,
  readStringField,
} from "@/domain/payroll-engine/input-values";
import {
  type PayrollEngineInput,
  type PayrollEngineOutput,
  type PayrollResultDraft,
  type PayrollResultLineDraft,
} from "@/domain/payroll-engine/engine-types";
import { solveGrossUp } from "@/domain/payroll-engine/gross-up";
import { calculatePph21 } from "@/domain/payroll-engine/pph21";
import {
  type BpjsRuleConfig,
  type GrossUpRuleConfig,
  type Pph21RuleConfig,
  parseBpjsRule,
  parseGrossUpRule,
  parsePph21Rule,
  parseRoundingMode,
  parseThrRule,
  pickLatestRule,
  type ThrRuleConfig,
} from "@/domain/payroll-engine/rule-content";
import {
  buildComparisonValues,
  buildTraces,
  contributionLine,
  employerLine,
  taxAllowanceLine,
  taxLine,
  trace,
} from "@/domain/payroll-engine/result-builders";
import { roundMoney, sumMoney } from "@/domain/payroll-engine/money";

type ResolvedPayrollRules = {
  pph21: Pph21RuleConfig;
  bpjs: BpjsRuleConfig;
  thr: ThrRuleConfig;
  grossUp: GrossUpRuleConfig;
  roundingMode: "HALF_UP" | "UP" | "DOWN" | "TRUNCATE";
};

export function calculatePayroll(input: PayrollEngineInput): PayrollEngineOutput {
  const pph21Rule = pickLatestRule(input.ruleVersions, "PPH21");
  const bpjsRule = pickLatestRule(input.ruleVersions, "BPJS");
  const thrRule = pickLatestRule(input.ruleVersions, "THR");
  const grossUpRule = pickLatestRule(input.ruleVersions, "GROSS_UP");
  const roundingRule = pickLatestRule(input.ruleVersions, "ROUNDING");
  const ruleRefs = [pph21Rule, bpjsRule, thrRule, grossUpRule, roundingRule].map(ruleRef);
  const rules = {
    pph21: parsePph21Rule(pph21Rule),
    bpjs: parseBpjsRule(bpjsRule),
    thr: parseThrRule(thrRule),
    grossUp: parseGrossUpRule(grossUpRule),
    roundingMode: parseRoundingMode(roundingRule),
  };

  const employees = new Map(input.employees.map((employee) => [employee.id, employee]));
  const results = groupInputsByEmployee(input.standardizedInputs).map((employeeInputs) => {
    const employee = employees.get(employeeInputs.employeeId);
    if (!employee) throw new PayrollEngineError("PAYROLL_EMPLOYEE_NOT_FOUND");
    return calculateEmployeePayroll({
      input,
      employeeId: employee.id,
      hasNpwp: Boolean(employee.npwp?.trim()),
      inputs: employeeInputs.inputs,
      ruleRefs,
      rules,
    });
  });

  if (results.length === 0) {
    throw new PayrollEngineError("PAYROLL_NO_EMPLOYEE_RESULTS");
  }
  return { resultVersionRef: input.resultVersionRef, results };
}

function calculateEmployeePayroll(params: {
  input: PayrollEngineInput;
  employeeId: string;
  hasNpwp: boolean;
  inputs: PayrollEngineInput["standardizedInputs"];
  ruleRefs: string[];
  rules: ResolvedPayrollRules;
}): PayrollResultDraft {
  const baseLines = buildBaseLines(
    params.inputs,
    params.input.fxRates,
    params.ruleRefs,
    params.input.clientConfig,
  );
  const thrLine = buildThrLine({
    inputs: params.inputs,
    ruleRefs: params.ruleRefs,
    rule: params.rules.thr,
    roundingMode: params.rules.roundingMode,
  });
  const lines = thrLine ? [...baseLines, thrLine] : baseLines;
  const grossUpEnabled =
    readBooleanField(params.inputs, "grossUpOverride") ?? params.input.clientConfig.grossUpDefault;
  const targetNetPay =
    readNumberField(params.inputs, "targetNetPayAmount") ?? readNumberField(params.inputs, "netPayTargetAmount");
  const ptkpStatus = readStringField(params.inputs, "ptkpStatus");
  const finalSettlement = readBooleanField(params.inputs, "isFinalSettlement") ?? false;
  const ytdTaxable = readNumberField(params.inputs, "yearToDateTaxableIncome") ?? 0;
  const ytdPph21 = readNumberField(params.inputs, "yearToDatePph21Paid") ?? 0;

  if (grossUpEnabled && targetNetPay === undefined) {
    throw new PayrollEngineError("GROSS_UP_TARGET_NET_REQUIRED");
  }
  if (!hasCalculablePayrollBasis(lines) && !(grossUpEnabled && targetNetPay !== undefined)) {
    throw new PayrollEngineError("CALCULABLE_PAYROLL_INPUT_REQUIRED");
  }

  const evaluate = (taxAllowance: number) =>
    evaluateLines({
      lines: taxAllowance > 0 ? [...lines, taxAllowanceLine(taxAllowance, params.ruleRefs)] : lines,
      hasNpwp: params.hasNpwp,
      jpExempt: readBooleanField(params.inputs, "bpjsJpExempt") === true || readBooleanField(params.inputs, "isForeignEmployee") === true,
      ptkpStatus,
      finalSettlement,
      ytdTaxable,
      ytdPph21,
      rules: params.rules,
    });

  const evaluated = grossUpEnabled
    ? evaluateGrossUp(targetNetPay ?? 0, evaluate, params.rules, params.ruleRefs)
    : { ...evaluate(0), grossUpTrace: null };

  const resultLines = [
    ...evaluated.lines,
    taxLine("PPH21", "PPh21", evaluated.pph21.pph21, params.ruleRefs),
    contributionLine("BPJS_KS_EMPLOYEE", "BPJS KS 员工承担", evaluated.bpjs.healthEmployee, params.ruleRefs),
    contributionLine("BPJS_TK_EMPLOYEE", "BPJS TK 员工承担", evaluated.bpjs.employmentEmployee, params.ruleRefs),
    employerLine("BPJS_KS_EMPLOYER", "BPJS KS 雇主承担", evaluated.bpjs.healthEmployer, params.ruleRefs),
    employerLine("BPJS_TK_EMPLOYER", "BPJS TK 雇主承担", evaluated.bpjs.employmentEmployer, params.ruleRefs),
  ];
  const traces = buildTraces(evaluated, params.ruleRefs, params.rules.roundingMode);
  if (evaluated.grossUpTrace) traces.push(evaluated.grossUpTrace);

  return {
    employeeId: params.employeeId,
    resultVersionRef: params.input.resultVersionRef,
    grossPay: evaluated.grossPay,
    taxableIncome: evaluated.taxableIncome,
    pph21: evaluated.pph21.pph21,
    bpjsHealthEmployee: evaluated.bpjs.healthEmployee,
    bpjsEmploymentEmployee: evaluated.bpjs.employmentEmployee,
    bpjsHealthEmployer: evaluated.bpjs.healthEmployer,
    bpjsEmploymentEmployer: evaluated.bpjs.employmentEmployer,
    totalDeductions: evaluated.totalDeductions,
    netPay: evaluated.netPay,
    employerCost: evaluated.employerCost,
    currencyCode: "IDR",
    sourceVersionSnapshot: {
      payrollMonth: params.input.payrollMonth,
      ruleVersionRefs: params.ruleRefs,
      inputIds: params.inputs.map((item) => item.id),
    },
    lines: resultLines,
    traces,
    comparisonValues: buildComparisonValues(params.inputs, evaluated),
  };
}

function evaluateLines(input: {
  lines: PayrollResultLineDraft[];
  hasNpwp: boolean;
  ptkpStatus?: string;
  finalSettlement: boolean;
  ytdTaxable: number;
  ytdPph21: number;
  jpExempt: boolean;
  rules: ResolvedPayrollRules;
}) {
  const grossPayBefore = sumMoney(input.lines.filter(isCashGrossLine).map((line) => line.amount));
  const grossPay = roundMoney(grossPayBefore, input.rules.roundingMode);
  const taxableIncomeBefore = sumMoney(input.lines.filter((line) => line.taxableCash).map((line) => line.amount));
  const taxableIncome = roundMoney(taxableIncomeBefore, input.rules.roundingMode);
  const bpjs = calculateBpjs({
    healthBase: sumMoney(input.lines.filter((line) => line.bpjsHealthBase).map((line) => line.amount)),
    employmentBase: sumMoney(input.lines.filter((line) => line.bpjsEmploymentBase).map((line) => line.amount)),
    jpExempt: input.jpExempt,
    rule: input.rules.bpjs,
    roundingMode: input.rules.roundingMode,
  });
  const pph21 = calculatePph21({
    taxableIncome,
    hasNpwp: input.hasNpwp,
    ptkpStatus: input.ptkpStatus,
    isFinalSettlement: input.finalSettlement,
    yearToDateTaxableIncome: input.ytdTaxable,
    yearToDatePph21Paid: input.ytdPph21,
    rule: input.rules.pph21,
    roundingMode: input.rules.roundingMode,
  });
  const deductionLines = sumMoney(input.lines.filter((line) => line.lineType === "DEDUCTION" && line.affectsNetPay).map((line) => line.amount));
  const totalDeductions = pph21.pph21 + bpjs.healthEmployee + bpjs.employmentEmployee + deductionLines;
  const netPayBefore = grossPay - totalDeductions;
  const netPay = roundMoney(netPayBefore, input.rules.roundingMode);
  const additionalEmployerCost = sumMoney(input.lines.filter((line) => line.affectsEmployerCost && !isCashGrossLine(line)).map((line) => line.amount));
  const employerCostBefore = grossPay + bpjs.healthEmployer + bpjs.employmentEmployer + additionalEmployerCost;
  const employerCost = roundMoney(employerCostBefore, input.rules.roundingMode);
  return {
    lines: input.lines,
    grossPay,
    taxableIncome,
    bpjs,
    pph21,
    totalDeductions,
    netPay,
    employerCost,
    rounding: {
      grossPay: { before: grossPayBefore, after: grossPay },
      taxableIncome: { before: taxableIncomeBefore, after: taxableIncome },
      netPay: { before: netPayBefore, after: netPay },
      employerCost: { before: employerCostBefore, after: employerCost },
    },
  };
}

function isCashGrossLine(line: PayrollResultLineDraft) {
  return line.paidOut && line.affectsNetPay && ![
    "DEDUCTION",
    "TAX",
    "EMPLOYEE_CONTRIBUTION",
    "EMPLOYER_CONTRIBUTION",
    "MEMO",
  ].includes(line.lineType);
}

function hasCalculablePayrollBasis(lines: PayrollResultLineDraft[]) {
  return lines.some((line) =>
    ["EARNING", "TAX_ALLOWANCE", "THR"].includes(line.lineType) &&
    (line.paidOut || line.taxableCash || line.bpjsHealthBase || line.bpjsEmploymentBase),
  );
}

function evaluateGrossUp(
  targetNetPay: number,
  evaluate: (taxAllowance: number) => ReturnType<typeof evaluateLines>,
  rules: ResolvedPayrollRules,
  ruleRefs: string[],
) {
  const solved = solveGrossUp({
    targetNetPay,
    rule: rules.grossUp,
    roundingMode: rules.roundingMode,
    calculateWithTaxAllowance: (taxAllowance) => {
      const evaluated = evaluate(taxAllowance);
      return { taxAllowance, netPay: evaluated.netPay, pph21: evaluated.pph21.pph21 };
    },
  });
  const evaluated = evaluate(solved.taxAllowance);
  return {
    ...evaluated,
    grossUpTrace: trace("grossUp", "GROSS_UP", "binary search tax allowance until net pay reaches target", ruleRefs, {
      targetNetPay,
      taxAllowance: solved.taxAllowance,
      iterations: solved.iterations,
      difference: solved.difference,
    }, solved.netPay, rules.roundingMode),
  };
}

function ruleRef(rule: { id: string; ruleKey: string; versionNumber: number }) {
  return `${rule.ruleKey}:v${rule.versionNumber}:${rule.id}`;
}

export class PayrollEngineError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PayrollEngineError";
  }
}
