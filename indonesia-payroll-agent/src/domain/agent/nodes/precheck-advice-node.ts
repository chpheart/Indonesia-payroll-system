import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const precheckAdviceInputSchema = agentNodeInputSchema;
export const precheckAdviceOutputSchema = agentNodeOutputSchema;

export const precheckAdviceNode = defineSuggestionNode({
  nodeType: "PRECHECK_ADVICE",
  label: "预检查建议",
  description: "基于标准化数据和规则快照生成缺失项、疑似阻断和高风险建议。",
  allowedToolNames: ["precheck_advice"],
  allowedFields: ["run", "ragChunks", "evidenceRefs", "customerMemory", "userPrompt"],
  riskLevel: "R1",
  humanGate: {
    mode: "NOT_REQUIRED",
    requiredForFormalRun: false,
    approverRoles: [],
    previewBeforeApproval: true,
  },
});

export function runPrecheckAdviceNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(precheckAdviceNode, input, runtime);
}
