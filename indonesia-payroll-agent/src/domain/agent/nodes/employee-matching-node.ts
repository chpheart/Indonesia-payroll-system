import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const employeeMatchingInputSchema = agentNodeInputSchema;
export const employeeMatchingOutputSchema = agentNodeOutputSchema;

export const employeeMatchingNode = defineSuggestionNode({
  nodeType: "EMPLOYEE_MATCHING",
  label: "员工匹配辅助",
  description: "生成员工匹配候选、重名和低置信冲突说明。",
  allowedToolNames: ["employee_match_candidate"],
  allowedFields: ["run", "rawInputs", "customerMemory", "evidenceRefs", "userPrompt"],
  riskLevel: "R2",
  humanGate: {
    mode: "PREVIEW_ONLY",
    requiredForFormalRun: true,
    approverRoles: ["DELIVERY_SPECIALIST", "PAYROLL_SPECIALIST"],
    previewBeforeApproval: true,
  },
});

export function runEmployeeMatchingNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(employeeMatchingNode, input, runtime);
}
