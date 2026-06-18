import { type AgentNodeType } from "@/domain/agent/agent-types";
import {
  ensureReleaseEvalGate,
  modelVersionEvalTarget,
  promptVersionEvalTarget,
  retrievalIndexEvalTarget,
  toolSchemaEvalTarget,
  workflowNodeEvalTarget,
} from "@/domain/agent/eval-gate";
import { getAgentNodeDefinition } from "@/domain/agent/nodes/node-registry";
import { toolContractsForNode } from "@/domain/agent/tool-registry";
import { contractJsonSchema } from "@/domain/agent/tool-contract-linter";
import { assertAgentVersionReusable } from "@/domain/agent/version-release-policy";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonArray, toInputJsonObject } from "@/lib/json/input-json";

export async function ensureAgentVersions(nodeTypes: AgentNodeType[], modelName: string) {
  const prompt = await findOrCreatePromptVersion(nodeTypes);
  const model = await findOrCreateModelVersion(modelName);
  const retrieval = await findOrCreateRetrievalIndexVersion();
  const nodeDefinitions = nodeTypes.map(getAgentNodeDefinition);
  const contracts = nodeTypes.flatMap(toolContractsForNode);
  const toolSchemaVersions = await Promise.all(contracts.map(findOrCreateToolSchemaVersion));
  const toolSchemaVersionIds = Object.fromEntries(
    toolSchemaVersions.map((version) => [version.toolName, version.id]),
  );
  const promptGate = await ensureReleaseEvalGate(
    prisma,
    promptVersionEvalTarget({
      id: prompt.id,
      evalBindingRef: prompt.evalBindingRef ?? "critical:controlled_payroll_agent:v1",
      nodeTypes,
      content: prompt.content,
    }),
  );
  const modelGate = await ensureReleaseEvalGate(
    prisma,
    modelVersionEvalTarget({
      id: model.id,
      evalBindingRef: model.evalBindingRef ?? "critical:model:controlled-preview:v1",
      modelName: model.modelName,
      settings: model.settings,
    }),
  );
  const retrievalGate = await ensureReleaseEvalGate(
    prisma,
    retrievalIndexEvalTarget({
      id: retrieval.id,
      evalBindingRef: retrieval.evalBindingRef ?? "critical:rag:payroll-policy:v1",
      sourceRefs: retrieval.sourceRefs,
      topKDefault: retrieval.topKDefault,
      redactionPolicy: retrieval.redactionPolicy,
    }),
  );
  const toolGates = await Promise.all(
    contracts.map((contract, index) =>
      ensureReleaseEvalGate(
        prisma,
        toolSchemaEvalTarget({ id: toolSchemaVersions[index].id, contract }),
      ),
    ),
  );
  const nodeGates = await Promise.all(
    nodeDefinitions.map((definition) =>
      ensureReleaseEvalGate(prisma, workflowNodeEvalTarget(definition)),
    ),
  );
  await Promise.all([
    releasePromptVersion(prompt.id),
    releaseModelVersion(model.id),
    releaseRetrievalIndexVersion(retrieval.id),
    ...toolSchemaVersions.map((version) => releaseToolSchemaVersion(version.id)),
  ]);
  const releaseEvalRunIds = Object.fromEntries(
    [promptGate, modelGate, retrievalGate, ...toolGates, ...nodeGates].map((gate) => [
      gate.evalBindingRef,
      gate.evalRunId,
    ]),
  );

  return {
    promptVersionId: prompt.id,
    modelVersionId: model.id,
    retrievalIndexVersionId: retrieval.id,
    primaryToolSchemaVersionId: toolSchemaVersions[0]?.id,
    toolSchemaVersionIds,
    releaseEvalRunIds,
    requiredEvalBindingRefs: Object.keys(releaseEvalRunIds),
    memorySnapshotRef: `run-memory:${nodeTypes.join("+")}:v1`,
  };
}

async function findOrCreatePromptVersion(nodeTypes: AgentNodeType[]) {
  const existing = await prisma.promptVersion.findFirst({
    where: { promptKey: "controlled_payroll_agent", versionNumber: 1 },
  });
  if (existing) {
    assertAgentVersionReusable(existing.status, `PromptVersion:${existing.promptKey}:v${existing.versionNumber}`);
    return existing;
  }
  return prisma.promptVersion.create({
    data: {
      promptKey: "controlled_payroll_agent",
      versionNumber: 1,
      status: "INTERNAL_TEST",
      content: toInputJsonObject({ nodeTypes, policy: "candidate_only" }),
      evalBindingRef: "critical:controlled_payroll_agent:v1",
      guardrailBindingRef: "guardrail:controlled_payroll_agent:v1",
      changeSummary: "Phase 6 controlled agent workflow baseline",
    },
  });
}

