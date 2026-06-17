import { z } from "zod";
import {
  buildAgentContext,
  type AgentContextSource,
} from "@/domain/agent/context-builder";
import { type ControlledAgentsSdkRunSummary } from "@/domain/agent/agent-sdk-adapter";
import {
  type AgentNodeDefinition,
  type AgentNodeType,
  type ApprovalPolicy,
  type JsonObject,
} from "@/domain/agent/agent-types";
import { type AgentTraceService } from "@/domain/agent/agent-trace-service";
import { detectPromptInjection } from "@/domain/agent/trace-redaction-policy";
import { findToolContract } from "@/domain/agent/tool-registry";

export const agentNodeInputSchema = z.object({
  runId: z.string().min(1),
  clientId: z.string().min(1),
  payrollMonth: z.string().min(7).max(7),
  contextSnapshotId: z.string().min(1),
  sourceObjectRefs: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  redactedInputSummary: z.record(z.string(), z.unknown()).default({}),
  userPrompt: z.string().optional(),
});

export const agentNodeOutputSchema = z.object({
  status: z.enum(["CANDIDATE", "NEEDS_REVIEW", "BLOCKED"]),
  nodeType: z.string(),
  summary: z.string(),
  riskLevel: z.enum(["R0", "R1", "R2", "R3", "R4"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  citations: z.array(z.string()).default([]),
  humanGate: z.object({
    required: z.boolean(),
    reason: z.string(),
    approvalMode: z.enum(["NOT_REQUIRED", "PREVIEW_ONLY", "MANUAL_REQUIRED"]),
  }),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type AgentNodeInput = z.output<typeof agentNodeInputSchema>;
export type AgentNodeOutput = z.output<typeof agentNodeOutputSchema>;

export type AgentNodeRuntime = {
  agentRunId: string;
  sequence: number;
  traceService: AgentTraceService;
  contextSource: AgentContextSource;
  toolSchemaVersionIds?: Record<string, string>;
  sdkRunSummary?: ControlledAgentsSdkRunSummary;
};

type DefinitionInput = {
  nodeType: AgentNodeType;
  label: string;
  description: string;
  allowedToolNames: string[];
  allowedFields: string[];
  riskLevel: AgentNodeDefinition["riskLevel"];
  humanGate: ApprovalPolicy;
  failureBehavior?: AgentNodeDefinition["failureBehavior"];
};

export function defineSuggestionNode(input: DefinitionInput): AgentNodeDefinition {
  return {
    nodeType: input.nodeType,
    label: input.label,
    description: input.description,
    inputSchema: agentNodeInputSchema,
    outputSchema: agentNodeOutputSchema,
    allowedToolNames: input.allowedToolNames,
    contextDeclaration: {
      nodeType: input.nodeType,
      allowedFields: input.allowedFields,
      maxRawInputs: 5,
      maxWorkbookCells: 50,
      ragTopK: 5,
      redactionStrategy: "STRICT",
      evidenceRefBoundary: [],
    },
    riskLevel: input.riskLevel,
    evalBindingRef: `critical:${input.nodeType}:v1`,
    guardrailBindingRef: `guardrail:${input.nodeType}:v1`,
    humanGate: input.humanGate,
    failureBehavior: input.failureBehavior ?? "ALLOW_MANUAL_FALLBACK",
  };
}

export async function runSuggestionNode(
  definition: AgentNodeDefinition,
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  const parsedInput = definition.inputSchema.parse(input) as AgentNodeInput;
  const context = buildAgentContext(
    {
      ...definition.contextDeclaration,
      runSnapshotId: parsedInput.contextSnapshotId,
      evidenceRefBoundary: parsedInput.evidenceRefs,
    },
    { ...runtime.contextSource, userPrompt: parsedInput.userPrompt },
  );
  const injectionHits = detectPromptInjection(context.context);
  const contract = requirePrimaryTool(definition);
  const ragCitationMissing = isRagCitationMissing(definition, context.context);
  const guardrailTriggered = injectionHits.length > 0 || ragCitationMissing;
  const status = guardrailTriggered ? "NEEDS_REVIEW" : "CANDIDATE";
  const summary = ragCitationMissing
    ? "不确定/需人工确认：当前核查解释缺少可引用来源。"
    : `${definition.label}已生成受控建议，等待人工确认或下游确定性规则复核。`;
  const output: AgentNodeOutput = {
    status,
    nodeType: definition.nodeType,
    summary,
    riskLevel: definition.riskLevel,
    confidence: guardrailTriggered ? "LOW" : "MEDIUM",
    citations: parsedInput.evidenceRefs,
    humanGate: {
      required: definition.humanGate.requiredForFormalRun,
      reason: guardrailTriggered
        ? ragCitationMissing
          ? "RAG/核查解释缺少引用来源，必须人工确认"
          : "外部输入命中安全核查，必须人工处理"
        : "Agent 输出仅为候选，不自动生效",
      approvalMode: definition.humanGate.mode,
    },
    payload: {
      contextFields: context.fieldManifest,
      redactionSummary: context.redactionSummary,
      guardrailBindingRef: definition.guardrailBindingRef,
      evalBindingRef: definition.evalBindingRef,
      suggestedObjectRefs: parsedInput.sourceObjectRefs,
      promptInjectionPatterns: injectionHits,
      ragCitationMissing,
      sdkRunSummary: runtime.sdkRunSummary
        ? {
            sdkExecuted: runtime.sdkRunSummary.sdkExecuted,
            modelName: runtime.sdkRunSummary.modelName,
            modelMode: runtime.sdkRunSummary.modelMode,
            tracingDisabled: runtime.sdkRunSummary.tracingDisabled,
            traceIncludeSensitiveData: runtime.sdkRunSummary.traceIncludeSensitiveData,
            tokenCount: runtime.sdkRunSummary.tokenCount,
            rawResponseCount: runtime.sdkRunSummary.rawResponseCount,
            interruptionCount: runtime.sdkRunSummary.interruptionCount,
          }
        : null,
    },
  };

  const step = await runtime.traceService.recordStep({
    agentRunId: runtime.agentRunId,
    nodeType: definition.nodeType,
    sequence: runtime.sequence,
    inputSummary: context.context,
    outputSummary: output as unknown as JsonObject,
    citedSourceRefs: output.citations,
    confidence: output.confidence,
    riskLevel: definition.riskLevel,
    guardrailSummary: { triggered: guardrailTriggered, patterns: injectionHits, ragCitationMissing },
    tokenCount: runtime.sdkRunSummary?.tokenCount,
    costEstimateUsd: runtime.sdkRunSummary?.costEstimateUsd,
    durationMs: runtime.sdkRunSummary?.durationMs,
  });

  const toolInvocation = await runtime.traceService.recordToolInvocation({
    agentRunId: runtime.agentRunId,
    agentStepId: step.id,
    schemaVersionId: runtime.toolSchemaVersionIds?.[contract.name],
    toolName: contract.name,
    toolVersion: contract.version,
    status: contract.requiresApproval ? "PREVIEW" : "SUCCEEDED",
    permissionLevel: contract.permissionLevel,
    riskLevel: contract.riskLevel,
    requiresApproval: contract.requiresApproval,
    approvalStatus: contract.approvalPolicy.mode,
    idempotencyKey: `${runtime.agentRunId}:${definition.nodeType}:${runtime.sequence}`,
    parameterSummary: context.context,
    outputSummary: output as unknown as JsonObject,
    timeoutMs: contract.timeoutMs,
    formalRunAllowed: contract.formalRunAllowed,
    durationMs: runtime.sdkRunSummary?.durationMs,
  });

  await runtime.traceService.recordGuardrailResult({
    agentRunId: runtime.agentRunId,
    agentStepId: step.id,
    toolInvocationId: toolInvocation.id,
    guardrailName: definition.guardrailBindingRef,
    guardrailType: "INPUT",
    severity: guardrailTriggered ? "CRITICAL" : "INFO",
    action: guardrailTriggered ? "NEEDS_REVIEW" : "PASS",
    triggered: guardrailTriggered,
    resultSummary: { promptInjectionPatterns: injectionHits, ragCitationMissing },
    redactionApplied: context.redactionSummary.redactedFieldCount > 0,
  });

  return definition.outputSchema.parse(output) as AgentNodeOutput;
}

function isRagCitationMissing(definition: AgentNodeDefinition, context: { [key: string]: unknown }) {
  if (definition.nodeType !== "RECONCILIATION_EXPLANATION") {
    return false;
  }
  return !Array.isArray(context.ragChunks) || context.ragChunks.length === 0;
}

function requirePrimaryTool(definition: AgentNodeDefinition) {
  const contract = findToolContract(definition.allowedToolNames[0] ?? "");
  if (!contract) {
    throw new Error("AGENT_NODE_TOOL_CONTRACT_NOT_FOUND");
  }
  return contract;
}
