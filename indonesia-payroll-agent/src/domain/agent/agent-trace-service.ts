import { randomUUID } from "node:crypto";
import {
  type AgentRunTraceInput,
  type AgentStepTraceInput,
  type GuardrailResultTraceInput,
  type JsonObject,
  type ToolInvocationTraceInput,
} from "@/domain/agent/agent-types";
import { summarizeForTrace } from "@/domain/agent/trace-redaction-policy";

export type AgentRunStatus =
  | "PENDING"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type AgentRunRecord = AgentRunTraceInput & {
  id: string;
  status: AgentRunStatus;
  outputSummary: JsonObject;
  humanReviewStatus: "NOT_REVIEWED" | "READY_FOR_REVIEW" | "BLOCKED_BY_TRACE";
  tokenCount: number;
  costEstimateUsd: number;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
};

export type AgentStepRecord = AgentStepTraceInput & {
  id: string;
  status: "SUCCEEDED" | "FAILED";
  createdAt: Date;
};

export type ToolInvocationRecord = ToolInvocationTraceInput & {
  id: string;
  createdAt: Date;
};

export type GuardrailResultRecord = GuardrailResultTraceInput & {
  id: string;
  createdAt: Date;
};

export type AgentTraceStore = {
  createRun(record: AgentRunRecord): Promise<AgentRunRecord>;
  updateRun(record: AgentRunRecord): Promise<AgentRunRecord>;
  createStep(record: AgentStepRecord): Promise<AgentStepRecord>;
  createToolInvocation(record: ToolInvocationRecord): Promise<ToolInvocationRecord>;
  createGuardrailResult(record: GuardrailResultRecord): Promise<GuardrailResultRecord>;
  findRun(id: string): Promise<AgentRunRecord | null>;
  listSteps(agentRunId: string): Promise<AgentStepRecord[]>;
  listToolInvocations(agentRunId: string): Promise<ToolInvocationRecord[]>;
  listGuardrailResults(agentRunId: string): Promise<GuardrailResultRecord[]>;
};

export class AgentTraceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTraceError";
  }
}

export class AgentTraceService {
  constructor(private readonly store: AgentTraceStore) {}

  async startRun(input: AgentRunTraceInput): Promise<AgentRunRecord> {
    return this.store.createRun({
      ...input,
      id: randomUUID(),
      status: "RUNNING",
      inputSummary: summarizeForTrace(input.inputSummary),
      outputSummary: {},
      humanReviewStatus: "NOT_REVIEWED",
      tokenCount: 0,
      costEstimateUsd: 0,
      durationMs: undefined,
      startedAt: new Date(),
      createdAt: new Date(),
    });
  }

  async recordStep(input: AgentStepTraceInput): Promise<AgentStepRecord> {
    return this.store.createStep({
      ...input,
      id: randomUUID(),
      status: input.errorCode ? "FAILED" : "SUCCEEDED",
      inputSummary: summarizeForTrace(input.inputSummary),
      outputSummary: summarizeForTrace(input.outputSummary),
      guardrailSummary: summarizeForTrace(input.guardrailSummary),
      createdAt: new Date(),
    });
  }

  async recordToolInvocation(input: ToolInvocationTraceInput): Promise<ToolInvocationRecord> {
    if (input.requiresApproval && input.status === "SUCCEEDED") {
      throw new AgentTraceError("APPROVAL_REQUIRED_TOOL_CANNOT_RECORD_SUCCEEDED_DIRECTLY");
    }

    return this.store.createToolInvocation({
      ...input,
      id: randomUUID(),
      parameterSummary: summarizeForTrace(input.parameterSummary),
      outputSummary: summarizeForTrace(input.outputSummary),
      retryCount: input.retryCount ?? 0,
      createdAt: new Date(),
    });
  }

  async recordGuardrailResult(input: GuardrailResultTraceInput): Promise<GuardrailResultRecord> {
    return this.store.createGuardrailResult({
      ...input,
      id: randomUUID(),
      resultSummary: summarizeForTrace(input.resultSummary),
      createdAt: new Date(),
    });
  }

