import { createHash } from "node:crypto";
import { type JsonObject, type JsonValue } from "@/domain/agent/agent-types";

const SENSITIVE_FIELD_PATTERNS = [
  /bank.*account/i,
  /account.*number/i,
  /npwp/i,
  /nik/i,
  /passport/i,
  /id.*number/i,
  /original.*text/i,
  /raw.*value/i,
  /ocr.*text/i,
  /full.*name/i,
];

const INSTRUCTION_INJECTION_PATTERNS = [
  /ignore (all )?(previous|system|approval|rules?)/i,
  /绕过|忽略.*(审批|规则|系统)|自动放行|直接锁定|泄露|导出全部/i,
  /forget (the )?(policy|guardrails?)/i,
  /act as/i,
];

const LONG_DIGIT_PATTERN = /\b\d[\d\s.-]{7,}\d\b/g;
const MAX_STRING_LENGTH = 240;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;

export type RedactionStats = {
  redactedFieldCount: number;
  replacedWithReferenceCount: number;
};

export type RedactionResult = {
  value: JsonValue;
  stats: RedactionStats;
};

export function redactTracePayload(input: unknown): RedactionResult {
  const stats: RedactionStats = { redactedFieldCount: 0, replacedWithReferenceCount: 0 };
  return { value: redactValue(input, [], stats), stats };
}

export function summarizeForTrace(input: unknown): JsonObject {
  const { value } = redactTracePayload(input);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return { value };
}

export function detectPromptInjection(value: unknown): string[] {
  const text = collectStrings(value).join("\n");
  return INSTRUCTION_INJECTION_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) =>
    pattern.source,
  );
}

export function stableTraceHash(value: unknown): string {
  const serialized = stableStringify(value);
  return createHash("sha256").update(serialized).digest("hex");
}

function redactValue(input: unknown, path: string[], stats: RedactionStats): JsonValue {
  if (input === null || ["string", "number", "boolean"].includes(typeof input)) {
    return redactPrimitive(input as string | number | boolean | null, path, stats);
  }

  if (input instanceof Date) {
    return input.toISOString();
  }

  if (Array.isArray(input)) {
    return input.slice(0, MAX_ARRAY_ITEMS).map((item, index) =>
      redactValue(item, [...path, String(index)], stats),
    );
  }

  if (typeof input === "object") {
    return redactObject(input as Record<string, unknown>, path, stats);
  }

  return null;
}

function redactObject(
  input: Record<string, unknown>,
  path: string[],
  stats: RedactionStats,
): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(input).slice(0, MAX_OBJECT_KEYS)) {
    const nextPath = [...path, key];
    if (isSensitiveField(key)) {
      result[key] = redactionMarker(value, nextPath);
      stats.redactedFieldCount += 1;
      continue;
    }

    result[key] = redactValue(value, nextPath, stats);
  }
  return result;
}

function redactPrimitive(
  input: string | number | boolean | null,
  path: string[],
  stats: RedactionStats,
): JsonValue {
  if (input === null || typeof input !== "string") {
    return input;
  }

  const clipped = input.length > MAX_STRING_LENGTH ? `${input.slice(0, MAX_STRING_LENGTH)}...` : input;
  const replaced = clipped.replace(LONG_DIGIT_PATTERN, (match) => {
    stats.redactedFieldCount += 1;
    return `[redacted:${hashShort(match)}]`;
  });

  if (isSensitiveField(path.at(-1) ?? "")) {
    stats.redactedFieldCount += 1;
    return redactionMarker(input, path);
  }

  return replaced;
}

function isSensitiveField(fieldName: string): boolean {
  return SENSITIVE_FIELD_PATTERNS.some((pattern) => pattern.test(fieldName));
}

function redactionMarker(value: unknown, path: string[]): JsonObject {
  return {
    redacted: true,
    path: path.join("."),
    hash: hashShort(JSON.stringify(value)),
  };
}

function hashShort(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
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

function stableStringify(value: unknown): string {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(null);
}
