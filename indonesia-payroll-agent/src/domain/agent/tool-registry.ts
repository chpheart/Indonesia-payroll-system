import { tool, type FunctionTool, type RunContext } from "@openai/agents";
import { z } from "zod";
import {
  AGENT_NODE_TYPES,
  type AgentNodeType,
  type JsonObject,
  type ToolContract,
  type ToolPermissionLevel,
} from "@/domain/agent/agent-types";

export type AgentToolRuntimeContext = {
  agentRunId: string;
  actorId: string;
  runId: string;
  clientId: string;
  formalRun: boolean;
};

const baseToolInputSchema = z.object({
  runId: z.string().min(1),
  clientId: z.string().min(1),
  payrollMonth: z.string().min(7).max(7),
  contextSnapshotId: z.string().min(1),
  evidenceRefs: z.array(z.string()),
  sourceObjectRefs: z.array(z.string()),
  redactedInputSummary: z.record(z.string(), z.unknown()),
  idempotencyKey: z.string().min(8),
});

const candidateOutputSchema = z.object({
  status: z.enum(["CANDIDATE", "NEEDS_REVIEW", "BLOCKED"]),
  summary: z.string(),
  riskLevel: z.enum(["R0", "R1", "R2", "R3", "R4"]),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  citations: z.array(z.string()).default([]),
  humanGate: z.object({
    required: z.boolean(),
    reason: z.string(),
    approvalMode: z.enum(["NOT_REQUIRED", "PREVIEW_ONLY", "MANUAL_REQUIRED"]),
  }),
  payload: z.record(z.string(), z.unknown()).default({}),
});

type ContractSpec = {
  name: string;
  description: string;
  permissionLevel: ToolPermissionLevel;
  riskLevel: ToolContract["riskLevel"];
  allowedNodeTypes: AgentNodeType[];
  requiresApproval: boolean;
  actionScope: string[];
};

const CONTRACT_SPECS: ContractSpec[] = [
  {
    name: "raw_input_classification_preview",
    description: "生成 RawInputItem 类型、客户/月度归属和重复风险建议，不生效归属。",
    permissionLevel: "READ",
    riskLevel: "R1",
    allowedNodeTypes: ["INTAKE_CLASSIFICATION"],
    requiresApproval: false,
    actionScope: ["suggest_raw_input_classification"],
  },
  {
    name: "excel_structure_preview",
    description: "读取已解析 workbook 摘要，建议 sheet 类型、表头区域和异常。",
    permissionLevel: "READ",
    riskLevel: "R1",
    allowedNodeTypes: ["EXCEL_STRUCTURE"],
    requiresApproval: false,
    actionScope: ["suggest_excel_structure"],
  },
  {
    name: "change_proposal_draft",
    description: "从不可信输入生成 ChangeProposal 候选，不能写入正式 ledger。",
    permissionLevel: "WRITE_PROPOSAL",
    riskLevel: "R2",
    allowedNodeTypes: ["CHANGE_EXTRACTION"],
    requiresApproval: true,
    actionScope: ["draft_change_proposal"],
  },
  {
    name: "field_mapping_candidate",
    description: "生成字段映射候选和置信档，人工确认前不得生效。",
    permissionLevel: "WRITE_DRAFT",
    riskLevel: "R2",
    allowedNodeTypes: ["FIELD_MAPPING"],
    requiresApproval: true,
    actionScope: ["draft_field_mapping"],
  },
  {
    name: "employee_match_candidate",
    description: "生成员工匹配候选和冲突说明，低置信必须人工确认。",
    permissionLevel: "WRITE_DRAFT",
    riskLevel: "R2",
    allowedNodeTypes: ["EMPLOYEE_MATCHING"],
    requiresApproval: true,
    actionScope: ["draft_employee_match"],
  },
  {
    name: "question_draft",
    description: "生成追问建议和理由，客服确认后才能发送客户。",
    permissionLevel: "WRITE_DRAFT",
    riskLevel: "R1",
    allowedNodeTypes: ["QUESTION_GENERATION"],
    requiresApproval: false,
    actionScope: ["draft_question"],
  },
  {
    name: "evidence_link_candidate",
    description: "建议证据关联对象和覆盖范围，人工确认前不得绑定生效。",
    permissionLevel: "WRITE_DRAFT",
    riskLevel: "R2",
    allowedNodeTypes: ["EVIDENCE_LINKING"],
    requiresApproval: true,
    actionScope: ["draft_evidence_link"],
  },
  {
    name: "precheck_advice",
    description: "生成预检查解释和疑似阻断建议，系统规则判定为准。",
    permissionLevel: "READ",
    riskLevel: "R1",
    allowedNodeTypes: ["PRECHECK_ADVICE"],
    requiresApproval: false,
    actionScope: ["suggest_precheck"],
  },
  {
    name: "confirmation_pack_draft",
    description: "生成客户确认包草稿和建议话术，不得隐藏阻断或高风险项。",
    permissionLevel: "WRITE_DRAFT",
    riskLevel: "R2",
    allowedNodeTypes: ["CUSTOMER_CONFIRMATION_PACK"],
    requiresApproval: true,
    actionScope: ["draft_confirmation_pack"],
  },
  {
    name: "reconciliation_explanation",
    description: "基于 calculation trace 和规则版本生成核查解释，不改变计算结果。",
    permissionLevel: "READ",
    riskLevel: "R1",
    allowedNodeTypes: ["RECONCILIATION_EXPLANATION"],
    requiresApproval: false,
    actionScope: ["explain_reconciliation"],
  },
  {
    name: "payroll_confirmation_summary",
    description: "生成算薪确认包摘要和下钻建议，不执行锁定或放行。",
    permissionLevel: "READ",
    riskLevel: "R1",
    allowedNodeTypes: ["CONFIRMATION_SUMMARY"],
    requiresApproval: false,
    actionScope: ["summarize_confirmation_package"],
  },
];

