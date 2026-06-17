import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const changeExtractionInputSchema = agentNodeInputSchema;
export const changeExtractionOutputSchema = agentNodeOutputSchema;

export const changeExtractionNode = defineSuggestionNode({
  nodeType: "CHANGE_EXTRACTION",
  label: "变更抽取",
  description: "从 RawInputItem 和证据中抽取 ChangeProposal 候选、缺失证据和风险等级。",
  allowedToolNames: ["change_proposal_draft"],
  allowedFields: ["run", "rawInputs", "evidenceRefs", "customerMemory", "ragChunks", "userPrompt"],
  riskLevel: "R2",
  humanGate: {
    mode: "PREVIEW_ONLY",
    requiredForFormalRun: true,
    approverRoles: ["DELIVERY_SPECIALIST", "PAYROLL_SPECIALIST"],
    previewBeforeApproval: true,
  },
});

export function runChangeExtractionNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(changeExtractionNode, input, runtime);
}
