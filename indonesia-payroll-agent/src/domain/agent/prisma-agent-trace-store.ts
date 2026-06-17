import {
  type AgentRun,
  type AgentStep,
  type GuardrailResult,
  type PrismaClient,
  type ToolInvocation,
} from "@/generated/prisma/client";
import {
  type AgentRunRecord,
  type AgentStepRecord,
  type AgentTraceStore,
  type GuardrailResultRecord,
  type ToolInvocationRecord,
} from "@/domain/agent/agent-trace-service";
import { type JsonObject } from "@/domain/agent/agent-types";
import { toInputJsonObject } from "@/lib/json/input-json";

export class PrismaAgentTraceStore implements AgentTraceStore {
  constructor(private readonly db: PrismaClient) {}

  async createRun(record: AgentRunRecord): Promise<AgentRunRecord> {
    return mapAgentRun(
      await this.db.agentRun.create({
        data: agentRunData(record),
      }),
    );
  }

  async updateRun(record: AgentRunRecord): Promise<AgentRunRecord> {
    return mapAgentRun(
      await this.db.agentRun.update({
        where: { id: record.id },
        data: agentRunData(record),
      }),
    );
  }

  async createStep(record: AgentStepRecord): Promise<AgentStepRecord> {
    return mapAgentStep(
      await this.db.agentStep.create({
        data: {
          id: record.id,
          agentRunId: record.agentRunId,
          nodeType: record.nodeType,
          sequence: record.sequence,
          status: record.status,
          inputSummary: toInputJsonObject(record.inputSummary),
          outputSummary: toInputJsonObject(record.outputSummary),
          citedSourceRefs: record.citedSourceRefs,
          confidence: record.confidence,
          riskLevel: record.riskLevel,
          guardrailSummary: toInputJsonObject(record.guardrailSummary),
          tokenCount: record.tokenCount ?? 0,
          costEstimateUsd: record.costEstimateUsd ?? 0,
          durationMs: record.durationMs,
          errorCode: record.errorCode,
          errorMessage: record.errorMessage,
          startedAt: record.createdAt,
          completedAt: record.createdAt,
          createdAt: record.createdAt,
        },
      }),
    );
  }

  async createToolInvocation(record: ToolInvocationRecord): Promise<ToolInvocationRecord> {
    return mapToolInvocation(
      await this.db.toolInvocation.create({
        data: {
          id: record.id,
          agentRunId: record.agentRunId,
          agentStepId: record.agentStepId,
          schemaVersionId: record.schemaVersionId,
          toolName: record.toolName,
          toolVersion: record.toolVersion,
          status: record.status,
          permissionLevel: record.permissionLevel,
          riskLevel: record.riskLevel,
          requiresApproval: record.requiresApproval,
          approvalStatus: record.approvalStatus,
          idempotencyKey: record.idempotencyKey,
          parameterSummary: toInputJsonObject(record.parameterSummary),
          outputSummary: toInputJsonObject(record.outputSummary),
          errorCode: record.errorCode,
          errorMessage: record.errorMessage,
          timeoutMs: record.timeoutMs,
          retryCount: record.retryCount ?? 0,
          formalRunAllowed: record.formalRunAllowed,
          startedAt: record.createdAt,
          completedAt: record.createdAt,
          createdAt: record.createdAt,
        },
      }),
    );
  }

  async createGuardrailResult(record: GuardrailResultRecord): Promise<GuardrailResultRecord> {
    return mapGuardrailResult(
      await this.db.guardrailResult.create({
        data: {
          id: record.id,
          agentRunId: record.agentRunId,
          agentStepId: record.agentStepId,
          toolInvocationId: record.toolInvocationId,
          guardrailName: record.guardrailName,
          guardrailType: record.guardrailType,
          severity: record.severity,
          action: record.action,
          triggered: record.triggered,
          resultSummary: toInputJsonObject(record.resultSummary),
          redactionApplied: record.redactionApplied,
          createdAt: record.createdAt,
        },
      }),
    );
  }

  async findRun(id: string): Promise<AgentRunRecord | null> {
    const run = await this.db.agentRun.findUnique({ where: { id } });
    return run ? mapAgentRun(run) : null;
  }

