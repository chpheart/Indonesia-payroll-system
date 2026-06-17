import { type z } from "zod";
import { type AuditRiskLevel } from "@/domain/audit/audit-service";
import { type RoleCode } from "@/domain/auth/permissions";

export const AGENT_NODE_TYPES = [
  "INTAKE_CLASSIFICATION",
  "EXCEL_STRUCTURE",
  "CHANGE_EXTRACTION",
  "FIELD_MAPPING",
  "EMPLOYEE_MATCHING",
  "QUESTION_GENERATION",
  "EVIDENCE_LINKING",
  "PRECHECK_ADVICE",
  "CUSTOMER_CONFIRMATION_PACK",
  "RECONCILIATION_EXPLANATION",
  "CONFIRMATION_SUMMARY",
] as const;

export type AgentNodeType = (typeof AGENT_NODE_TYPES)[number];

export const AGENT_VERSION_STATUSES = [
  "DRAFT",
  "INTERNAL_TEST",
  "RELEASED",
  "DEPRECATED",
  "REVOKED",
] as const;

export type AgentVersionStatus = (typeof AGENT_VERSION_STATUSES)[number];
export type CriticalEvalStatus = "PASS" | "FAIL" | "MISSING";
export type ToolPermissionLevel = "READ" | "WRITE_PROPOSAL" | "WRITE_DRAFT" | "CONTROLLED_WRITE";
export type ApprovalMode = "NOT_REQUIRED" | "PREVIEW_ONLY" | "MANUAL_REQUIRED";
export type GuardrailAction = "PASS" | "FLAG" | "BLOCK" | "REDACT" | "NEEDS_REVIEW";
export type GuardrailSeverity = "INFO" | "WARNING" | "CRITICAL";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export type ApprovalPolicy = {
  mode: ApprovalMode;
  requiredForFormalRun: boolean;
  approverRoles: RoleCode[];
  previewBeforeApproval: boolean;
};

export type RetryPolicy = {
  maxRetries: number;
  retryableErrorCodes: string[];
};

export type TraceFieldPolicy = {
  persist: string[];
  redact: string[];
  hashOnly: string[];
  evidenceRefsOnly: boolean;
};

export type ToolContract<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  name: string;
  version: string;
  description: string;
  releaseStatus: AgentVersionStatus;
  criticalEvalStatus: CriticalEvalStatus;
  inputSchema: TInput;
  outputSchema: TOutput;
  errorCodes: string[];
  permissionLevel: ToolPermissionLevel;
  riskLevel: AuditRiskLevel;
  actionScope: string[];
  allowedNodeTypes: AgentNodeType[];
  requiresApproval: boolean;
  approvalPolicy: ApprovalPolicy;
  idempotencyRequired: boolean;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  formalRunAllowed: boolean;
  evalBindingRef: string;
  guardrailBindingRef: string;
  traceFieldPolicy: TraceFieldPolicy;
};

export type AgentContextDeclaration = {
  nodeType: AgentNodeType;
  allowedFields: string[];
  maxRawInputs: number;
  maxWorkbookCells: number;
  ragTopK: number;
  redactionStrategy: "STRICT" | "REFERENCE_ONLY";
  runSnapshotId?: string;
  evidenceRefBoundary: string[];
};

export type BuiltAgentContext = {
  nodeType: AgentNodeType;
  context: JsonObject;
  fieldManifest: string[];
  redactionSummary: {
    redactedFieldCount: number;
    replacedWithReferenceCount: number;
  };
  limits: {
    maxRawInputs: number;
    maxWorkbookCells: number;
    ragTopK: number;
  };
};

export type AgentNodeDefinition<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
  TOutput extends z.ZodTypeAny = z.ZodTypeAny,
> = {
  nodeType: AgentNodeType;
  label: string;
  description: string;
  inputSchema: TInput;
  outputSchema: TOutput;
  allowedToolNames: string[];
  contextDeclaration: AgentContextDeclaration;
  riskLevel: AuditRiskLevel;
  evalBindingRef: string;
  guardrailBindingRef: string;
  humanGate: ApprovalPolicy;
  failureBehavior: "FAIL_CLOSED" | "ALLOW_MANUAL_FALLBACK";
};

export type AgentRunTraceInput = {
  runId: string;
  clientId: string;
  triggeredById?: string;
  triggerSource: string;
  nodeType?: AgentNodeType;
  promptVersionId: string;
  modelVersionId: string;
  retrievalIndexVersionId?: string;
  toolSchemaVersionId?: string;
  memorySnapshotRef?: string;
  inputSummary: JsonObject;
};

export type AgentStepTraceInput = {
  agentRunId: string;
  nodeType: AgentNodeType;
  sequence: number;
  inputSummary: JsonObject;
  outputSummary: JsonObject;
  citedSourceRefs: string[];
  confidence?: string;
  riskLevel: AuditRiskLevel;
  guardrailSummary: JsonObject;
  tokenCount?: number;
  costEstimateUsd?: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
};

export type ToolInvocationTraceInput = {
  agentRunId: string;
  agentStepId?: string;
  schemaVersionId?: string;
  toolName: string;
  toolVersion: string;
  status: "PENDING" | "PREVIEW" | "WAITING_FOR_APPROVAL" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "SKIPPED";
  permissionLevel: ToolPermissionLevel;
  riskLevel: AuditRiskLevel;
  requiresApproval: boolean;
  approvalStatus: ApprovalMode;
  idempotencyKey?: string;
  parameterSummary: JsonObject;
  outputSummary: JsonObject;
  errorCode?: string;
  errorMessage?: string;
  timeoutMs: number;
  retryCount?: number;
  formalRunAllowed: boolean;
  durationMs?: number;
};

export type GuardrailResultTraceInput = {
  agentRunId: string;
  agentStepId?: string;
  toolInvocationId?: string;
  guardrailName: string;
  guardrailType: "INPUT" | "OUTPUT" | "TOOL_INPUT" | "TOOL_OUTPUT" | "TRACE_REDACTION";
  severity: GuardrailSeverity;
  action: GuardrailAction;
  triggered: boolean;
  resultSummary: JsonObject;
  redactionApplied: boolean;
};
