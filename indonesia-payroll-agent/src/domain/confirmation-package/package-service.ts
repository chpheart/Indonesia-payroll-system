export type PayrollConfirmationRiskItem = {
  id?: string;
  issueType: string;
  status: "OPEN" | "APPROVED" | "REJECTED" | "VOIDED";
  riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  targetEmployeeId?: string | null;
  targetField?: string | null;
  title: string;
  detail: string;
  approvalReason?: string | null;
  evidenceRefs: string[];
};

export type PayrollConfirmationCheckItem = {
  id?: string;
  checkType: string;
  status: "PASSED" | "WARNING" | "BLOCKED" | "NOT_COVERED";
  riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  targetEmployeeId?: string | null;
  targetField?: string | null;
  message: string;
  detail: string;
};

export type PayrollConfirmationResultItem = {
  id?: string;
  employeeId: string;
  employeeCode?: string;
  fullName?: string;
  employeeStatus?: "ACTIVE" | "TERMINATED" | "DISABLED";
  grossPay: number;
  netPay: number;
  pph21: number;
  bpjsHealthEmployee: number;
  bpjsEmploymentEmployee: number;
  bpjsHealthEmployer: number;
  bpjsEmploymentEmployer: number;
  employerCost: number;
  traceCount: number;
  lineCount: number;
  comparisonDiffCount: number;
  isGrossUpEmployee?: boolean;
  hasForeignCurrencyInput?: boolean;
};

export type PayrollConfirmationInput = {
  run: {
    id: string;
    clientId: string;
    clientCode: string;
    clientName: string;
    payrollMonth: string;
    blockingIssueCount: number;
    highRiskIssueCount: number;
    pendingCustomerConfirmationCount: number;
    status: string;
  };
  resultVersionRef: string;
  results: PayrollConfirmationResultItem[];
  highRiskIssues: PayrollConfirmationRiskItem[];
  reconciliationChecks: PayrollConfirmationCheckItem[];
  customerConfirmationSummary: {
    latestPackId?: string | null;
    latestPackStatus?: string | null;
    openCriticalItemCount: number;
    validConfirmationCount: number;
  };
  traceability: {
    changeLedgerEntries: Record<string, unknown>[];
    fieldMappings: Record<string, unknown>[];
    standardizedInputs: Record<string, unknown>[];
    rawInputItems: Record<string, unknown>[];
    uploadedFiles: Record<string, unknown>[];
    ruleVersionSnapshot: unknown;
    correctionDeltas: Record<string, unknown>[];
  };
  auditEntryRefs: string[];
};

export type PayrollConfirmationPackageDraft = {
  status: "READY_FOR_REVIEW" | "DRAFT";
  summary: Record<string, unknown>;
  drilldown: Record<string, unknown>;
  gateSnapshot: Record<string, unknown>;
  previewDiff: Record<string, unknown>;
  auditEntryRefs: string[];
};

export type PayrollConfirmationGate = {
  canConfirmLock: boolean;
  failures: string[];
};

export function buildPayrollConfirmationPackage(
  input: PayrollConfirmationInput,
): PayrollConfirmationPackageDraft {
  const totals = resultTotals(input.results);
  const gate = evaluatePayrollConfirmationGate(input);
  const openHighRisk = input.highRiskIssues.filter((issue) => issue.status === "OPEN");
  const blockedChecks = input.reconciliationChecks.filter((check) => check.status === "BLOCKED");
  const warningChecks = input.reconciliationChecks.filter((check) => check.status === "WARNING");
  return {
    status: gate.canConfirmLock ? "READY_FOR_REVIEW" : "DRAFT",
    summary: {
      client: { id: input.run.clientId, code: input.run.clientCode, name: input.run.clientName },
      payrollMonth: input.run.payrollMonth,
      resultVersionRef: input.resultVersionRef,
      employeeCount: input.results.length,
      totals,
      riskSummary: {
        blockingIssueCount: input.run.blockingIssueCount,
        openHighRiskCount: openHighRisk.length,
        approvedHighRiskCount: input.highRiskIssues.filter((issue) => issue.status === "APPROVED").length,
        blockedReconciliationCount: blockedChecks.length,
        warningReconciliationCount: warningChecks.length,
      },
      customerConfirmationSummary: input.customerConfirmationSummary,
      traceabilitySummary: {
        changeLedgerEntryCount: input.traceability.changeLedgerEntries.length,
        fieldMappingCount: input.traceability.fieldMappings.length,
        standardizedInputCount: input.traceability.standardizedInputs.length,
        rawInputItemCount: input.traceability.rawInputItems.length,
        uploadedFileCount: input.traceability.uploadedFiles.length,
        correctionDeltaCount: input.traceability.correctionDeltas.length,
      },
    },
    drilldown: {
      employees: input.results.map((result) => ({
        employeeId: result.employeeId,
        employeeCode: result.employeeCode,
        fullName: result.fullName,
        employeeStatus: result.employeeStatus,
        grossPay: result.grossPay,
        netPay: result.netPay,
        pph21: result.pph21,
        bpjs: {
          healthEmployee: result.bpjsHealthEmployee,
          employmentEmployee: result.bpjsEmploymentEmployee,
          healthEmployer: result.bpjsHealthEmployer,
          employmentEmployer: result.bpjsEmploymentEmployer,
        },
        traceCount: result.traceCount,
        lineCount: result.lineCount,
        comparisonDiffCount: result.comparisonDiffCount,
        isGrossUpEmployee: result.isGrossUpEmployee ?? false,
        hasForeignCurrencyInput: result.hasForeignCurrencyInput ?? false,
      })),
      highRiskIssues: input.highRiskIssues,
      reconciliationChecks: input.reconciliationChecks,
      changeLedgerEntries: input.traceability.changeLedgerEntries,
      fieldMappings: input.traceability.fieldMappings,
      standardizedInputs: input.traceability.standardizedInputs,
      rawInputItems: input.traceability.rawInputItems,
      uploadedFiles: input.traceability.uploadedFiles,
      customerConfirmation: input.customerConfirmationSummary,
      ruleVersionSnapshot: input.traceability.ruleVersionSnapshot,
      correctionDeltas: input.traceability.correctionDeltas,
      auditEntryRefs: input.auditEntryRefs,
    },
    gateSnapshot: {
      canConfirmLock: gate.canConfirmLock,
      failures: gate.failures,
      requiredPreview: true,
      requiredDiff: true,
      requiredPermissionCheck: true,
      requiredAuditEntry: input.auditEntryRefs.length > 0,
    },
    previewDiff: {
      warnings: warningChecks.map((check) => check.message),
      blocked: blockedChecks.map((check) => check.message),
      openHighRisk: openHighRisk.map((issue) => issue.title),
    },
    auditEntryRefs: input.auditEntryRefs,
  };
}

