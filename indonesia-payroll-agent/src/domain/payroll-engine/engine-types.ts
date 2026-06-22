export type RoundingMode = "HALF_UP" | "UP" | "DOWN" | "TRUNCATE";

export type PayrollRuleRef = {
  id: string;
  ruleType: "PPH21" | "BPJS" | "THR" | "GROSS_UP" | "ROUNDING" | "CUSTOMER_POLICY";
  ruleKey: string;
  versionNumber: number;
  effectiveMonth: string;
  content: Record<string, unknown>;
};

export type FXRateRef = {
  id: string;
  currencyCode: string;
  rate: number;
  employeeOverrides?: {
    employeeId: string;
    rate: number;
  }[];
};

export type ClientConfigRef = {
  id: string;
  grossUpDefault: boolean;
  bpjsConfig: Record<string, unknown>;
  ruleConfig: Record<string, unknown>;
};

export type PayrollEmployeeRef = {
  id: string;
  employeeCode: string;
  fullName: string;
  status: "ACTIVE" | "TERMINATED" | "DISABLED";
  npwp?: string | null;
};

export type PayrollComponentRef = {
  id?: string | null;
  code: string;
  name: string;
  componentType: "EARNING" | "DEDUCTION" | "TAX_ALLOWANCE" | "BENEFIT" | "EMPLOYER_COST" | "MEMO";
  taxableCash: boolean;
  bpjsHealthBase: boolean;
  bpjsEmploymentBase: boolean;
  paidOut: boolean;
  affectsNetPay: boolean;
  affectsEmployerCost: boolean;
};

export type PayrollStandardizedInput = {
  id: string;
  employeeId: string;
  versionNumber: number;
  standardField: string;
  componentCode?: string | null;
  amount?: number | null;
  currencyCode: string;
  value: Record<string, unknown>;
  evidenceRefs: string[];
  sourceCellId?: string | null;
  sourceSheetName?: string | null;
  payrollComponent?: PayrollComponentRef | null;
};

export type PayrollEngineInput = {
  runId: string;
  clientId: string;
  payrollMonth: string;
  resultVersionRef: string;
  employees: PayrollEmployeeRef[];
  standardizedInputs: PayrollStandardizedInput[];
  ruleVersions: PayrollRuleRef[];
  fxRates: FXRateRef[];
  clientConfig: ClientConfigRef;
  postcheckContext?: {
    previousTotals?: {
      employeeCount: number;
      grossPay: number;
      netPay: number;
      pph21: number;
      bpjsEmployee: number;
      employerCost: number;
    };
    bpjsBillTotals?: {
      healthEmployee?: number;
      employmentEmployee?: number;
      healthEmployer?: number;
      employmentEmployer?: number;
    };
    exportPreviewEmployeeCount?: number;
  };
};

export type PayrollResultLineDraft = {
  lineType:
    | "EARNING"
    | "DEDUCTION"
    | "TAX"
    | "EMPLOYEE_CONTRIBUTION"
    | "EMPLOYER_CONTRIBUTION"
    | "TAX_ALLOWANCE"
    | "THR"
    | "MEMO";
  componentCode: string;
  label: string;
  amount: number;
  currencyCode: string;
  taxableCash: boolean;
  bpjsHealthBase: boolean;
  bpjsEmploymentBase: boolean;
  paidOut: boolean;
  affectsNetPay: boolean;
  affectsEmployerCost: boolean;
  sourceInputIds: string[];
  sourceInputRefs: Record<string, unknown>[];
  ruleVersionRefs: string[];
  traceRef?: string;
};

export type CalculationTraceDraft = {
  resultField: string;
  traceType: string;
  inputRefs: Record<string, unknown>[];
  ruleVersionRefs: string[];
  formula: string;
  parameters: Record<string, unknown>;
  intermediateValues: Record<string, unknown>;
  rounding: Record<string, unknown>;
  outputValue: number;
};

export type CustomerComparisonValueDraft = {
  employeeId?: string;
  sourceInputId?: string;
  targetField: string;
  customerValue: number;
  systemValue?: number;
  delta?: number;
  status: "MATCH" | "DIFF" | "CUSTOMER_ONLY" | "SYSTEM_ONLY";
  currencyCode: string;
  sourceLabel: string;
  sourceCellId?: string | null;
};

export type PayrollResultDraft = {
  employeeId: string;
  resultVersionRef: string;
  grossPay: number;
  taxableIncome: number;
  pph21: number;
  bpjsHealthEmployee: number;
  bpjsEmploymentEmployee: number;
  bpjsHealthEmployer: number;
  bpjsEmploymentEmployer: number;
  totalDeductions: number;
  netPay: number;
  employerCost: number;
  currencyCode: "IDR";
  sourceVersionSnapshot: Record<string, unknown>;
  lines: PayrollResultLineDraft[];
  traces: CalculationTraceDraft[];
  comparisonValues: CustomerComparisonValueDraft[];
};

export type PayrollEngineOutput = {
  resultVersionRef: string;
  results: PayrollResultDraft[];
};
