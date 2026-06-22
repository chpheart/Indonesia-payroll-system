import {
  amountInIdr,
  componentForInput,
  isCustomerComparisonInput,
  readNumberField,
  readBooleanField,
} from "@/domain/payroll-engine/input-values";
import {
  type PayrollEngineInput,
  type PayrollComponentRef,
  type PayrollResultLineDraft,
  type RoundingMode,
} from "@/domain/payroll-engine/engine-types";
import { calculateThr } from "@/domain/payroll-engine/thr";
import { type ThrRuleConfig } from "@/domain/payroll-engine/rule-content";

export function buildBaseLines(
  inputs: PayrollEngineInput["standardizedInputs"],
  fxRates: PayrollEngineInput["fxRates"],
  ruleRefs: string[],
  clientConfig: PayrollEngineInput["clientConfig"],
) {
  return inputs.flatMap((input): PayrollResultLineDraft[] => {
    if (isCustomerComparisonInput(input)) return [];
    const amount = amountInIdr(input, fxRates);
    const component = applyClientComponentPolicy(input, componentForInput(input), clientConfig);
    if (amount === null || !component) return [];
    return [{
      lineType: lineTypeForComponent(component),
      componentCode: component.code,
      label: component.name,
      amount,
      currencyCode: "IDR",
      taxableCash: component.taxableCash,
      bpjsHealthBase: component.bpjsHealthBase,
      bpjsEmploymentBase: component.bpjsEmploymentBase,
      paidOut: component.paidOut,
      affectsNetPay: component.affectsNetPay,
      affectsEmployerCost: component.affectsEmployerCost,
      sourceInputIds: [input.id],
      sourceInputRefs: [sourceInputRef(input, component)],
      ruleVersionRefs: ruleRefs,
    }];
  });
}

export function buildThrLine(input: {
  inputs: PayrollEngineInput["standardizedInputs"];
  ruleRefs: string[];
  rule: ThrRuleConfig;
  roundingMode: RoundingMode;
}) {
  const explicitThrAmount = readNumberField(input.inputs, "thrAmount");
  const eligible = readBooleanField(input.inputs, "thrEligible") ?? explicitThrAmount !== undefined;
  const baseSalary = readNumberField(input.inputs, "baseSalaryAmount") ?? readNumberField(input.inputs, "grossSalaryAmount") ?? 0;
  const result = calculateThr({
    explicitThrAmount,
    baseSalary,
    monthsWorked: readNumberField(input.inputs, "thrMonthsWorked"),
    eligible,
    rule: input.rule,
    roundingMode: input.roundingMode,
  });
  if (result.amount <= 0) return null;
  const sourceInputs = input.inputs.filter((item) => item.standardField.startsWith("thr"));
  return {
    lineType: "THR" as const,
    componentCode: "THR",
    label: "THR",
    amount: result.amount,
    currencyCode: "IDR",
    taxableCash: true,
    bpjsHealthBase: false,
    bpjsEmploymentBase: false,
    paidOut: true,
    affectsNetPay: true,
    affectsEmployerCost: false,
    sourceInputIds: sourceInputs.map((item) => item.id),
    sourceInputRefs: sourceInputs.map((item) => sourceInputRef(item)),
    ruleVersionRefs: input.ruleRefs,
  };
}

function sourceInputRef(
  input: PayrollEngineInput["standardizedInputs"][number],
  component?: PayrollComponentRef,
) {
  return {
    sourceInputId: input.id,
    versionNumber: input.versionNumber,
    standardField: input.standardField,
    componentCode: component?.code ?? input.componentCode ?? null,
    originalAmount: input.amount ?? null,
    currencyCode: input.currencyCode,
    sourceCellId: input.sourceCellId ?? null,
    sourceSheetName: input.sourceSheetName ?? null,
    componentAttributes: component
      ? {
          taxableCash: component.taxableCash,
          bpjsHealthBase: component.bpjsHealthBase,
          bpjsEmploymentBase: component.bpjsEmploymentBase,
          paidOut: component.paidOut,
          affectsNetPay: component.affectsNetPay,
          affectsEmployerCost: component.affectsEmployerCost,
          componentType: component.componentType,
        }
      : null,
  };
}

function lineTypeForComponent(component: PayrollComponentRef): PayrollResultLineDraft["lineType"] {
  if (component.componentType === "DEDUCTION") return "DEDUCTION";
  if (component.componentType === "TAX_ALLOWANCE") return "TAX_ALLOWANCE";
  if (component.componentType === "EMPLOYER_COST") return "EMPLOYER_CONTRIBUTION";
  if (component.componentType === "MEMO" || (component.componentType === "BENEFIT" && !component.paidOut)) {
    return "MEMO";
  }
  return "EARNING";
}

function applyClientComponentPolicy(
  input: PayrollEngineInput["standardizedInputs"][number],
  component: ReturnType<typeof componentForInput>,
  clientConfig: PayrollEngineInput["clientConfig"],
) {
  if (!component || input.currencyCode.trim().toUpperCase() === "IDR") return component;
  return {
    ...component,
    bpjsHealthBase: booleanConfig(clientConfig, "foreignCashBpjsHealthBase"),
    bpjsEmploymentBase: booleanConfig(clientConfig, "foreignCashBpjsEmploymentBase"),
  };
}

function booleanConfig(clientConfig: PayrollEngineInput["clientConfig"], key: string) {
  const value = clientConfig.ruleConfig[key] ?? clientConfig.bpjsConfig[key];
  return value === true;
}
