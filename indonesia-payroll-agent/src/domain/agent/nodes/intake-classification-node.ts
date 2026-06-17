import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const intakeClassificationInputSchema = agentNodeInputSchema;
export const intakeClassificationOutputSchema = agentNodeOutputSchema;

export const intakeClassificationNode = defineSuggestionNode({
  nodeType: "INTAKE_CLASSIFICATION",
  label: "Intake 分类",
  description: "识别 RawInputItem 类型、客户/月度归属建议、重复提示和敏感字段提示。",
  allowedToolNames: ["raw_input_classification_preview"],
  allowedFields: ["run", "rawInputs", "evidenceRefs", "userPrompt"],
  riskLevel: "R1",
  humanGate: {
    mode: "NOT_REQUIRED",
    requiredForFormalRun: false,
    approverRoles: [],
    previewBeforeApproval: true,
  },
});

export function runIntakeClassificationNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(intakeClassificationNode, input, runtime);
}
