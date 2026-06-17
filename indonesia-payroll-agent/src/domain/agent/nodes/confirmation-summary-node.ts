import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const confirmationSummaryInputSchema = agentNodeInputSchema;
export const confirmationSummaryOutputSchema = agentNodeOutputSchema;

export const confirmationSummaryNode = defineSuggestionNode({
  nodeType: "CONFIRMATION_SUMMARY",
  label: "确认包摘要",
  description: "基于算薪结果、异常和证据生成确认包摘要和下钻建议。",
  allowedToolNames: ["payroll_confirmation_summary"],
  allowedFields: ["run", "ragChunks", "evidenceRefs", "userPrompt"],
  riskLevel: "R1",
  humanGate: {
    mode: "NOT_REQUIRED",
    requiredForFormalRun: false,
    approverRoles: [],
    previewBeforeApproval: true,
  },
});

export function runConfirmationSummaryNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(confirmationSummaryNode, input, runtime);
}
