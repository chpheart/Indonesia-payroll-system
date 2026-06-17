import { type ActorContext } from "@/domain/auth/permissions";
import {
  type AgentContextSource,
} from "@/domain/agent/context-builder";
import {
  type AgentNodeType,
  type JsonObject,
} from "@/domain/agent/agent-types";
import { type AgentTraceService } from "@/domain/agent/agent-trace-service";
import {
  runControlledAgentsSdkAgent,
  type ControlledAgentsSdkRunSummary,
} from "@/domain/agent/agent-sdk-adapter";
import {
  assertToolContractsPassLint,
  assertToolUsableForFormalRun,
} from "@/domain/agent/tool-contract-linter";
import {
  DEFAULT_TOOL_CONTRACTS,
  toolContractsForNode,
} from "@/domain/agent/tool-registry";
import {
  AGENT_WORKFLOW_ORDER,
  getAgentNodeDefinition,
  getAgentNodeRunner,
} from "@/domain/agent/nodes/node-registry";
import { type AgentNodeInput, type AgentNodeOutput } from "@/domain/agent/nodes/base-node";

export type AgentWorkflowRunInput = {
  actor: ActorContext;
  runId: string;
  clientId: string;
  payrollMonth: string;
  triggerSource: string;
  nodeTypes?: AgentNodeType[];
  contextSnapshotId: string;
  promptVersionId: string;
  modelVersionId: string;
  retrievalIndexVersionId?: string;
  toolSchemaVersionId?: string;
  toolSchemaVersionIds?: Record<string, string>;
  releaseEvalRunIds?: Record<string, string>;
  requiredEvalBindingRefs?: string[];
  memorySnapshotRef?: string;
  modelName: string;
  formalRun: boolean;
  contextSource: AgentContextSource;
  sourceObjectRefs?: string[];
  evidenceRefs?: string[];
  userPrompt?: string;
};

export type AgentWorkflowRunResult = {
  agentRunId: string;
  outputs: AgentNodeOutput[];
};

export class AgentOrchestrator {
  constructor(private readonly traceService: AgentTraceService) {}

  async runWorkflow(input: AgentWorkflowRunInput): Promise<AgentWorkflowRunResult> {
    assertToolContractsPassLint(DEFAULT_TOOL_CONTRACTS);
    if (input.formalRun) {
      assertReleaseEvalGatePresent(input);
    }
    const nodeTypes = input.nodeTypes ?? AGENT_WORKFLOW_ORDER;
    const run = await this.traceService.startRun({
      runId: input.runId,
      clientId: input.clientId,
      triggeredById: input.actor.id,
      triggerSource: input.triggerSource,
      nodeType: nodeTypes.length === 1 ? nodeTypes[0] : undefined,
      promptVersionId: input.promptVersionId,
      modelVersionId: input.modelVersionId,
      retrievalIndexVersionId: input.retrievalIndexVersionId,
      toolSchemaVersionId: input.toolSchemaVersionId,
      memorySnapshotRef: input.memorySnapshotRef,
      inputSummary: {
        nodeTypes,
        contextSnapshotId: input.contextSnapshotId,
        sourceObjectRefs: input.sourceObjectRefs ?? [],
      },
    });

    try {
      const outputs: AgentNodeOutput[] = [];
      const sdkSummaries: ControlledAgentsSdkRunSummary[] = [];
      for (const [index, nodeType] of nodeTypes.entries()) {
        const definition = getAgentNodeDefinition(nodeType);
        const contracts = toolContractsForNode(nodeType);
        if (input.formalRun) {
          contracts.forEach((contract) => assertToolUsableForFormalRun(contract, nodeType));
        }

        const sdkRunSummary = await runControlledAgentsSdkAgent({
          node: definition,
          toolContracts: contracts,
          modelName: input.modelName,
          agentRunId: run.id,
          actorId: input.actor.id,
          runId: input.runId,
          clientId: input.clientId,
          payrollMonth: input.payrollMonth,
          formalRun: input.formalRun,
          toolInput: sdkToolInput(input, nodeType),
        });
        sdkSummaries.push(sdkRunSummary);

        outputs.push(
          await getAgentNodeRunner(nodeType)(nodeInput(input), {
            agentRunId: run.id,
            sequence: index + 1,
            traceService: this.traceService,
            contextSource: input.contextSource,
            toolSchemaVersionIds: input.toolSchemaVersionIds,
            sdkRunSummary,
          }),
        );
      }

      await this.traceService.assertTraceCompleteForHumanReview(run.id);
      await this.traceService.completeRun({
        agentRunId: run.id,
        outputSummary: {
          outputs: outputs as unknown as JsonObject[],
          sdkRuns: sdkSummaries as unknown as JsonObject[],
        },
        tokenCount: sdkSummaries.reduce((total, summary) => total + summary.tokenCount, 0),
        costEstimateUsd: sdkSummaries.reduce(
          (total, summary) => total + summary.costEstimateUsd,
          0,
        ),
        durationMs: sdkSummaries.reduce((total, summary) => total + summary.durationMs, 0),
      });

      return { agentRunId: run.id, outputs };
    } catch (error) {
      await this.traceService.failRun({
        agentRunId: run.id,
        errorCode: error instanceof Error ? error.message : "AGENT_WORKFLOW_FAILED",
        errorMessage: error instanceof Error ? error.message : "Unknown agent workflow failure",
      });
      throw error;
    }
  }
}

function assertReleaseEvalGatePresent(input: AgentWorkflowRunInput): void {
  if (!input.requiredEvalBindingRefs || input.requiredEvalBindingRefs.length === 0) {
    throw new Error("AGENT_RELEASE_EVAL_GATE_REQUIRED");
  }
  const missing = input.requiredEvalBindingRefs.filter(
    (bindingRef) => !input.releaseEvalRunIds?.[bindingRef],
  );
  if (missing.length > 0) {
    throw new Error(`AGENT_RELEASE_EVAL_GATE_MISSING:${missing.join(",")}`);
  }
}

function nodeInput(input: AgentWorkflowRunInput): AgentNodeInput {
  return {
    runId: input.runId,
    clientId: input.clientId,
    payrollMonth: input.payrollMonth,
    contextSnapshotId: input.contextSnapshotId,
    sourceObjectRefs: input.sourceObjectRefs ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    redactedInputSummary: {},
    userPrompt: input.userPrompt,
  };
}

function sdkToolInput(input: AgentWorkflowRunInput, nodeType: AgentNodeType): JsonObject {
  return {
    runId: input.runId,
    clientId: input.clientId,
    payrollMonth: input.payrollMonth,
    contextSnapshotId: input.contextSnapshotId,
    sourceObjectRefs: input.sourceObjectRefs ?? [],
    evidenceRefs: input.evidenceRefs ?? [],
    redactedInputSummary: {},
    idempotencyKey: `${input.runId}:${input.contextSnapshotId}:${nodeType}`,
  };
}
