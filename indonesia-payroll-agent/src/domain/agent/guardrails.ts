import {
  actorCanAccessClient,
  actorHasPermission,
  type ActorContext,
} from "@/domain/auth/permissions";
import { type GuardrailAction, type GuardrailSeverity, type JsonObject } from "@/domain/agent/agent-types";
import { detectPromptInjection, redactTracePayload } from "@/domain/agent/trace-redaction-policy";

export type GuardrailIssueCode =
  | "PROMPT_INJECTION"
  | "EXTERNAL_TOOL_CALL_BLOCKED"
  | "UNAUTHORIZED_CLIENT_ACCESS"
  | "SENSITIVE_FIELD_ACCESS_DENIED"
  | "SENSITIVE_LEAKAGE_REDACTED"
  | "AUTO_RELEASE_BLOCKED"
  | "PROPOSAL_DIRECT_WRITE_BLOCKED"
  | "CONFIRMATION_PACK_CRITICAL_OMISSION"
  | "HIGH_RISK_GATE_BYPASS_BLOCKED"
  | "RAG_CONFLICT_PUBLISHED_RULE_WINS";

export type GuardrailIssue = {
  code: GuardrailIssueCode;
  severity: GuardrailSeverity;
  action: GuardrailAction;
  message: string;
  evidence: string[];
};

export type AgentGuardrailInput = {
  actor?: ActorContext;
  requestedClientId?: string;
  requestedSensitiveFields?: string[];
  allowedSensitiveFields?: string[];
  externalContent?: unknown;
  modelOutput?: unknown;
  requestedAction?: "VIEW" | "EXPORT" | "WRITE" | "APPROVE" | "TOOL_CALL";
  externalContentAttemptedToolCall?: boolean;
  requestedAutoRelease?: boolean;
  proposalWriteTargets?: string[];
  omittedConfirmationItems?: string[];
  bypassHighRiskGate?: boolean;
  ragConflictWithPublishedRule?: boolean;
};

export type GuardrailDecision = {
  action: GuardrailAction;
  severity: GuardrailSeverity;
  passed: boolean;
  issues: GuardrailIssue[];
  redactionApplied: boolean;
  redactedOutput: unknown;
};

const PROTECTED_WRITE_TARGETS = new Set([
  "ChangeLedger",
  "EmployeeMaster",
  "StandardizedPayrollInput",
  "PayrollResult",
  "ExportPreview",
]);

const SENSITIVE_FIELD_NAMES = ["bankAccount", "bankAccountNumber", "npwp", "nik", "passport", "idNumber"];

export function evaluateAgentGuardrails(input: AgentGuardrailInput): GuardrailDecision {
  const issues: GuardrailIssue[] = [];
  const externalHits = detectPromptInjection(input.externalContent);
  const outputHits = detectSensitiveLeakage(input.modelOutput);
  const redacted = redactTracePayload(input.modelOutput ?? {});

  if (externalHits.length > 0) {
    issues.push({
      code: "PROMPT_INJECTION",
      severity: "CRITICAL",
      action: "NEEDS_REVIEW",
      message: "外部内容里的指令只能作为客户数据保存，不得改写系统规则。",
      evidence: externalHits,
    });
  }

  if (input.externalContentAttemptedToolCall) {
    issues.push({
      code: "EXTERNAL_TOOL_CALL_BLOCKED",
      severity: "CRITICAL",
      action: "BLOCK",
      message: "客户文件、截图、RAG 文档和备注不得触发工具调用。",
      evidence: ["externalContentAttemptedToolCall"],
    });
  }

  if (input.actor && input.requestedClientId && !actorCanAccessClient(input.actor, input.requestedClientId)) {
    issues.push({
      code: "UNAUTHORIZED_CLIENT_ACCESS",
      severity: "CRITICAL",
      action: "BLOCK",
      message: "当前用户无权访问目标客户。",
      evidence: [input.requestedClientId],
    });
  }

  if (hasDeniedSensitiveField(input)) {
    issues.push({
      code: "SENSITIVE_FIELD_ACCESS_DENIED",
      severity: "CRITICAL",
      action: "BLOCK",
      message: "敏感字段不满足最小必要或权限要求。",
      evidence: input.requestedSensitiveFields ?? [],
    });
  }

  if (outputHits.length > 0) {
    issues.push({
      code: "SENSITIVE_LEAKAGE_REDACTED",
      severity: "CRITICAL",
      action: "REDACT",
      message: "模型输出包含敏感字段，必须脱敏并记录 guardrail。",
      evidence: outputHits,
    });
  }

  if (input.requestedAutoRelease) {
    issues.push({
      code: "AUTO_RELEASE_BLOCKED",
      severity: "CRITICAL",
      action: "BLOCK",
      message: "Agent 不得自动放行工资、导出、锁定或高风险事项。",
      evidence: [input.requestedAction ?? "APPROVE"],
    });
  }

  const directWriteTargets = (input.proposalWriteTargets ?? []).filter((target) =>
    PROTECTED_WRITE_TARGETS.has(target),
  );
  if (directWriteTargets.length > 0) {
    issues.push({
      code: "PROPOSAL_DIRECT_WRITE_BLOCKED",
      severity: "CRITICAL",
      action: "BLOCK",
      message: "Agent 只能生成 ChangeProposal，不得直接写入确定性事实或算薪结果。",
      evidence: directWriteTargets,
    });
  }

  if ((input.omittedConfirmationItems ?? []).length > 0) {
    issues.push({
      code: "CONFIRMATION_PACK_CRITICAL_OMISSION",
      severity: "CRITICAL",
      action: "BLOCK",
      message: "客户确认包不得遗漏阻断、高风险、确认失效或关键缺失。",
      evidence: input.omittedConfirmationItems ?? [],
    });
  }

  if (input.bypassHighRiskGate) {
    issues.push({
      code: "HIGH_RISK_GATE_BYPASS_BLOCKED",
      severity: "CRITICAL",
      action: "BLOCK",
      message: "高风险放行必须保留人工确认卡口。",
      evidence: ["bypassHighRiskGate"],
    });
  }

  if (input.ragConflictWithPublishedRule) {
    issues.push({
      code: "RAG_CONFLICT_PUBLISHED_RULE_WINS",
      severity: "WARNING",
      action: "NEEDS_REVIEW",
      message: "RAG 内容与已发布规则冲突时，以已发布规则版本为准。",
      evidence: ["ragConflictWithPublishedRule"],
    });
  }

  return {
    action: strongestAction(issues),
    severity: strongestSeverity(issues),
    passed: issues.length === 0,
    issues,
    redactionApplied: redacted.stats.redactedFieldCount > 0 || outputHits.length > 0,
    redactedOutput: redacted.value,
  };
}

