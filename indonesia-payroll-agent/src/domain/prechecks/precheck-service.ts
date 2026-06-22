export const REQUIRED_PAYROLL_RULE_TYPES = [
  "PPH21",
  "BPJS",
  "THR",
  "GROSS_UP",
  "ROUNDING",
] as const;

export type PrecheckRuleType = (typeof REQUIRED_PAYROLL_RULE_TYPES)[number];
export type PrecheckGateStatus = "PASSED" | "BLOCKED";
export type PrecheckRunStatus = "PASSED" | "BLOCKED";

export type PrecheckGateCode =
  | "run_writable"
  | "permission"
  | "rule_versions"
  | "client_config"
  | "change_ledger"
  | "field_mapping"
  | "standardized_inputs"
  | "gross_up_mode"
  | "customer_confirmation"
  | "fx_rates"
  | "high_risk_candidates"
  | "blocking_issues";

export type PrecheckGateResult = {
  code: PrecheckGateCode;
  status: PrecheckGateStatus;
  message: string;
  evidence: Record<string, string | number | boolean | null>;
};

export type PrecheckBlockingIssueDraft = {
  issueType: string;
  riskLevel: "R1" | "R2" | "R3" | "R4";
  targetObjectType?: string;
  targetObjectId?: string;
  targetEmployeeId?: string;
  targetField?: string;
  title: string;
  detail: string;
  evidenceRefs: string[];
};

export type PrecheckHighRiskIssueDraft = {
  issueType: string;
  riskLevel: "R3" | "R4";
  targetObjectType?: string;
  targetObjectId?: string;
  targetEmployeeId?: string;
  targetField?: string;
  title: string;
  detail: string;
  evidenceRefs: string[];
};

export type PrecheckSnapshot = {
  run: {
    id: string;
    clientId: string;
    payrollMonth: string;
    status: string;
    lockedAt?: Date | null;
    pendingCustomerConfirmationCount: number;
  };
  actorCanExecuteCalculation: boolean;
  publishedRuleTypes: PrecheckRuleType[];
  publishedRuleCount: number;
  effectiveClientConfigCount: number;
  clientGrossUpDefault: boolean;
  pendingChangeProposalCount: number;
  approvedProposalWithoutLedgerCount: number;
  confirmedMappingCount: number;
  confirmedStandardizedInputCount: number;
  unconfirmedStandardizedInputCount: number;
  criticalInputEvidenceMissingCount: number;
  standardizedInputEmployeeMissingCount: number;
  employeeWithoutCalculablePayrollInputCount: number;
  netPayModeInputCount: number;
  grossUpOverrideInputCount: number;
  netPayModeWithoutGrossUpEmployeeCount: number;
  requiredFxCurrencies: string[];
  confirmedFxCurrencies: string[];
  unconfirmedFxCurrencies: string[];
  employeeMasterCriticalChangeCount?: number;
  grossUpEmployeeCount?: number;
  foreignCurrencyEmployeeCount?: number;
  customerTotalOnlyInputCount?: number;
  lowConfidenceMappingCount?: number;
  templateStructureRiskCount?: number;
  segregationOfDutyRiskCount?: number;
  latestCustomerConfirmationPack?: {
    id: string;
    status: string;
  } | null;
  openBlockingIssueCount: number;
};

export type PrecheckEvaluation = {
  status: PrecheckRunStatus;
  gates: PrecheckGateResult[];
  issues: PrecheckBlockingIssueDraft[];
  highRiskIssues: PrecheckHighRiskIssueDraft[];
};

const HISTORY_STATUSES = new Set(["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"]);
const CLOSED_CUSTOMER_CONFIRMATION_PACK_STATUSES = new Set(["CONFIRMED"]);

