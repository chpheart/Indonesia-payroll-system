import { type PayrollEngineInput } from "@/domain/payroll-engine/engine-types";

export function basePayrollInput(overrides: Partial<PayrollEngineInput> = {}): PayrollEngineInput {
  return {
    runId: "run-a",
    clientId: "client-a",
    payrollMonth: "2026-06",
    resultVersionRef: "run:run-a:calc:test",
    employees: [
      {
        id: "employee-a",
        employeeCode: "E001",
        fullName: "Ayu",
        status: "ACTIVE",
        npwp: "09.123.456.7-890.000",
      },
    ],
    standardizedInputs: [salaryInput("input-gross", "grossSalaryAmount", 12_000_000)],
    ruleVersions: [
      {
        id: "rule-pph",
        ruleType: "PPH21",
        ruleKey: "PPH21_TER",
        versionNumber: 1,
        effectiveMonth: "2026-01",
        content: {
          monthlyTerRates: [{ upTo: null, rate: 0.05 }],
          ptkpByStatus: { "TK/0": 0 },
          defaultPtkpStatus: "TK/0",
          npwpPenaltyMultiplier: 1.2,
        },
      },
      {
        id: "rule-bpjs",
        ruleType: "BPJS",
        ruleKey: "BPJS_2026",
        versionNumber: 1,
        effectiveMonth: "2026-01",
        content: {
          healthEmployeeRate: 0.01,
          healthEmployerRate: 0.04,
          healthWageCap: 12_000_000,
          jhtEmployeeRate: 0.02,
          jhtEmployerRate: 0.037,
          jpEmployeeRate: 0.01,
          jpEmployerRate: 0.02,
          jkkEmployerRate: 0.0024,
          jkmEmployerRate: 0.003,
          employmentWageCap: 12_000_000,
          jpWageCap: 12_000_000,
        },
      },
      {
        id: "rule-thr",
        ruleType: "THR",
        ruleKey: "THR_2026",
        versionNumber: 1,
        effectiveMonth: "2026-01",
        content: { prorateDivisorMonths: 12, minMonthsForFullThr: 12 },
      },
      {
        id: "rule-gross-up",
        ruleType: "GROSS_UP",
        ruleKey: "GROSS_UP_2026",
        versionNumber: 1,
        effectiveMonth: "2026-01",
        content: { maxIterations: 80, toleranceIdr: 1 },
      },
      {
        id: "rule-rounding",
        ruleType: "ROUNDING",
        ruleKey: "IDR_ROUNDING",
        versionNumber: 1,
        effectiveMonth: "2026-01",
        content: { defaultMode: "HALF_UP" },
      },
    ],
    fxRates: [],
    clientConfig: { id: "config-a", grossUpDefault: false, bpjsConfig: {}, ruleConfig: {} },
    ...overrides,
  };
}

export function salaryInput(id: string, standardField: string, amount: number) {
  return {
    id,
    employeeId: "employee-a",
    versionNumber: 1,
    standardField,
    amount,
    currencyCode: "IDR",
    value: { amount },
    evidenceRefs: ["evidence-a"],
    payrollComponent: null,
  };
}