export function evaluatePayrollConfirmationGate(
  input: PayrollConfirmationInput,
): PayrollConfirmationGate {
  const failures: string[] = [];
  if (input.run.blockingIssueCount > 0) failures.push("阻断项未清零");
  if (input.highRiskIssues.some((issue) => issue.status === "OPEN")) failures.push("高风险项未放行");
  if (input.run.pendingCustomerConfirmationCount > 0) failures.push("客户确认未闭合");
  if (input.reconciliationChecks.some((check) => check.status === "BLOCKED")) failures.push("核查项仍阻断");
  if (input.results.length === 0) failures.push("缺少 PayrollResult");
  if (input.results.some((result) => result.traceCount <= 0)) failures.push("CalculationTrace 不完整");
  if (input.auditEntryRefs.length === 0) failures.push("缺少审计记录入口");
  if (input.customerConfirmationSummary.openCriticalItemCount > 0) failures.push("客户确认包仍有关键项未处理");
  if (input.traceability.changeLedgerEntries.length === 0) failures.push("缺少 ChangeLedger 下钻入口");
  if (input.traceability.fieldMappings.length === 0) failures.push("缺少字段映射下钻入口");
  if (input.traceability.standardizedInputs.length === 0) failures.push("缺少标准化输入下钻入口");
  if (input.traceability.rawInputItems.length === 0 && input.traceability.uploadedFiles.length === 0) failures.push("缺少原始输入或原始文件定位");
  if (!hasRuleVersionSnapshot(input.traceability.ruleVersionSnapshot)) failures.push("规则版本快照缺失");
  return { canConfirmLock: failures.length === 0, failures };
}

function hasRuleVersionSnapshot(value: unknown) {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).length > 0;
}

function resultTotals(results: PayrollConfirmationResultItem[]) {
  return {
    grossPay: sum(results.map((result) => result.grossPay)),
    netPay: sum(results.map((result) => result.netPay)),
    pph21: sum(results.map((result) => result.pph21)),
    bpjsHealthEmployee: sum(results.map((result) => result.bpjsHealthEmployee)),
    bpjsEmploymentEmployee: sum(results.map((result) => result.bpjsEmploymentEmployee)),
    bpjsHealthEmployer: sum(results.map((result) => result.bpjsHealthEmployer)),
    bpjsEmploymentEmployer: sum(results.map((result) => result.bpjsEmploymentEmployer)),
    bpjsKsTotal: sum(results.map((result) => result.bpjsHealthEmployee + result.bpjsHealthEmployer)),
    bpjsTkTotal: sum(results.map((result) => result.bpjsEmploymentEmployee + result.bpjsEmploymentEmployer)),
    employerCost: sum(results.map((result) => result.employerCost)),
    grossUpCount: results.filter((result) => result.isGrossUpEmployee).length,
    foreignCurrencyCount: results.filter((result) => result.hasForeignCurrencyInput).length,
    terminatedEmployeeCount: results.filter((result) => result.employeeStatus === "TERMINATED").length,
  };
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
