import {
  canPerformClientAction,
  isSystemAdmin,
  type ActorContext,
} from "@/domain/auth/permissions";

export type RiskLevel = "R1" | "R2" | "R3" | "R4";

export type HighRiskIssueDraft = {
  issueType: string;
  riskLevel: RiskLevel;
  targetObjectType?: string;
  targetObjectId?: string;
  targetEmployeeId?: string;
  targetField?: string;
  title: string;
  detail: string;
  thresholdValue?: number;
  actualValue?: number;
  deltaValue?: number;
  evidenceRefs: string[];
  sourceRefs: Record<string, unknown>[];
};

export type HighRiskSignal = {
  type:
    | "GROSS_UP"
    | "FOREIGN_CURRENCY"
    | "CUSTOMER_TOTAL_ONLY"
    | "LOW_CONFIDENCE_MAPPING"
    | "TEMPLATE_STRUCTURE"
    | "CUSTOMER_COMPARISON_DIFF"
    | "HISTORICAL_VARIANCE"
    | "BPJS_BILL_DIFF"
    | "SEGREGATION_OF_DUTY";
  employeeId?: string;
  targetField?: string;
  targetObjectType?: string;
  targetObjectId?: string;
  actualValue?: number;
  thresholdValue?: number;
  deltaValue?: number;
  evidenceRefs?: string[];
  sourceRefs?: Record<string, unknown>[];
  message?: string;
};

export type RiskApprovalGate = {
  allowed: boolean;
  code:
    | "ALLOWED"
    | "SYSTEM_ADMIN_CANNOT_RELEASE"
    | "ROLE_MISSING_PERMISSION"
    | "SEGREGATION_OF_DUTY_RELEASE_DENIED";
  message: string;
};

export type RiskApprovalGateContext = {
  actorMaintainedKeyDataCount?: number;
};

const HIGH_RISK_COPY: Record<HighRiskSignal["type"], { title: string; detail: string }> = {
  GROSS_UP: {
    title: "Gross Up 员工需要业务放行",
    detail: "Gross Up 会改变税前、Tax Allowance、PPh21 和雇主成本，锁定或导出前必须由业务负责人复核。",
  },
  FOREIGN_CURRENCY: {
    title: "外币工资或员工级汇率需要业务放行",
    detail: "外币工资依赖客户确认汇率和员工级例外，必须确认汇率证据和税/BPJS 口径。",
  },
  CUSTOMER_TOTAL_ONLY: {
    title: "客户只提供合计工资",
    detail: "缺少项目明细时，系统只能按已发布客户规则拆解或作为统一应发处理，必须复核适用规则。",
  },
  LOW_CONFIDENCE_MAPPING: {
    title: "字段映射置信度不足",
    detail: "中/低置信或模板差异大的映射不能静默进入确认，需要人工复核影响字段。",
  },
  TEMPLATE_STRUCTURE: {
    title: "模板结构风险",
    detail: "客户文件或导出模板结构与历史版本差异较大，需确认人数、表头和关键金额口径。",
  },
  CUSTOMER_COMPARISON_DIFF: {
    title: "客户计算值差异超过阈值",
    detail: "客户 Excel 计算值只作为对照，差异超过阈值时不能覆盖系统确定性结果。",
  },
  HISTORICAL_VARIANCE: {
    title: "历史环比异常",
    detail: "员工或总额环比超过默认阈值，必须解释来源并保留放行理由。",
  },
  BPJS_BILL_DIFF: {
    title: "社保账单侧面核验差异",
    detail: "社保账单与系统 BPJS 结果存在差异，需确认账单覆盖范围和差异原因。",
  },
  SEGREGATION_OF_DUTY: {
    title: "职责分离冲突",
    detail: "同一人维护关键数据又尝试放行高风险 run，必须换人复核。",
  },
};

export function buildHighRiskIssues(signals: HighRiskSignal[]): HighRiskIssueDraft[] {
  return signals.map((signal) => {
    const copy = HIGH_RISK_COPY[signal.type];
    return {
      issueType: signal.type,
      riskLevel: riskLevelForSignal(signal),
      targetObjectType: signal.targetObjectType,
      targetObjectId: signal.targetObjectId,
      targetEmployeeId: signal.employeeId,
      targetField: signal.targetField,
      title: copy.title,
      detail: signal.message ? `${copy.detail} ${signal.message}` : copy.detail,
      thresholdValue: signal.thresholdValue,
      actualValue: signal.actualValue,
      deltaValue: signal.deltaValue,
      evidenceRefs: signal.evidenceRefs ?? [],
      sourceRefs: signal.sourceRefs ?? [],
    };
  });
}

export function evaluateRiskApprovalGate(
  actor: ActorContext,
  clientId: string,
  context: RiskApprovalGateContext = {},
): RiskApprovalGate {
  if (isSystemAdmin(actor)) {
    return {
      allowed: false,
      code: "SYSTEM_ADMIN_CANNOT_RELEASE",
      message: "系统管理员不能放行业务高风险项。",
    };
  }

  if (!canPerformClientAction(actor, "releaseHighRisk", clientId)) {
    return {
      allowed: false,
      code: "ROLE_MISSING_PERMISSION",
      message: "只有算薪负责人或交付主管可放行高风险项。",
    };
  }

  if ((context.actorMaintainedKeyDataCount ?? 0) > 0) {
    return {
      allowed: false,
      code: "SEGREGATION_OF_DUTY_RELEASE_DENIED",
      message: "同一人维护过本 run 的关键数据，不能放行高风险项；请换有权限的人复核。",
    };
  }

  return { allowed: true, code: "ALLOWED", message: "具备高风险放行权限。" };
}

function riskLevelForSignal(signal: HighRiskSignal): RiskLevel {
  if (signal.type === "SEGREGATION_OF_DUTY") return "R4";
  if ((signal.deltaValue ?? 0) > 1_000_000) return "R4";
  return "R3";
}
