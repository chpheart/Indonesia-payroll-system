import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const fieldMappingInputSchema = agentNodeInputSchema;
export const fieldMappingOutputSchema = agentNodeOutputSchema;

export const fieldMappingNode = defineSuggestionNode({
  nodeType: "FIELD_MAPPING",
  label: "字段映射建议",
  description: "基于表头、样例值和客户记忆生成字段映射候选和判断依据。",
  allowedToolNames: ["field_mapping_candidate"],
  allowedFields: ["run", "workbookCells", "customerMemory", "ragChunks", "evidenceRefs", "userPrompt"],
  riskLevel: "R2",
  humanGate: {
    mode: "PREVIEW_ONLY",
    requiredForFormalRun: true,
    approverRoles: ["DELIVERY_SPECIALIST"],
    previewBeforeApproval: true,
  },
});

export function runFieldMappingNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(fieldMappingNode, input, runtime);
}
