import { type AgentNodeDefinition, type AgentNodeType } from "@/domain/agent/agent-types";
import {
  confirmationSummaryNode,
  runConfirmationSummaryNode,
} from "@/domain/agent/nodes/confirmation-summary-node";
import {
  changeExtractionNode,
  runChangeExtractionNode,
} from "@/domain/agent/nodes/change-extraction-node";
import {
  customerConfirmationPackNode,
  runCustomerConfirmationPackNode,
} from "@/domain/agent/nodes/customer-confirmation-pack-node";
import {
  employeeMatchingNode,
  runEmployeeMatchingNode,
} from "@/domain/agent/nodes/employee-matching-node";
import {
  evidenceLinkingNode,
  runEvidenceLinkingNode,
} from "@/domain/agent/nodes/evidence-linking-node";
import { excelStructureNode, runExcelStructureNode } from "@/domain/agent/nodes/excel-structure-node";
import { fieldMappingNode, runFieldMappingNode } from "@/domain/agent/nodes/field-mapping-node";
import {
  intakeClassificationNode,
  runIntakeClassificationNode,
} from "@/domain/agent/nodes/intake-classification-node";
import {
  precheckAdviceNode,
  runPrecheckAdviceNode,
} from "@/domain/agent/nodes/precheck-advice-node";
import {
  questionGenerationNode,
  runQuestionGenerationNode,
} from "@/domain/agent/nodes/question-generation-node";
import {
  reconciliationExplanationNode,
  runReconciliationExplanationNode,
} from "@/domain/agent/nodes/reconciliation-explanation-node";
import { type AgentNodeInput, type AgentNodeOutput, type AgentNodeRuntime } from "./base-node";

export type AgentNodeRunner = (
  input: AgentNodeInput,
  runtime: AgentNodeRuntime,
) => Promise<AgentNodeOutput>;

export const AGENT_WORKFLOW_ORDER: AgentNodeType[] = [
  "INTAKE_CLASSIFICATION",
  "EXCEL_STRUCTURE",
  "CHANGE_EXTRACTION",
  "FIELD_MAPPING",
  "EMPLOYEE_MATCHING",
  "QUESTION_GENERATION",
  "EVIDENCE_LINKING",
  "PRECHECK_ADVICE",
  "CUSTOMER_CONFIRMATION_PACK",
  "RECONCILIATION_EXPLANATION",
  "CONFIRMATION_SUMMARY",
];

export const AGENT_NODE_DEFINITIONS: Record<AgentNodeType, AgentNodeDefinition> = {
  INTAKE_CLASSIFICATION: intakeClassificationNode,
  EXCEL_STRUCTURE: excelStructureNode,
  CHANGE_EXTRACTION: changeExtractionNode,
  FIELD_MAPPING: fieldMappingNode,
  EMPLOYEE_MATCHING: employeeMatchingNode,
  QUESTION_GENERATION: questionGenerationNode,
  EVIDENCE_LINKING: evidenceLinkingNode,
  PRECHECK_ADVICE: precheckAdviceNode,
  CUSTOMER_CONFIRMATION_PACK: customerConfirmationPackNode,
  RECONCILIATION_EXPLANATION: reconciliationExplanationNode,
  CONFIRMATION_SUMMARY: confirmationSummaryNode,
};

export const AGENT_NODE_RUNNERS: Record<AgentNodeType, AgentNodeRunner> = {
  INTAKE_CLASSIFICATION: runIntakeClassificationNode,
  EXCEL_STRUCTURE: runExcelStructureNode,
  CHANGE_EXTRACTION: runChangeExtractionNode,
  FIELD_MAPPING: runFieldMappingNode,
  EMPLOYEE_MATCHING: runEmployeeMatchingNode,
  QUESTION_GENERATION: runQuestionGenerationNode,
  EVIDENCE_LINKING: runEvidenceLinkingNode,
  PRECHECK_ADVICE: runPrecheckAdviceNode,
  CUSTOMER_CONFIRMATION_PACK: runCustomerConfirmationPackNode,
  RECONCILIATION_EXPLANATION: runReconciliationExplanationNode,
  CONFIRMATION_SUMMARY: runConfirmationSummaryNode,
};

export function getAgentNodeDefinition(nodeType: AgentNodeType): AgentNodeDefinition {
  return AGENT_NODE_DEFINITIONS[nodeType];
}

export function getAgentNodeRunner(nodeType: AgentNodeType): AgentNodeRunner {
  return AGENT_NODE_RUNNERS[nodeType];
}
