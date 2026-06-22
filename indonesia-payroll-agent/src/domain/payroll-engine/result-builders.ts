import {
  comparisonTargetField,
  isCustomerComparisonInput,
} from "@/domain/payroll-engine/input-values";
import {
  type CalculationTraceDraft,
  type PayrollEngineInput,
  type PayrollResultLineDraft,
} from "@/domain/payroll-engine/engine-types";

type RoundingDetail = {
  before: number;
  after: number;
};

export type EvaluatedPayrollLines = {
  lines: PayrollResultLineDraft[];
  grossPay: number;
  taxableIncome: number;
  pph21: {
    pph21: number;
    parameters?: Record<string, unknown>;
    rounding?: Record<string, RoundingDetail>;
  };
  bpjs: {
    healthEmployee: number;
    employmentEmployee: number;
    healthEmployer: number;
    employmentEmployer: number;
    jhtEmployee?: number;
    jhtEmployer?: number;
    jpEmployee?: number;
    jpEmployer?: number;
    jkkEmployer?: number;
    jkmEmployer?: number;
    parameters?: Record<string, unknown>;
    rounding?: Record<string, RoundingDetail>;
  };
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  rounding: Record<string, RoundingDetail>;
};

export function buildTraces(
  evaluated: EvaluatedPayrollLines,
  ruleRefs: string[],
  roundingMode: string,
): CalculationTraceDraft[] {
  const inputRefs = inputRefsFromLines(evaluated.lines);
  return [
    trace("grossPay", "GROSS_PAY", "sum earnings and THR lines", ruleRefs, {}, evaluated.grossPay, roundingMode, inputRefs, {}, evaluated.rounding.grossPay),
    trace("taxableIncome", "TAX_BASE", "sum taxable cash lines", ruleRefs, { taxableIncome: evaluated.taxableIncome }, evaluated.taxableIncome, roundingMode, inputRefs, {}, evaluated.rounding.taxableIncome),
    trace("pph21", "PPH21", "apply PPh21 rule version", ruleRefs, stripTraceMeta(evaluated.pph21), evaluated.pph21.pph21, roundingMode, inputRefs, evaluated.pph21.parameters ?? {}, evaluated.pph21.rounding?.pph21),
    trace("bpjsHealthEmployee", "BPJS_KS", "apply BPJS KS employee contribution rule", ruleRefs, stripTraceMeta(evaluated.bpjs), evaluated.bpjs.healthEmployee, roundingMode, inputRefs, evaluated.bpjs.parameters ?? {}, evaluated.bpjs.rounding?.healthEmployee),
    trace("bpjsEmploymentEmployee", "BPJS_TK", "apply BPJS TK employee JHT/JP rules", ruleRefs, stripTraceMeta(evaluated.bpjs), evaluated.bpjs.employmentEmployee, roundingMode, inputRefs, evaluated.bpjs.parameters ?? {}, evaluated.bpjs.rounding?.employmentEmployee),
    trace("bpjsHealthEmployer", "BPJS_KS", "apply BPJS KS employer contribution rule", ruleRefs, stripTraceMeta(evaluated.bpjs), evaluated.bpjs.healthEmployer, roundingMode, inputRefs, evaluated.bpjs.parameters ?? {}, evaluated.bpjs.rounding?.healthEmployer),
    trace("bpjsEmploymentEmployer", "BPJS_TK", "apply BPJS TK employer JHT/JP/JKK/JKM rules", ruleRefs, stripTraceMeta(evaluated.bpjs), evaluated.bpjs.employmentEmployer, roundingMode, inputRefs, evaluated.bpjs.parameters ?? {}, evaluated.bpjs.rounding?.employmentEmployer),
    trace("netPay", "NET_PAY", "gross pay minus employee tax and deductions", ruleRefs, { totalDeductions: evaluated.totalDeductions }, evaluated.netPay, roundingMode, inputRefs, {}, evaluated.rounding.netPay),
    trace("employerCost", "EMPLOYER_COST", "gross pay plus employer contributions", ruleRefs, {}, evaluated.employerCost, roundingMode, inputRefs, {}, evaluated.rounding.employerCost),
  ];
}

