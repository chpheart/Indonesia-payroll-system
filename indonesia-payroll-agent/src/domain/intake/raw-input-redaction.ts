import { createHash } from "node:crypto";

const SUMMARY_LIMIT = 260;

const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/\b\d{2}\.\d{3}\.\d{3}\.\d-\d{3}\.\d{3}\b/g, "[NPWP]"],
  [/\b\d{16}\b/g, "[ID_NUMBER]"],
  [/\b\d{10,20}\b/g, "[LONG_NUMBER]"],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]"],
  [/\b(?:\+?62|0)8\d{7,12}\b/g, "[PHONE]"],
];

const INSTRUCTION_LIKE_PATTERNS: Array<[RegExp, string]> = [
  [/忽略(系统|审批|规则|门禁|限制)/i, "PROMPT_INJECTION_CN"],
  [/直接(锁定|放行|导出|提交|报税|发送)/i, "UNAPPROVED_ACTION_CN"],
  [/自动(放行|审批|锁定|导出|提交)/i, "AUTONOMOUS_ACTION_CN"],
  [/ignore (previous|all|system) instructions?/i, "PROMPT_INJECTION_EN"],
  [/\b(bypass|skip)\s+(approval|review|guardrail|permission)/i, "BYPASS_APPROVAL_EN"],
  [/\b(call|execute|run)\s+(tool|api|function|command)/i, "TOOL_INSTRUCTION_EN"],
];

export function hashRawInputContent(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function redactSensitiveText(value: string): string {
  return SENSITIVE_PATTERNS.reduce(
    (redacted, [pattern, replacement]) => redacted.replace(pattern, replacement),
    value,
  );
}

export function summarizeRawInput(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const redacted = redactSensitiveText(normalized);

  return redacted.length > SUMMARY_LIMIT
    ? `${redacted.slice(0, SUMMARY_LIMIT - 1)}…`
    : redacted;
}

export function detectInstructionLikeContent(value: string): string[] {
  const flags = INSTRUCTION_LIKE_PATTERNS.flatMap(([pattern, flag]) =>
    pattern.test(value) ? [flag] : [],
  );

  return Array.from(new Set(flags));
}

export function evidenceCandidateRefForRawInput(rawInputItemId: string): string {
  return `raw-input:${rawInputItemId}`;
}
