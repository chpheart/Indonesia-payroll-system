import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const reconciliationExplanationInputSchema = agentNodeInputSchema;
export const reconciliationExplanationOutputSchema = agentNodeOutputSchema;

export const reconciliationExplanationNode = defineSuggestionNode({
  nodeType: "RECONCILIATION_EXPLANATION",
  label: "核查解释",
  description: "基于核查结果、calculation trace 和规则版本生成解释和引用。",
  allowedToolNames: ["reconciliation_explanation"],
  allowedFields: ["run", "ragChunks", "evidenceRefs", "userPrompt"],
  riskLevel: "R1",
  humanGate: {
    mode: "NOT_REQUIRED",
    requiredForFormalRun: false,
    approverRoles: [],
    previewBeforeApproval: true,
  },
});

export function runReconciliationExplanationNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(reconciliationExplanationNode, input, runtime);
}
