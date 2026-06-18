import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const evidenceLinkingInputSchema = agentNodeInputSchema;
export const evidenceLinkingOutputSchema = agentNodeOutputSchema;

export const evidenceLinkingNode = defineSuggestionNode({
  nodeType: "EVIDENCE_LINKING",
  label: "证据关联建议",
  description: "建议证据关联对象、覆盖范围和需人工确认的边界。",
  allowedToolNames: ["evidence_link_candidate"],
  allowedFields: ["run", "rawInputs", "evidenceRefs", "ragChunks", "userPrompt"],
  riskLevel: "R2",
  humanGate: {
    mode: "PREVIEW_ONLY",
    requiredForFormalRun: true,
    approverRoles: ["DELIVERY_SPECIALIST", "PAYROLL_SPECIALIST"],
    previewBeforeApproval: true,
  },
});

export function runEvidenceLinkingNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(evidenceLinkingNode, input, runtime);
}