  async listSteps(agentRunId: string): Promise<AgentStepRecord[]> {
    const rows = await this.db.agentStep.findMany({
      where: { agentRunId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapAgentStep);
  }

  async listToolInvocations(agentRunId: string): Promise<ToolInvocationRecord[]> {
    const rows = await this.db.toolInvocation.findMany({
      where: { agentRunId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapToolInvocation);
  }

  async listGuardrailResults(agentRunId: string): Promise<GuardrailResultRecord[]> {
    const rows = await this.db.guardrailResult.findMany({
      where: { agentRunId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(mapGuardrailResult);
  }
}

function agentRunData(record: AgentRunRecord) {
  return {
    id: record.id,
    runId: record.runId,
    clientId: record.clientId,
    triggeredById: record.triggeredById,
    triggerSource: record.triggerSource,
    nodeType: record.nodeType,
    status: record.status,
    promptVersionId: record.promptVersionId,
    modelVersionId: record.modelVersionId,
    retrievalIndexVersionId: record.retrievalIndexVersionId,
    toolSchemaVersionId: record.toolSchemaVersionId,
    memorySnapshotRef: record.memorySnapshotRef,
    inputSummary: toInputJsonObject(record.inputSummary),
    outputSummary: toInputJsonObject(record.outputSummary),
    humanReviewStatus: record.humanReviewStatus,
    tokenCount: record.tokenCount,
    costEstimateUsd: record.costEstimateUsd,
    durationMs: record.durationMs,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
  };
}

function mapAgentRun(row: AgentRun): AgentRunRecord {
  return {
    id: row.id,
    runId: row.runId,
    clientId: row.clientId,
    triggeredById: row.triggeredById ?? undefined,
    triggerSource: row.triggerSource,
    nodeType: row.nodeType ?? undefined,
    status: row.status,
    promptVersionId: row.promptVersionId,
    modelVersionId: row.modelVersionId,
    retrievalIndexVersionId: row.retrievalIndexVersionId ?? undefined,
    toolSchemaVersionId: row.toolSchemaVersionId ?? undefined,
    memorySnapshotRef: row.memorySnapshotRef ?? undefined,
    inputSummary: jsonObject(row.inputSummary),
    outputSummary: jsonObject(row.outputSummary),
    humanReviewStatus: row.humanReviewStatus as AgentRunRecord["humanReviewStatus"],
    tokenCount: row.tokenCount,
    costEstimateUsd: Number(row.costEstimateUsd),
    durationMs: row.durationMs ?? undefined,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    startedAt: row.startedAt ?? row.createdAt,
    completedAt: row.completedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

function mapAgentStep(row: AgentStep): AgentStepRecord {
  return {
    id: row.id,
    agentRunId: row.agentRunId,
    nodeType: row.nodeType,
    sequence: row.sequence,
    status: row.errorCode ? "FAILED" : "SUCCEEDED",
    inputSummary: jsonObject(row.inputSummary),
    outputSummary: jsonObject(row.outputSummary),
    citedSourceRefs: row.citedSourceRefs,
    confidence: row.confidence ?? undefined,
    riskLevel: row.riskLevel,
    guardrailSummary: jsonObject(row.guardrailSummary),
    tokenCount: row.tokenCount,
    costEstimateUsd: Number(row.costEstimateUsd),
    durationMs: row.durationMs ?? undefined,
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt,
  };
}

function mapToolInvocation(row: ToolInvocation): ToolInvocationRecord {
  return {
    id: row.id,
    agentRunId: row.agentRunId,
    agentStepId: row.agentStepId ?? undefined,
    schemaVersionId: row.schemaVersionId ?? undefined,
    toolName: row.toolName,
    toolVersion: row.toolVersion,
    status: row.status,
    permissionLevel: row.permissionLevel as ToolInvocationRecord["permissionLevel"],
    riskLevel: row.riskLevel,
    requiresApproval: row.requiresApproval,
    approvalStatus: row.approvalStatus as ToolInvocationRecord["approvalStatus"],
    idempotencyKey: row.idempotencyKey ?? undefined,
    parameterSummary: jsonObject(row.parameterSummary),
    outputSummary: jsonObject(row.outputSummary),
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    timeoutMs: row.timeoutMs,
    retryCount: row.retryCount,
    formalRunAllowed: row.formalRunAllowed,
    createdAt: row.createdAt,
  };
}

function mapGuardrailResult(row: GuardrailResult): GuardrailResultRecord {
  return {
    id: row.id,
    agentRunId: row.agentRunId,
    agentStepId: row.agentStepId ?? undefined,
    toolInvocationId: row.toolInvocationId ?? undefined,
    guardrailName: row.guardrailName,
    guardrailType: row.guardrailType as GuardrailResultRecord["guardrailType"],
    severity: row.severity,
    action: row.action,
    triggered: row.triggered,
    resultSummary: jsonObject(row.resultSummary),
    redactionApplied: row.redactionApplied,
    createdAt: row.createdAt,
  };
}

function jsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}