export function evaluatePayrollPrecheck(snapshot: PrecheckSnapshot): PrecheckEvaluation {
  const gates: PrecheckGateResult[] = [];
  const issues: PrecheckBlockingIssueDraft[] = [];
  const highRiskIssues: PrecheckHighRiskIssueDraft[] = [];
  checkRun(snapshot, gates, issues);
  checkPermission(snapshot, gates, issues);
  checkRules(snapshot, gates, issues);
  checkClientConfig(snapshot, gates, issues);
  checkChangeLedger(snapshot, gates, issues);
  checkMappings(snapshot, gates, issues);
  checkStandardizedInputs(snapshot, gates, issues);
  checkGrossUpMode(snapshot, gates, issues);
  checkCustomerConfirmation(snapshot, gates, issues);
  checkFxRates(snapshot, gates, issues);
  checkHighRiskCandidates(snapshot, gates, highRiskIssues);
  checkOpenBlockers(snapshot, gates, issues);

  return {
    status: issues.length === 0 ? "PASSED" : "BLOCKED",
    gates,
    issues,
    highRiskIssues,
  };
}

function checkRun(
  snapshot: PrecheckSnapshot,
  gates: PrecheckGateResult[],
  issues: PrecheckBlockingIssueDraft[],
) {
  const blocked = HISTORY_STATUSES.has(snapshot.run.status) || Boolean(snapshot.run.lockedAt);
  gates.push(gate("run_writable", !blocked, blocked ? "历史 run 必须走 correction run" : "run 可预检查", {
    status: snapshot.run.status,
  }));
  if (blocked) {
    issues.push(issue("RUN_NOT_WRITABLE", "R4", "历史 run 不可重新算薪", "已锁定或历史状态的 run 不能直接进入正式算薪。"));
  }
}

function checkPermission(
  snapshot: PrecheckSnapshot,
  gates: PrecheckGateResult[],
  issues: PrecheckBlockingIssueDraft[],
) {
  gates.push(gate("permission", snapshot.actorCanExecuteCalculation, snapshot.actorCanExecuteCalculation ? "权限已确认" : "权限不明或不足", {}));
  if (!snapshot.actorCanExecuteCalculation) {
    issues.push(issue("CALCULATION_PERMISSION_MISSING", "R4", "算薪权限不足", "只有有 calculation.execute 权限且在客户授权范围内的人才能进入正式算薪。"));
  }
}

function checkRules(
  snapshot: PrecheckSnapshot,
  gates: PrecheckGateResult[],
  issues: PrecheckBlockingIssueDraft[],
) {
  const published = new Set(snapshot.publishedRuleTypes);
  const missing = REQUIRED_PAYROLL_RULE_TYPES.filter((ruleType) => !published.has(ruleType));
  gates.push(gate("rule_versions", missing.length === 0, missing.length === 0 ? "规则版本完整" : "规则版本缺失", {
    publishedRuleCount: snapshot.publishedRuleCount,
    missingRuleTypeCount: missing.length,
  }));
  for (const ruleType of missing) {
    issues.push(issue("RULE_VERSION_MISSING", "R4", `${ruleType} 规则版本缺失`, "正式算薪必须引用已发布规则版本。", {
      targetObjectType: "RULE_VERSION",
      targetField: ruleType,
    }));
  }
}

function checkClientConfig(snapshot: PrecheckSnapshot, gates: PrecheckGateResult[], issues: PrecheckBlockingIssueDraft[]) {
  const ok = snapshot.effectiveClientConfigCount > 0;
  gates.push(gate("client_config", ok, ok ? "客户配置已生效" : "客户配置缺失", {
    effectiveClientConfigCount: snapshot.effectiveClientConfigCount,
  }));
  if (!ok) {
    issues.push(issue("CLIENT_CONFIG_MISSING", "R3", "客户配置缺失", "缺少当月可用的客户配置版本，不能判断 Gross Up、BPJS 和客户口径。"));
  }
}

function checkChangeLedger(snapshot: PrecheckSnapshot, gates: PrecheckGateResult[], issues: PrecheckBlockingIssueDraft[]) {
  const ok = snapshot.pendingChangeProposalCount === 0 && snapshot.approvedProposalWithoutLedgerCount === 0;
  gates.push(gate("change_ledger", ok, ok ? "ChangeLedger 已闭合" : "ChangeProposal 未闭合", {
    pendingChangeProposalCount: snapshot.pendingChangeProposalCount,
    approvedProposalWithoutLedgerCount: snapshot.approvedProposalWithoutLedgerCount,
  }));
  if (snapshot.pendingChangeProposalCount > 0) {
    issues.push(issue("CHANGE_PROPOSAL_PENDING_REVIEW", "R3", "存在未审核 ChangeProposal", "AI 或人工提议未审核完，不能进入正式算薪。"));
  }
  if (snapshot.approvedProposalWithoutLedgerCount > 0) {
    issues.push(issue("CHANGE_LEDGER_MISSING", "R4", "已审核变更未写入 ChangeLedger", "已采纳 proposal 必须先生成不可变 ChangeLedgerEntry。"));
  }
}