export function buildComparisonValues(
  inputs: PayrollEngineInput["standardizedInputs"],
  evaluated: EvaluatedPayrollLines,
) {
  const systemValues: Record<string, number> = {
    netPay: evaluated.netPay,
    pph21: evaluated.pph21.pph21,
    grossPay: evaluated.grossPay,
    taxableIncome: evaluated.taxableIncome,
    bpjsHealthEmployee: evaluated.bpjs.healthEmployee,
    bpjsEmploymentEmployee: evaluated.bpjs.employmentEmployee,
    employerCost: evaluated.employerCost,
  };
  return inputs.filter(isCustomerComparisonInput).flatMap((input) => {
    const customerValue = input.amount ?? input.value.amount;
    if (typeof customerValue !== "number") return [];
    const targetField = comparisonTargetField(input);
    const systemValue = systemValues[targetField];
    const delta = systemValue === undefined ? undefined : customerValue - systemValue;
    return [{
      employeeId: input.employeeId,
      sourceInputId: input.id,
      targetField,
      customerValue,
      systemValue,
      delta,
      status: systemValue === undefined ? "CUSTOMER_ONLY" as const : Math.abs(delta ?? 0) <= 1 ? "MATCH" as const : "DIFF" as const,
      currencyCode: input.currencyCode,
      sourceLabel: input.sourceSheetName ?? input.standardField,
      sourceCellId: input.sourceCellId,
    }];
  });
}

export function taxAllowanceLine(amount: number, ruleRefs: string[]): PayrollResultLineDraft {
  return baseLine("TAX_ALLOWANCE", "TAX_ALLOWANCE", "Tax Allowance", amount, ruleRefs, {
    taxableCash: true,
    paidOut: true,
    affectsNetPay: true,
  });
}

export function taxLine(componentCode: string, label: string, amount: number, ruleRefs: string[]) {
  return baseLine("TAX", componentCode, label, amount, ruleRefs, {});
}

export function contributionLine(componentCode: string, label: string, amount: number, ruleRefs: string[]) {
  return baseLine("EMPLOYEE_CONTRIBUTION", componentCode, label, amount, ruleRefs, {});
}

export function employerLine(componentCode: string, label: string, amount: number, ruleRefs: string[]) {
  return baseLine("EMPLOYER_CONTRIBUTION", componentCode, label, amount, ruleRefs, {
    affectsEmployerCost: true,
  });
}

export function trace(
  resultField: string,
  traceType: string,
  formula: string,
  ruleRefs: string[],
  values: Record<string, unknown>,
  outputValue: number,
  roundingMode: string,
  inputRefs: Record<string, unknown>[] = [],
  parameters: Record<string, unknown> = {},
  roundingDetail?: RoundingDetail,
): CalculationTraceDraft {
  return {
    resultField,
    traceType,
    inputRefs,
    ruleVersionRefs: ruleRefs,
    formula,
    parameters,
    intermediateValues: values,
    rounding: {
      mode: roundingMode,
      before: roundingDetail?.before ?? outputValue,
      after: roundingDetail?.after ?? outputValue,
    },
    outputValue,
  };
}

function stripTraceMeta(value: Record<string, unknown>) {
  const rest = { ...value };
  delete rest.parameters;
  delete rest.rounding;
  return rest;
}

function inputRefsFromLines(lines: PayrollResultLineDraft[]): Record<string, unknown>[] {
  return lines.flatMap((line) =>
    line.sourceInputRefs.length > 0
      ? line.sourceInputRefs.map((sourceInputRef) => ({
          ...sourceInputRef,
          componentCode: line.componentCode,
          lineType: line.lineType,
          taxableCash: line.taxableCash,
          bpjsHealthBase: line.bpjsHealthBase,
          bpjsEmploymentBase: line.bpjsEmploymentBase,
          paidOut: line.paidOut,
        }))
      : line.sourceInputIds.map((sourceInputId) => ({
          sourceInputId,
          componentCode: line.componentCode,
          lineType: line.lineType,
          taxableCash: line.taxableCash,
          bpjsHealthBase: line.bpjsHealthBase,
          bpjsEmploymentBase: line.bpjsEmploymentBase,
          paidOut: line.paidOut,
        })),
  );
}

function baseLine(
  lineType: PayrollResultLineDraft["lineType"],
  componentCode: string,
  label: string,
  amount: number,
  ruleRefs: string[],
  options: Partial<Pick<PayrollResultLineDraft, "taxableCash" | "paidOut" | "affectsNetPay" | "affectsEmployerCost">>,
): PayrollResultLineDraft {
  return {
    lineType,
    componentCode,
    label,
    amount,
    currencyCode: "IDR",
    taxableCash: options.taxableCash ?? false,
    bpjsHealthBase: false,
    bpjsEmploymentBase: false,
    paidOut: options.paidOut ?? false,
    affectsNetPay: options.affectsNetPay ?? false,
    affectsEmployerCost: options.affectsEmployerCost ?? false,
    sourceInputIds: [],
    sourceInputRefs: [],
    ruleVersionRefs: ruleRefs,
  };
}