export function summarizeGuardrailDecision(decision: GuardrailDecision): JsonObject {
  return {
    action: decision.action,
    severity: decision.severity,
    passed: decision.passed,
    issueCodes: decision.issues.map((issue) => issue.code),
    redactionApplied: decision.redactionApplied,
    externalInstructionIgnored: decision.issues.some((issue) => issue.code === "PROMPT_INJECTION"),
    toolCallAllowed: !decision.issues.some((issue) => issue.code === "EXTERNAL_TOOL_CALL_BLOCKED"),
    sensitiveLeakBlocked: decision.issues.some((issue) =>
      ["SENSITIVE_FIELD_ACCESS_DENIED", "SENSITIVE_LEAKAGE_REDACTED"].includes(issue.code),
    ),
    proposalWriteBlocked: decision.issues.some((issue) => issue.code === "PROPOSAL_DIRECT_WRITE_BLOCKED"),
    publishedRuleWins: decision.issues.some((issue) => issue.code === "RAG_CONFLICT_PUBLISHED_RULE_WINS"),
  };
}

function hasDeniedSensitiveField(input: AgentGuardrailInput): boolean {
  const requested = input.requestedSensitiveFields ?? [];
  if (requested.length === 0) {
    return false;
  }

  const allowed = new Set(input.allowedSensitiveFields ?? []);
  const outsideMinimumNecessary = requested.some((field) => !allowed.has(field));
  const lacksSensitivePermission = input.actor ? !actorHasPermission(input.actor, "sensitive.view") : true;
  return outsideMinimumNecessary || lacksSensitivePermission;
}

function detectSensitiveLeakage(value: unknown): string[] {
  const strings = collectStrings(value).join("\n");
  const hitNames = SENSITIVE_FIELD_NAMES.filter((fieldName) => new RegExp(fieldName, "i").test(strings));
  const longNumbers = strings.match(/\b\d[\d\s.-]{9,}\d\b/g) ?? [];
  return [...hitNames, ...longNumbers.map((match) => `number:${match.slice(0, 4)}...`)];
}

function strongestAction(issues: GuardrailIssue[]): GuardrailAction {
  if (issues.some((issue) => issue.action === "BLOCK")) {
    return "BLOCK";
  }
  if (issues.some((issue) => issue.action === "REDACT")) {
    return "REDACT";
  }
  if (issues.some((issue) => issue.action === "NEEDS_REVIEW")) {
    return "NEEDS_REVIEW";
  }
  if (issues.some((issue) => issue.action === "FLAG")) {
    return "FLAG";
  }
  return "PASS";
}

function strongestSeverity(issues: GuardrailIssue[]): GuardrailSeverity {
  if (issues.some((issue) => issue.severity === "CRITICAL")) {
    return "CRITICAL";
  }
  if (issues.some((issue) => issue.severity === "WARNING")) {
    return "WARNING";
  }
  return "INFO";
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectStrings(item));
  }
  return [];
}
