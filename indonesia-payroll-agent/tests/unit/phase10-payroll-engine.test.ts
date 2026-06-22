import { describe, expect, it } from "vitest";
import { calculatePayroll, PayrollEngineError } from "@/domain/payroll-engine/engine";
import { type PayrollComponentRef, type PayrollEngineInput } from "@/domain/payroll-engine/engine-types";
import { roundMoney } from "@/domain/payroll-engine/money";
import { basePayrollInput, salaryInput } from "./phase10-test-fixtures";

describe("phase 10 deterministic payroll engine", () => {
  it("calculates payroll results and keeps customer Excel values as comparison only", () => {
    const output = calculatePayroll(basePayrollInput({
      standardizedInputs: [
        salaryInput("input-gross", "grossSalaryAmount", 12_000_000),
        {
          ...salaryInput("input-customer-net", "customerNetPay", 99_999_999),
          value: { customerComparison: true, systemField: "netPay" },
        },
      ],
    }));

    const result = output.results[0];
    expect(result.grossPay).toBe(12_000_000);
    expect(result.pph21).toBe(600_000);
    expect(result.bpjsHealthEmployee + result.bpjsEmploymentEmployee).toBe(480_000);
    expect(result.netPay).toBe(10_920_000);
    expect(result.employerCost).toBe(13_228_800);
    expect(result.traces.map((trace) => trace.resultField)).toEqual(
      expect.arrayContaining(["grossPay", "taxableIncome", "pph21", "netPay", "employerCost"]),
    );
    expect(result.traces.find((trace) => trace.resultField === "pph21")?.inputRefs).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceInputId: "input-gross", versionNumber: 1 })]),
    );
    expect(result.comparisonValues[0]).toMatchObject({
      targetField: "netPay",
      customerValue: 99_999_999,
      systemValue: 10_920_000,
      status: "DIFF",
    });
  });

  it("solves gross up within the IDR 1 tolerance and records a trace", () => {
    const output = calculatePayroll(basePayrollInput({
      clientConfig: { id: "config-a", grossUpDefault: true, bpjsConfig: {}, ruleConfig: {} },
      standardizedInputs: [
        salaryInput("input-target", "targetNetPayAmount", 10_000_000),
      ],
    }));

    const result = output.results[0];
    expect(Math.abs(result.netPay - 10_000_000)).toBeLessThanOrEqual(1);
    expect(result.lines.some((line) => line.componentCode === "TAX_ALLOWANCE")).toBe(true);
    expect(result.traces.some((trace) => trace.resultField === "grossUp")).toBe(true);
  });

  it("does not let gross up rules relax the IDR 1 success tolerance", () => {
    expect(() =>
      calculatePayroll(basePayrollInput({
        clientConfig: { id: "config-a", grossUpDefault: true, bpjsConfig: {}, ruleConfig: {} },
        standardizedInputs: [
          salaryInput("input-target", "targetNetPayAmount", 10_000_000),
        ],
        ruleVersions: withRuleContent(basePayrollInput().ruleVersions, "GROSS_UP", {
          maxIterations: 2,
          toleranceIdr: 600_000,
        }),
      })),
    ).toThrow("GROSS_UP_DID_NOT_CONVERGE");
  });

  it("applies BPJS TK JP exemption for foreign employees", () => {
    const output = calculatePayroll(basePayrollInput({
      standardizedInputs: [
        salaryInput("input-gross", "grossSalaryAmount", 12_000_000),
        {
          ...salaryInput("input-foreign", "isForeignEmployee", 0),
          value: { value: true },
        },
      ],
    }));

    const result = output.results[0];
    expect(result.bpjsEmploymentEmployee).toBe(240_000);
    expect(result.bpjsEmploymentEmployer).toBe(508_800);
  });

  it("uses employee FX override and client rules for foreign salary BPJS bases", () => {
    const foreignSalary = {
      ...salaryInput("input-foreign-salary", "foreignSalaryAmount", 1_000),
      currencyCode: "USD",
    };
    const output = calculatePayroll(basePayrollInput({
      standardizedInputs: [foreignSalary],
      fxRates: [{
        id: "fx-usd",
        currencyCode: "USD",
        rate: 15_000,
        employeeOverrides: [{ employeeId: "employee-a", rate: 16_000 }],
      }],
      clientConfig: {
        id: "config-a",
        grossUpDefault: false,
        bpjsConfig: {},
        ruleConfig: { foreignCashBpjsHealthBase: true, foreignCashBpjsEmploymentBase: true },
      },
    }));

    const result = output.results[0];
    expect(result.grossPay).toBe(16_000_000);
    expect(result.taxableIncome).toBe(16_000_000);
    expect(result.bpjsHealthEmployee + result.bpjsEmploymentEmployee).toBe(480_000);
    expect(result.netPay).toBe(14_720_000);
  });

  it("adds THR as taxable cash without adding it to BPJS bases", () => {
    const output = calculatePayroll(basePayrollInput({
      standardizedInputs: [
        salaryInput("input-gross", "grossSalaryAmount", 12_000_000),
        salaryInput("input-thr", "thrAmount", 3_000_000),
      ],
    }));

    const result = output.results[0];
    expect(result.lines.find((line) => line.lineType === "THR")?.amount).toBe(3_000_000);
    expect(result.grossPay).toBe(15_000_000);
    expect(result.taxableIncome).toBe(15_000_000);
    expect(result.bpjsHealthEmployee + result.bpjsEmploymentEmployee).toBe(480_000);
  });

  it("treats Sanfu gross total as unsplit taxable gross pay", () => {
    const output = calculatePayroll(basePayrollInput({
      standardizedInputs: [
        salaryInput("input-sanfu-gross", "sanfuGrossPayTotal", 7_000_000),
      ],
    }));

    const result = output.results[0];
    expect(result.grossPay).toBe(7_000_000);
    expect(result.taxableIncome).toBe(7_000_000);
    expect(result.lines[0]).toMatchObject({
      componentCode: "UNSPLIT_GROSS_PAY",
      taxableCash: true,
    });
  });

  it("uses Pasal 17 final settlement rules for terminated-period cleanup", () => {
    const output = calculatePayroll(basePayrollInput({
      standardizedInputs: [
        salaryInput("input-gross", "grossSalaryAmount", 10_000_000),
        { ...salaryInput("input-final", "isFinalSettlement", 0), value: { value: true } },
        salaryInput("input-ytd-taxable", "yearToDateTaxableIncome", 100_000_000),
        salaryInput("input-ytd-pph21", "yearToDatePph21Paid", 2_000_000),
      ],
      ruleVersions: withRuleContent(basePayrollInput().ruleVersions, "PPH21", {
        monthlyTerRates: [],
        annualBrackets: [{ upTo: null, rate: 0.05 }],
        ptkpByStatus: { "TK/0": 0 },
        defaultPtkpStatus: "TK/0",
        npwpPenaltyMultiplier: 1.2,
      }),
    }));

    const result = output.results[0];
    expect(result.pph21).toBe(3_500_000);
    expect(result.traces.find((trace) => trace.resultField === "pph21")?.parameters).toMatchObject({
      method: "PASAL17_FINAL",
      yearToDatePph21Paid: 2_000_000,
    });
  });

  it("fails closed when PPh21 PTKP table is missing", () => {
    expect(() =>
      calculatePayroll(basePayrollInput({
        ruleVersions: withRuleContent(basePayrollInput().ruleVersions, "PPH21", {
          monthlyTerRates: [{ upTo: null, rate: 0.05 }],
          npwpPenaltyMultiplier: 1.2,
        }),
      })),
    ).toThrow("PPH21_PTKP_TABLE_REQUIRED");
  });

  it("fails closed when employee PTKP status is not configured", () => {
    expect(() =>
      calculatePayroll(basePayrollInput({
        standardizedInputs: [
          salaryInput("input-gross", "grossSalaryAmount", 10_000_000),
          { ...salaryInput("input-ptkp", "ptkpStatus", 0), value: { value: "K/3" } },
        ],
      })),
    ).toThrow("PPH21_PTKP_STATUS_NOT_CONFIGURED");
  });

  it("fails closed when final settlement lacks annual PPh21 brackets", () => {
    expect(() =>
      calculatePayroll(basePayrollInput({
        standardizedInputs: [
          salaryInput("input-gross", "grossSalaryAmount", 10_000_000),
          { ...salaryInput("input-final", "isFinalSettlement", 0), value: { value: true } },
          salaryInput("input-ytd-taxable", "yearToDateTaxableIncome", 100_000_000),
          salaryInput("input-ytd-pph21", "yearToDatePph21Paid", 2_000_000),
        ],
      })),
    ).toThrow("PPH21_ANNUAL_BRACKETS_REQUIRED");
  });

  it("rounds IDR amounts in all supported modes", () => {
    expect(roundMoney(1.2, "UP")).toBe(2);
    expect(roundMoney(1.8, "DOWN")).toBe(1);
    expect(roundMoney(-1.8, "TRUNCATE")).toBe(-1);
    expect(roundMoney(1.5, "HALF_UP")).toBe(2);
  });

  it("records BPJS rule parameters and rounding before/after amounts in traces", () => {
    const output = calculatePayroll(basePayrollInput({
      standardizedInputs: [
        salaryInput("input-gross", "grossSalaryAmount", 9_999_999),
      ],
    }));

    const healthTrace = output.results[0].traces.find(
      (trace) => trace.resultField === "bpjsHealthEmployee",
    );
    const rounding = healthTrace?.rounding as { before: number; after: number };

    expect(healthTrace?.parameters).toMatchObject({
      healthEmployeeRate: 0.01,
      healthWageCap: 12_000_000,
    });
    expect(rounding.before).toBeCloseTo(99_999.99, 5);
    expect(rounding.after).toBe(100_000);
  });

  it("fails closed when BPJS TK critical rates are missing", () => {
    expect(() =>
      calculatePayroll(basePayrollInput({
        ruleVersions: withRuleContent(basePayrollInput().ruleVersions, "BPJS", {
          healthEmployeeRate: 0.01,
          healthEmployerRate: 0.04,
          healthWageCap: 12_000_000,
          jhtEmployeeRate: 0.02,
          jhtEmployerRate: 0.037,
          employmentWageCap: 12_000_000,
          jpWageCap: 12_000_000,
          jpEmployerRate: 0.02,
          jkkEmployerRate: 0.0024,
          jkmEmployerRate: 0.003,
        }),
      })),
    ).toThrow("BPJS_JP_EMPLOYEE_RATE_REQUIRED");
  });

  it("respects paid-out, net-pay, and employer-cost component semantics", () => {
    const output = calculatePayroll(basePayrollInput({
      standardizedInputs: [
        salaryInput("input-gross", "grossSalaryAmount", 12_000_000),
        {
          ...salaryInput("input-employer-cost", "employerInsuranceCost", 1_000_000),
          payrollComponent: component({
            code: "EMP_INSURANCE",
            name: "Employer insurance",
            componentType: "EMPLOYER_COST",
            paidOut: false,
            affectsNetPay: false,
            affectsEmployerCost: true,
          }),
        },
        {
          ...salaryInput("input-memo", "memoAmount", 5_000_000),
          payrollComponent: component({
            code: "MEMO_ONLY",
            name: "Memo only",
            componentType: "MEMO",
            paidOut: false,
            affectsNetPay: false,
            affectsEmployerCost: false,
          }),
        },
      ],
    }));

    const result = output.results[0];
    expect(result.grossPay).toBe(12_000_000);
    expect(result.netPay).toBe(10_920_000);
    expect(result.employerCost).toBe(14_228_800);
    expect(result.lines.find((line) => line.componentCode === "EMP_INSURANCE")).toMatchObject({
      lineType: "EMPLOYER_CONTRIBUTION",
      paidOut: false,
      affectsNetPay: false,
      affectsEmployerCost: true,
    });
    expect(result.lines.find((line) => line.componentCode === "MEMO_ONLY")).toMatchObject({
      lineType: "MEMO",
      paidOut: false,
      affectsNetPay: false,
      affectsEmployerCost: false,
    });
  });

  it("fails closed instead of generating a zero payroll result when no calculable payroll line exists", () => {
    expect(() =>
      calculatePayroll(basePayrollInput({
        standardizedInputs: [
          {
            ...salaryInput("input-foreign", "isForeignEmployee", 0),
            value: { value: true },
          },
        ],
      })),
    ).toThrow(PayrollEngineError);
  });
});

function component(overrides: Partial<PayrollComponentRef>): PayrollComponentRef {
  return {
    id: overrides.id ?? null,
    code: overrides.code ?? "COMPONENT",
    name: overrides.name ?? "Component",
    componentType: overrides.componentType ?? "EARNING",
    taxableCash: overrides.taxableCash ?? false,
    bpjsHealthBase: overrides.bpjsHealthBase ?? false,
    bpjsEmploymentBase: overrides.bpjsEmploymentBase ?? false,
    paidOut: overrides.paidOut ?? true,
    affectsNetPay: overrides.affectsNetPay ?? true,
    affectsEmployerCost: overrides.affectsEmployerCost ?? false,
  };
}

function withRuleContent(
  rules: PayrollEngineInput["ruleVersions"],
  ruleType: PayrollEngineInput["ruleVersions"][number]["ruleType"],
  content: Record<string, unknown>,
) {
  return rules.map((rule) => rule.ruleType === ruleType ? { ...rule, content } : rule);
}
