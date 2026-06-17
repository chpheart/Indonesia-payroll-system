import {
  type AgentContextDeclaration,
  type BuiltAgentContext,
  type JsonObject,
  type JsonValue,
} from "@/domain/agent/agent-types";
import { redactTracePayload } from "@/domain/agent/trace-redaction-policy";

export type AgentContextSource = {
  run?: Record<string, unknown>;
  rawInputs?: Record<string, unknown>[];
  workbookCells?: Record<string, unknown>[];
  evidenceRefs?: string[];
  ragChunks?: Record<string, unknown>[];
  customerMemory?: Record<string, unknown>;
  userPrompt?: string;
};

export class AgentContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentContextError";
  }
}

export function buildAgentContext(
  declaration: AgentContextDeclaration,
  source: AgentContextSource,
): BuiltAgentContext {
  const allowed = new Set(declaration.allowedFields);
  const selected: JsonObject = {};
  const fieldManifest: string[] = [];
  let redactedFieldCount = 0;
  let replacedWithReferenceCount = 0;

  for (const [field, value] of Object.entries(source)) {
    if (!allowed.has(field)) {
      continue;
    }

    const bounded = boundField(field, value, declaration);
    const redacted = redactTracePayload(bounded);
    selected[field] = redacted.value;
    fieldManifest.push(field);
    redactedFieldCount += redacted.stats.redactedFieldCount;
    replacedWithReferenceCount += redacted.stats.replacedWithReferenceCount;
  }

  if (fieldManifest.length === 0) {
    throw new AgentContextError("AGENT_CONTEXT_DECLARATION_MATCHED_NO_FIELDS");
  }

  if (declaration.runSnapshotId) {
    selected.runSnapshotId = declaration.runSnapshotId;
    fieldManifest.push("runSnapshotId");
  }

  selected.evidenceRefBoundary = declaration.evidenceRefBoundary;
  fieldManifest.push("evidenceRefBoundary");

  return {
    nodeType: declaration.nodeType,
    context: selected,
    fieldManifest,
    redactionSummary: { redactedFieldCount, replacedWithReferenceCount },
    limits: {
      maxRawInputs: declaration.maxRawInputs,
      maxWorkbookCells: declaration.maxWorkbookCells,
      ragTopK: declaration.ragTopK,
    },
  };
}

export function assertContextWithinDeclaration(
  declaration: AgentContextDeclaration,
  context: BuiltAgentContext,
): void {
  const allowed = new Set([
    ...declaration.allowedFields,
    "runSnapshotId",
    "evidenceRefBoundary",
  ]);
  const illegal = context.fieldManifest.filter((field) => !allowed.has(field));
  if (illegal.length > 0) {
    throw new AgentContextError(`AGENT_CONTEXT_FIELD_OUT_OF_BOUNDARY:${illegal.join(",")}`);
  }
}

function boundField(
  field: string,
  value: unknown,
  declaration: AgentContextDeclaration,
): JsonValue {
  if (field === "rawInputs" && Array.isArray(value)) {
    return value.slice(0, declaration.maxRawInputs).map(toJsonObject);
  }

  if (field === "workbookCells" && Array.isArray(value)) {
    return value.slice(0, declaration.maxWorkbookCells).map(toJsonObject);
  }

  if (field === "ragChunks" && Array.isArray(value)) {
    return value.slice(0, declaration.ragTopK).map(toJsonObject);
  }

  if (field === "evidenceRefs" && Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return toJsonObject(value as Record<string, unknown>);
  }

  return null;
}

function toJsonObject(value: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, toJsonValue(child)]),
  );
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return value as JsonValue;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(toJsonValue);
  }

  if (value && typeof value === "object") {
    return toJsonObject(value as Record<string, unknown>);
  }

  return null;
}