export const DEFAULT_TOOL_CONTRACTS = CONTRACT_SPECS.map(makeContract);

export function findToolContract(name: string): ToolContract | null {
  return DEFAULT_TOOL_CONTRACTS.find((contract) => contract.name === name) ?? null;
}

export function toolContractsForNode(nodeType: AgentNodeType): ToolContract[] {
  return DEFAULT_TOOL_CONTRACTS.filter((contract) => contract.allowedNodeTypes.includes(nodeType));
}

export function createAgentsSdkTool(
  contract: ToolContract,
  execute: (
    input: z.output<typeof baseToolInputSchema>,
    context?: RunContext<AgentToolRuntimeContext>,
  ) => Promise<JsonObject>,
): FunctionTool<AgentToolRuntimeContext, typeof baseToolInputSchema> {
  if (!(contract.inputSchema instanceof z.ZodObject)) {
    throw new Error("TOOL_INPUT_SCHEMA_MUST_BE_ZOD_OBJECT");
  }

  return tool({
    name: contract.name,
    description: contract.description,
    parameters: baseToolInputSchema,
    strict: true,
    timeoutMs: contract.timeoutMs,
    needsApproval: contract.requiresApproval,
    isEnabled: ({ runContext }) => !runContext.context.formalRun || contract.formalRunAllowed,
    execute: async (input, context) => {
      const parsedInput = baseToolInputSchema.parse(input);
      const output = await execute(parsedInput, context);
      return contract.outputSchema.parse(output);
    },
  });
}

function makeContract(spec: ContractSpec): ToolContract<typeof baseToolInputSchema, typeof candidateOutputSchema> {
  const requiresManual = spec.requiresApproval || ["R2", "R3", "R4"].includes(spec.riskLevel);
  return {
    ...spec,
    version: "1.0.0",
    releaseStatus: "RELEASED",
    criticalEvalStatus: "MISSING",
    inputSchema: baseToolInputSchema,
    outputSchema: candidateOutputSchema,
    errorCodes: ["CONTEXT_OUT_OF_SCOPE", "PERMISSION_DENIED", "GUARDRAIL_BLOCKED", "TIMEOUT"],
    approvalPolicy: {
      mode: requiresManual ? "PREVIEW_ONLY" : "NOT_REQUIRED",
      requiredForFormalRun: requiresManual,
      approverRoles: requiresManual ? ["DELIVERY_SPECIALIST", "PAYROLL_SPECIALIST", "PAYROLL_LEAD"] : [],
      previewBeforeApproval: requiresManual,
    },
    idempotencyRequired: true,
    timeoutMs: 15_000,
    retryPolicy: { maxRetries: 1, retryableErrorCodes: ["TIMEOUT"] },
    formalRunAllowed: true,
    evalBindingRef: `critical:${spec.name}:v1`,
    guardrailBindingRef: `guardrail:${spec.name}:v1`,
    traceFieldPolicy: {
      persist: ["contextSnapshotId", "evidenceRefs", "sourceObjectRefs"],
      redact: ["redactedInputSummary"],
      hashOnly: ["idempotencyKey"],
      evidenceRefsOnly: true,
    },
  };
}

export function assertKnownNodeType(nodeType: string): asserts nodeType is AgentNodeType {
  if (!AGENT_NODE_TYPES.includes(nodeType as AgentNodeType)) {
    throw new Error("UNKNOWN_AGENT_NODE_TYPE");
  }
}