async function findOrCreateModelVersion(modelName: string) {
  const existing = await prisma.modelVersion.findFirst({
    where: { modelKey: "openai_agents_default", versionNumber: 1 },
  });
  if (existing) {
    assertAgentVersionReusable(existing.status, `ModelVersion:${existing.modelKey}:v${existing.versionNumber}`);
    return existing;
  }
  return prisma.modelVersion.create({
    data: {
      modelKey: "openai_agents_default",
      versionNumber: 1,
      provider: "openai",
      modelName,
      status: "INTERNAL_TEST",
      settings: toInputJsonObject({ traceIncludeSensitiveData: false }),
      evalBindingRef: "critical:model:controlled-preview:v1",
      changeSummary: "Phase 6 model version anchor for controlled preview workflow",
    },
  });
}

async function findOrCreateRetrievalIndexVersion() {
  const existing = await prisma.retrievalIndexVersion.findFirst({
    where: { indexKey: "payroll_policy_references", versionNumber: 1 },
  });
  if (existing) {
    assertAgentVersionReusable(
      existing.status,
      `RetrievalIndexVersion:${existing.indexKey}:v${existing.versionNumber}`,
    );
    return existing;
  }
  return prisma.retrievalIndexVersion.create({
    data: {
      indexKey: "payroll_policy_references",
      versionNumber: 1,
      status: "INTERNAL_TEST",
      sourceRefs: ["Product-Spec.md", "DEV-PLAN.md"],
      topKDefault: 5,
      redactionPolicy: toInputJsonObject({ default: "strict" }),
      evalBindingRef: "critical:rag:payroll-policy:v1",
      changeSummary: "Phase 6 retrieval index placeholder for governed RAG references",
    },
  });
}

async function findOrCreateToolSchemaVersion(contract: ReturnType<typeof toolContractsForNode>[number]) {
  const existing = await prisma.toolSchemaVersion.findUnique({
    where: { toolName_schemaVersion: { toolName: contract.name, schemaVersion: contract.version } },
  });
  if (existing) {
    assertAgentVersionReusable(
      existing.status,
      `ToolSchemaVersion:${existing.toolName}:${existing.schemaVersion}`,
    );
    return existing;
  }

  const schemas = contractJsonSchema(contract);
  return prisma.toolSchemaVersion.create({
    data: {
      toolName: contract.name,
      schemaVersion: contract.version,
      status: "INTERNAL_TEST",
      inputSchema: toInputJsonObject(schemas.inputSchema),
      outputSchema: toInputJsonObject(schemas.outputSchema),
      errorCodes: toInputJsonArray(contract.errorCodes),
      permissionLevel: contract.permissionLevel,
      riskLevel: contract.riskLevel,
      actionScope: contract.actionScope,
      requiresApproval: contract.requiresApproval,
      approvalPolicy: toInputJsonObject(contract.approvalPolicy),
      idempotencyRequired: contract.idempotencyRequired,
      timeoutMs: contract.timeoutMs,
      retryPolicy: toInputJsonObject(contract.retryPolicy),
      formalRunAllowed: contract.formalRunAllowed,
      evalBindingRef: contract.evalBindingRef,
      guardrailBindingRef: contract.guardrailBindingRef,
      traceFieldPolicy: toInputJsonObject(contract.traceFieldPolicy),
      changeSummary: "Phase 6 default tool contract",
    },
  });
}

async function releasePromptVersion(id: string) {
  const version = await prisma.promptVersion.findUniqueOrThrow({ where: { id } });
  assertAgentVersionReusable(version.status, `PromptVersion:${version.promptKey}:v${version.versionNumber}`);
  if (version.status === "RELEASED") {
    return;
  }
  await prisma.promptVersion.update({
    where: { id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
}

async function releaseModelVersion(id: string) {
  const version = await prisma.modelVersion.findUniqueOrThrow({ where: { id } });
  assertAgentVersionReusable(version.status, `ModelVersion:${version.modelKey}:v${version.versionNumber}`);
  if (version.status === "RELEASED") {
    return;
  }
  await prisma.modelVersion.update({
    where: { id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
}

async function releaseRetrievalIndexVersion(id: string) {
  const version = await prisma.retrievalIndexVersion.findUniqueOrThrow({ where: { id } });
  assertAgentVersionReusable(
    version.status,
    `RetrievalIndexVersion:${version.indexKey}:v${version.versionNumber}`,
  );
  if (version.status === "RELEASED") {
    return;
  }
  await prisma.retrievalIndexVersion.update({
    where: { id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
}

async function releaseToolSchemaVersion(id: string) {
  const version = await prisma.toolSchemaVersion.findUniqueOrThrow({ where: { id } });
  assertAgentVersionReusable(
    version.status,
    `ToolSchemaVersion:${version.toolName}:${version.schemaVersion}`,
  );
  if (version.status === "RELEASED") {
    return;
  }
  await prisma.toolSchemaVersion.update({
    where: { id },
    data: { status: "RELEASED", releasedAt: new Date() },
  });
}
