import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const customerConfirmationPackInputSchema = agentNodeInputSchema;
export const customerConfirmationPackOutputSchema = agentNodeOutputSchema;

export const customerConfirmationPackNode = defineSuggestionNode({
  nodeType: "CUSTOMER_CONFIRMATION_PACK",
  label: "客户确认包草稿",
  description: "生成客户确认包草稿、建议话术和覆盖范围，不得遗漏阻断或高风险。",
  allowedToolNames: ["confirmation_pack_draft"],
  allowedFields: ["run", "rawInputs", "evidenceRefs", "customerMemory", "ragChunks", "userPrompt"],
  riskLevel: "R2",
  humanGate: {
    mode: "PREVIEW_ONLY",
    requiredForFormalRun: true,
    approverRoles: ["DELIVERY_SPECIALIST", "PAYROLL_SPECIALIST"],
    previewBeforeApproval: true,
  },
});

export function runCustomerConfirmationPackNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(customerConfirmationPackNode, input, runtime);
}