function checkMappings(snapshot: PrecheckSnapshot, gates: PrecheckGateResult[], issues: PrecheckBlockingIssueDraft[]) {
  const ok = snapshot.confirmedMappingCount > 0;
  gates.push(gate("field_mapping", ok, ok ? "字段映射已确认" : "字段映射缺失", {
    confirmedMappingCount: snapshot.confirmedMappingCount,
  }));
  if (!ok) {
    issues.push(issue("FIELD_MAPPING_CONFIRMED_REQUIRED", "R3", "缺少已确认字段映射", "正式算薪只能使用已人工确认的字段映射。"));
  }
}

function checkStandardizedInputs(snapshot: PrecheckSnapshot, gates: PrecheckGateResult[], issues: PrecheckBlockingIssueDraft[]) {
  const ok = snapshot.confirmedStandardizedInputCount > 0 && snapshot.unconfirmedStandardizedInputCount === 0 && snapshot.criticalInputEvidenceMissingCount === 0 && snapshot.standardizedInputEmployeeMissingCount === 0 && snapshot.employeeWithoutCalculablePayrollInputCount === 0;
  gates.push(gate("standardized_inputs", ok, ok ? "标准化输入已确认" : "标准化输入未闭合", {
    confirmedStandardizedInputCount: snapshot.confirmedStandardizedInputCount,
    unconfirmedStandardizedInputCount: snapshot.unconfirmedStandardizedInputCount,
    criticalInputEvidenceMissingCount: snapshot.criticalInputEvidenceMissingCount,
    standardizedInputEmployeeMissingCount: snapshot.standardizedInputEmployeeMissingCount,
    employeeWithoutCalculablePayrollInputCount: snapshot.employeeWithoutCalculablePayrollInputCount,
  }));
  if (snapshot.confirmedStandardizedInputCount === 0) issues.push(issue("STANDARDIZED_INPUT_REQUIRED", "R4", "没有已确认标准化输入", "正式算薪没有可信输入。"));
  if (snapshot.unconfirmedStandardizedInputCount > 0) issues.push(issue("STANDARDIZED_INPUT_UNCONFIRMED", "R3", "存在未确认标准化输入", "PREVIEW/BLOCKED/INVALIDATED 输入不能进入正式算薪。"));
  if (snapshot.criticalInputEvidenceMissingCount > 0) issues.push(issue("CRITICAL_INPUT_EVIDENCE_MISSING", "R3", "关键算薪字段缺证据", "关键金额、税务、社保、银行或员工范围字段必须绑定有效证据。"));
  if (snapshot.standardizedInputEmployeeMissingCount > 0) issues.push(issue("STANDARDIZED_INPUT_EMPLOYEE_MISSING", "R3", "标准化输入未绑定员工", "员工级算薪必须能追到员工主档。"));
  if (snapshot.employeeWithoutCalculablePayrollInputCount > 0) issues.push(issue("CALCULABLE_PAYROLL_INPUT_REQUIRED", "R4", "员工缺少可计算薪资输入", "每个进入正式算薪的员工必须至少有一个工资、THR、应税/发放收入或 Gross Up 目标到手输入。"));
}

