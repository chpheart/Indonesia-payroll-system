import {
  type PrecheckGateResult,
  type PrecheckHighRiskIssueDraft,
  type PrecheckSnapshot,
} from "@/domain/prechecks/precheck-service";

type HighRiskCandidate = readonly [string, number, string, string];

export function checkHighRiskCandidates(
  snapshot: PrecheckSnapshot,
  gates: PrecheckGateResult[],
  highRiskIssues: PrecheckHighRiskIssueDraft[],
) {
  const candidates: HighRiskCandidate[] = [
    ["EMPLOYEE_MASTER_CRITICAL_CHANGE", snapshot.employeeMasterCriticalChangeCount ?? 0, "员工主档关键字段变更", "关键身份、税务、社保、银行或雇佣状态变化必须进入高风险复核。"],
    ["GROSS_UP", snapshot.grossUpEmployeeCount ?? 0, "Gross Up 员工", "Gross Up 会影响税前、Tax Allowance、PPh21 和雇主成本，锁定前必须业务放行。"],
    ["FOREIGN_CURRENCY", snapshot.foreignCurrencyEmployeeCount ?? 0, "外币工资或员工级特殊汇率", "外币工资依赖客户确认汇率和规则口径，必须展示证据和差异。"],
    ["CUSTOMER_TOTAL_ONLY", snapshot.customerTotalOnlyInputCount ?? 0, "客户只给工资合计", "缺少项目明细时必须确认客户规则，不得交给客服临时拆分。"],
    ["LOW_CONFIDENCE_MAPPING", snapshot.lowConfidenceMappingCount ?? 0, "字段映射置信度不足", "中/低置信映射或历史模板差异大必须复核影响字段。"],
    ["TEMPLATE_STRUCTURE_RISK", snapshot.templateStructureRiskCount ?? 0, "模板结构风险", "模板结构差异会影响人数、字段和导出口径，必须进入确认包。"],
    ["SEGREGATION_OF_DUTY", snapshot.segregationOfDutyRiskCount ?? 0, "职责分离冲突", "同一人维护关键数据又尝试放行高风险 run 时必须换人复核。"],
  ];
  const total = candidates.reduce((count, [, value]) => count + value, 0);
  gates.push({
    code: "high_risk_candidates",
    status: "PASSED",
    message: total === 0 ? "无预检查高风险候选" : "高风险候选已分流到业务放行",
    evidence: { highRiskCandidateCount: total },
  });
  for (const [issueType, count, title, detail] of candidates) {
    if (count <= 0) continue;
    highRiskIssues.push({
      issueType,
      riskLevel: issueType === "SEGREGATION_OF_DUTY" ? "R4" : "R3",
      title,
      detail,
      evidenceRefs: [],
    });
  }
}
