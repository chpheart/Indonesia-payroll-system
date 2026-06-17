import {
  agentNodeInputSchema,
  agentNodeOutputSchema,
  defineSuggestionNode,
  runSuggestionNode,
  type AgentNodeInput,
  type AgentNodeOutput,
  type AgentNodeRuntime,
} from "@/domain/agent/nodes/base-node";

export const excelStructureInputSchema = agentNodeInputSchema;
export const excelStructureOutputSchema = agentNodeOutputSchema;

export const excelStructureNode = defineSuggestionNode({
  nodeType: "EXCEL_STRUCTURE",
  label: "Excel 结构识别",
  description: "识别 workbook sheet 类型、表头区域、有效数据区域和文件异常。",
  allowedToolNames: ["excel_structure_preview"],
  allowedFields: ["run", "workbookCells", "evidenceRefs", "userPrompt"],
  riskLevel: "R1",
  humanGate: {
    mode: "NOT_REQUIRED",
    requiredForFormalRun: false,
    approverRoles: [],
    previewBeforeApproval: true,
  },
});

export function runExcelStructureNode(
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
): Promise<AgentNodeOutput> {
  return runSuggestionNode(excelStructureNode, input, runtime);
}
