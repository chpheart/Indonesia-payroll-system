export type PrecheckInputForGate = {
  employeeId: string | null;
  standardField: string;
  value: unknown;
  amount?: unknown;
  payrollComponent?: {
    componentType: string;
    taxableCash: boolean;
    bpjsHealthBase: boolean;
    bpjsEmploymentBase: boolean;
    paidOut: boolean;
  } | null;
};

export function isNetPayModeInput(input: { standardField: string; value: unknown }) {
  return /(netPay|netSalary|takeHome|taxAfter|afterTax|targetNet|税后|到手)/i.test(input.standardField) ||
    asRecord(input.value).payrollMode === "NET" ||
    asRecord(input.value).calculationMode === "NET_TO_GROSS";
}

export function isGrossUpOverrideInput(input: { standardField: string; value: unknown }) {
  const value = asRecord(input.value).value ?? asRecord(input.value).enabled;
  return /grossUpOverride/i.test(input.standardField) && value === true;
}

export function employeeWithoutCalculablePayrollInputCount(
  inputs: PrecheckInputForGate[],
  clientGrossUpDefault: boolean,
) {
  const byEmployee = new Map<string, {
    hasCalculableInput: boolean;
    hasGrossUpOverride: boolean;
    hasTargetNetPay: boolean;
  }>();
  for (const input of inputs) {
    if (!input.employeeId) continue;
    const current = byEmployee.get(input.employeeId) ?? {
      hasCalculableInput: false,
      hasGrossUpOverride: false,
      hasTargetNetPay: false,
    };
    byEmployee.set(input.employeeId, {
      hasCalculableInput: current.hasCalculableInput || isCalculablePayrollInput(input),
      hasGrossUpOverride: current.hasGrossUpOverride || isGrossUpOverrideInput(input),
      hasTargetNetPay: current.hasTargetNetPay || isTargetNetPayInput(input),
    });
  }
  return Array.from(byEmployee.values()).filter((item) =>
    !item.hasCalculableInput && !(item.hasTargetNetPay && (clientGrossUpDefault || item.hasGrossUpOverride)),
  ).length;
}

export function netPayModeWithoutGrossUpEmployeeCount(
  inputs: { employeeId: string | null; standardField: string; value: unknown }[],
  clientGrossUpDefault: boolean,
) {
  if (clientGrossUpDefault) return 0;
  const byEmployee = new Map<string, { hasNetPayMode: boolean; hasGrossUpOverride: boolean }>();
  for (const input of inputs) {
    const employeeKey = input.employeeId ?? "__missing_employee__";
    const current = byEmployee.get(employeeKey) ?? { hasNetPayMode: false, hasGrossUpOverride: false };
    byEmployee.set(employeeKey, {
      hasNetPayMode: current.hasNetPayMode || isNetPayModeInput(input),
      hasGrossUpOverride: current.hasGrossUpOverride || isGrossUpOverrideInput(input),
    });
  }
  return Array.from(byEmployee.values()).filter((item) => item.hasNetPayMode && !item.hasGrossUpOverride).length;
}

export function grossUpOverrideEmployeeCount(
  inputs: { employeeId: string | null; standardField: string; value: unknown }[],
) {
  return new Set(
    inputs
      .filter((input) => input.employeeId && isGrossUpOverrideInput(input))
      .map((input) => input.employeeId),
  ).size;
}

function isCalculablePayrollInput(input: PrecheckInputForGate) {
  if (isCustomerComparisonInput(input) || input.amount === null || input.amount === undefined) {
    return false;
  }
  if (input.payrollComponent) {
    return ["EARNING", "TAX_ALLOWANCE", "BENEFIT"].includes(input.payrollComponent.componentType) &&
      (input.payrollComponent.paidOut ||
        input.payrollComponent.taxableCash ||
        input.payrollComponent.bpjsHealthBase ||
        input.payrollComponent.bpjsEmploymentBase);
  }
  return /^(grossSalaryAmount|baseSalaryAmount|salaryAmount|grossPayTotal|sanfuGrossPayTotal|foreignSalaryAmount|foreignAllowanceAmount|bonusAmount|allowanceAmount|thrAmount)$/i.test(input.standardField);
}

function isTargetNetPayInput(input: PrecheckInputForGate) {
  if (input.amount === null || input.amount === undefined) return false;
  return /^(targetNetPayAmount|netPayTargetAmount)$/i.test(input.standardField);
}

function isCustomerComparisonInput(input: { standardField: string; value: unknown }) {
  const value = asRecord(input.value);
  return input.standardField.startsWith("customer") ||
    value.customerComparison === true ||
    value.sourceRole === "CUSTOMER_CALCULATION";
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}
