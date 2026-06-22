import {
  type FXRateRef,
  type PayrollComponentRef,
  type PayrollStandardizedInput,
} from "@/domain/payroll-engine/engine-types";
import { assertFiniteMoney } from "@/domain/payroll-engine/money";

export type EmployeeInputSet = {
  employeeId: string;
  inputs: PayrollStandardizedInput[];
};

export function groupInputsByEmployee(inputs: PayrollStandardizedInput[]): EmployeeInputSet[] {
  const grouped = new Map<string, PayrollStandardizedInput[]>();
  for (const input of inputs) {
    grouped.set(input.employeeId, [...(grouped.get(input.employeeId) ?? []), input]);
  }
  return Array.from(grouped.entries()).map(([employeeId, items]) => ({ employeeId, inputs: items }));
}

export function amountInIdr(input: PayrollStandardizedInput, fxRates: FXRateRef[]): number | null {
  if (input.amount === null || input.amount === undefined) return null;
  const amount = assertFiniteMoney(input.amount, "STANDARDIZED_INPUT_AMOUNT_INVALID");
  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (currencyCode === "IDR") return amount;
  const fxRate = fxRates.find((rate) => rate.currencyCode === currencyCode);
  if (!fxRate) throw new PayrollInputError("FX_RATE_MISSING_OR_UNCONFIRMED");
  const override = fxRate.employeeOverrides?.find((item) => item.employeeId === input.employeeId);
  return amount * (override?.rate ?? fxRate.rate);
}

export function componentForInput(input: PayrollStandardizedInput): PayrollComponentRef | null {
  if (input.payrollComponent) return input.payrollComponent;
  const field = input.standardField;
  if (/^(grossSalaryAmount|baseSalaryAmount|salaryAmount|grossPayTotal|sanfuGrossPayTotal)$/i.test(field)) {
    return inferredComponent(input, "UNSPLIT_GROSS_PAY", "未拆分税前应发", "EARNING", true, true, true);
  }
  if (/^(foreignSalaryAmount|foreignAllowanceAmount)$/i.test(field)) {
    return inferredComponent(input, "FOREIGN_CASH", "外币现金收入", "EARNING", true, false, false);
  }
  if (/^(bonusAmount|allowanceAmount)$/i.test(field)) {
    return inferredComponent(input, "TAXABLE_ALLOWANCE", "应税津贴/奖金", "EARNING", true, false, false);
  }
  if (/^deductionAmount$/i.test(field)) {
    return inferredComponent(input, "DEDUCTION", "扣款", "DEDUCTION", false, false, false);
  }
  return null;
}

export function readNumberField(inputs: PayrollStandardizedInput[], field: string): number | undefined {
  const input = inputs.find((item) => item.standardField === field);
  if (!input) return undefined;
  const value = input.amount ?? input.value.amount ?? input.value.value;
  if (value === undefined || value === null) return undefined;
  return assertFiniteMoney(value, `${field.toUpperCase()}_INVALID`);
}

export function readStringField(inputs: PayrollStandardizedInput[], field: string): string | undefined {
  const input = inputs.find((item) => item.standardField === field);
  const value = input?.value.value ?? input?.value.status ?? input?.value.text;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readBooleanField(inputs: PayrollStandardizedInput[], field: string): boolean | undefined {
  const input = inputs.find((item) => item.standardField === field);
  const value = input?.value.value ?? input?.value.enabled ?? input?.value.flag;
  return typeof value === "boolean" ? value : undefined;
}

export function isCustomerComparisonInput(input: PayrollStandardizedInput): boolean {
  return (
    input.standardField.startsWith("customer") ||
    input.value.customerComparison === true ||
    input.value.sourceRole === "CUSTOMER_CALCULATION"
  );
}

export function comparisonTargetField(input: PayrollStandardizedInput): string {
  const explicit = input.value.systemField;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const withoutPrefix = input.standardField.replace(/^customer/i, "");
  return withoutPrefix ? withoutPrefix[0].toLowerCase() + withoutPrefix.slice(1) : input.standardField;
}

function inferredComponent(
  input: PayrollStandardizedInput,
  fallbackCode: string,
  name: string,
  componentType: PayrollComponentRef["componentType"],
  taxableCash: boolean,
  bpjsHealthBase: boolean,
  bpjsEmploymentBase: boolean,
): PayrollComponentRef {
  return {
    code: input.componentCode?.trim() || fallbackCode,
    name,
    componentType,
    taxableCash,
    bpjsHealthBase,
    bpjsEmploymentBase,
    paidOut: true,
    affectsNetPay: componentType !== "MEMO",
    affectsEmployerCost: false,
  };
}

export class PayrollInputError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PayrollInputError";
  }
}
