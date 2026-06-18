import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const questionGenerationInputSchema = agentNodeInputSchema;
export const questionGenerationOutputSchema = agentNodeOutputSchema;

export const questionGenerationNode = defineSuggestionNode({
  nodeType: "QUESTION_GENERATION",
  label: "追问生成",
  description: "基于阻断、高风险、缺失字段和规则快照生成追问建议。",
  allowedToolNames: ["question_draft"],
  allowedFields: ["run", "rawInputs", "ragChunks", "evidenceRefs", "userPrompt"],
  riskLevel: "R1",
  humanGate: {
    mode: "NOT_REQUIRED",
    requiredForFormalRun: false,
    approverRoles: [],
    previewBeforeApproval: true,
  },
});

export function runQuestionGenerationNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(questionGenerationNode, input, runtime);
}