function checkGrossUpMode(snapshot: PrecheckSnapshot, gates: PrecheckGateResult[], issues: PrecheckBlockingIssueDraft[]) {
  const ok = snapshot.netPayModeWithoutGrossUpEmployeeCount === 0;
  gates.push(gate("gross_up_mode", ok, ok ? "Gross Up 模式无冲突" : "税后/到手字段需要确认 Gross Up 模式", {
    netPayModeInputCount: snapshot.netPayModeInputCount,
    grossUpOverrideInputCount: snapshot.grossUpOverrideInputCount,
    clientGrossUpDefault: snapshot.clientGrossUpDefault,
    netPayModeWithoutGrossUpEmployeeCount: snapshot.netPayModeWithoutGrossUpEmployeeCount,
  }));
  if (!ok) {
    issues.push(issue("GROSS_UP_MODE_CONFIRMATION_REQUIRED", "R4", "税后/到手字段未确认 Gross Up 模式", "原始输入出现税后、到手或 Net 口径字段，但客户配置和员工覆盖都不是 Gross Up，必须先阻断确认计算模式。"));
  }
}

function checkCustomerConfirmation(snapshot: PrecheckSnapshot, gates: PrecheckGateResult[], issues: PrecheckBlockingIssueDraft[]) {
  const pack = snapshot.latestCustomerConfirmationPack;
  const ok = Boolean(pack && CLOSED_CUSTOMER_CONFIRMATION_PACK_STATUSES.has(pack.status)) && snapshot.run.pendingCustomerConfirmationCount === 0;
  gates.push(gate("customer_confirmation", ok, ok ? "客户确认已闭合" : "客户确认状态不满足算薪", {
    pendingCustomerConfirmationCount: snapshot.run.pendingCustomerConfirmationCount,
    latestPackStatus: pack?.status ?? null,
  }));
  if (!ok) {
    issues.push(issue("CUSTOMER_CONFIRMATION_NOT_CLOSED", "R3", "客户确认未闭合", "缺少可用客户确认包，或仍有待确认/失效确认项。"));
  }
}

function checkFxRates(snapshot: PrecheckSnapshot, gates: PrecheckGateResult[], issues: PrecheckBlockingIssueDraft[]) {
  const confirmed = new Set(snapshot.confirmedFxCurrencies);
  const missing = snapshot.requiredFxCurrencies.filter((currency) => !confirmed.has(currency));
  const unconfirmed = snapshot.unconfirmedFxCurrencies.filter((currency) => snapshot.requiredFxCurrencies.includes(currency));
  const ok = missing.length === 0 && unconfirmed.length === 0;
  gates.push(gate("fx_rates", ok, ok ? "外币汇率已确认" : "外币汇率缺失或未确认", {
    requiredCurrencyCount: snapshot.requiredFxCurrencies.length,
    missingCurrencyCount: missing.length,
    unconfirmedCurrencyCount: unconfirmed.length,
  }));
  for (const currency of [...new Set([...missing, ...unconfirmed])]) {
    issues.push(issue("FX_RATE_MISSING_OR_UNCONFIRMED", "R3", `${currency} 汇率缺失或未确认`, "外币工资缺少客户确认汇率时不得计算。", { targetObjectType: "FX_RATE_VERSION", targetField: currency }));
  }
}

function checkOpenBlockers(snapshot: PrecheckSnapshot, gates: PrecheckGateResult[], issues: PrecheckBlockingIssueDraft[]) {
  const ok = snapshot.openBlockingIssueCount === 0;
  gates.push(gate("blocking_issues", ok, ok ? "无历史阻断项" : "仍有未解决阻断项", {
    openBlockingIssueCount: snapshot.openBlockingIssueCount,
  }));
  if (!ok) issues.push(issue("BLOCKING_ISSUE_OPEN", "R4", "仍有未解决阻断项", "阻断项清零前不得正式算薪。"));
}

function gate(code: PrecheckGateCode, ok: boolean, message: string, evidence: PrecheckGateResult["evidence"]): PrecheckGateResult {
  return { code, status: ok ? "PASSED" : "BLOCKED", message, evidence };
}

function issue(
  issueType: string,
  riskLevel: PrecheckBlockingIssueDraft["riskLevel"],
  title: string,
  detail: string,
  extra: Partial<PrecheckBlockingIssueDraft> = {},
): PrecheckBlockingIssueDraft {
  return { issueType, riskLevel, title, detail, evidenceRefs: [], ...extra };
}
import { checkHighRiskCandidates } from "@/domain/prechecks/precheck-high-risk";