  async completeRun(input: {
    agentRunId: string;
    outputSummary: JsonObject;
    tokenCount?: number;
    costEstimateUsd?: number;
    durationMs?: number;
  }): Promise<AgentRunRecord> {
    const run = await this.requireRun(input.agentRunId);
    return this.store.updateRun({
      ...run,
      status: "SUCCEEDED",
      outputSummary: summarizeForTrace(input.outputSummary),
      tokenCount: input.tokenCount ?? run.tokenCount,
      costEstimateUsd: input.costEstimateUsd ?? run.costEstimateUsd,
      durationMs: input.durationMs ?? run.durationMs,
      completedAt: new Date(),
    });
  }

  async failRun(input: {
    agentRunId: string;
    errorCode: string;
    errorMessage: string;
  }): Promise<AgentRunRecord> {
    const run = await this.requireRun(input.agentRunId);
    return this.store.updateRun({
      ...run,
      status: "FAILED",
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      humanReviewStatus: "BLOCKED_BY_TRACE",
      completedAt: new Date(),
    });
  }

  async assertTraceCompleteForHumanReview(agentRunId: string): Promise<void> {
    const steps = await this.store.listSteps(agentRunId);
    const tools = await this.store.listToolInvocations(agentRunId);
    const guardrails = await this.store.listGuardrailResults(agentRunId);

    if (steps.length === 0) {
      throw new AgentTraceError("AGENT_STEP_TRACE_REQUIRED");
    }
    if (tools.length === 0) {
      throw new AgentTraceError("TOOL_INVOCATION_TRACE_REQUIRED");
    }
    if (guardrails.length === 0) {
      throw new AgentTraceError("GUARDRAIL_RESULT_TRACE_REQUIRED");
    }

    const stepsWithoutGuardrail = steps.filter(
      (step) => !guardrails.some((guardrail) => guardrail.agentStepId === step.id),
    );
    if (stepsWithoutGuardrail.length > 0) {
      throw new AgentTraceError("EACH_AGENT_STEP_REQUIRES_GUARDRAIL_RESULT");
    }
  }

  private async requireRun(agentRunId: string): Promise<AgentRunRecord> {
    const run = await this.store.findRun(agentRunId);
    if (!run) {
      throw new AgentTraceError("AGENT_RUN_NOT_FOUND");
    }
    return run;
  }
}

export class InMemoryAgentTraceStore implements AgentTraceStore {
  private readonly runs = new Map<string, AgentRunRecord>();
  private readonly steps = new Map<string, AgentStepRecord>();
  private readonly tools = new Map<string, ToolInvocationRecord>();
  private readonly guardrails = new Map<string, GuardrailResultRecord>();

  async createRun(record: AgentRunRecord): Promise<AgentRunRecord> {
    this.runs.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async updateRun(record: AgentRunRecord): Promise<AgentRunRecord> {
    this.runs.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async createStep(record: AgentStepRecord): Promise<AgentStepRecord> {
    this.steps.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async createToolInvocation(record: ToolInvocationRecord): Promise<ToolInvocationRecord> {
    this.tools.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async createGuardrailResult(record: GuardrailResultRecord): Promise<GuardrailResultRecord> {
    this.guardrails.set(record.id, structuredClone(record));
    return structuredClone(record);
  }

  async findRun(id: string): Promise<AgentRunRecord | null> {
    const run = this.runs.get(id);
    return run ? structuredClone(run) : null;
  }

  async listSteps(agentRunId: string): Promise<AgentStepRecord[]> {
    return this.listByRun(this.steps, agentRunId);
  }

  async listToolInvocations(agentRunId: string): Promise<ToolInvocationRecord[]> {
    return this.listByRun(this.tools, agentRunId);
  }

  async listGuardrailResults(agentRunId: string): Promise<GuardrailResultRecord[]> {
    return this.listByRun(this.guardrails, agentRunId);
  }

  private listByRun<T extends { agentRunId: string; createdAt: Date }>(
    source: Map<string, T>,
    agentRunId: string,
  ): T[] {
    return Array.from(source.values())
      .filter((record) => record.agentRunId === agentRunId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map((record) => structuredClone(record));
  }
}
