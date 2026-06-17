import { z } from "zod";
import { type AgentNodeType, type JsonObject, type ToolContract } from "@/domain/agent/agent-types";

export type ToolContractLintIssue = {
  contractName: string;
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
};

export type ToolContractLintResult = {
  ok: boolean;
  issues: ToolContractLintIssue[];
};

export class ToolContractLintError extends Error {
  constructor(public readonly issues: ToolContractLintIssue[]) {
    super("TOOL_CONTRACT_LINT_FAILED");
    this.name = "ToolContractLintError";
  }
}

export function lintToolContracts(contracts: ToolContract[]): ToolContractLintResult {
  const seen = new Set<string>();
  const issues = contracts.flatMap((contract) => {
    const contractIssues = lintSingleContract(contract);
    const identity = `${contract.name}@${contract.version}`;
    if (seen.has(identity)) {
      contractIssues.push(issue(contract, "ERROR", "DUPLICATE_TOOL_VERSION", identity));
    }
    seen.add(identity);
    return contractIssues;
  });

  return { ok: issues.every((item) => item.severity !== "ERROR"), issues };
}

export function assertToolContractsPassLint(contracts: ToolContract[]): void {
  const result = lintToolContracts(contracts);
  if (!result.ok) {
    throw new ToolContractLintError(result.issues);
  }
}

export function assertToolUsableForFormalRun(contract: ToolContract, nodeType: AgentNodeType): void {
  const issues = lintSingleContract(contract).filter((item) => item.severity === "ERROR");
  if (issues.length > 0) {
    throw new ToolContractLintError(issues);
  }

  if (!contract.allowedNodeTypes.includes(nodeType)) {
    throw new ToolContractLintError([
      issue(contract, "ERROR", "TOOL_NOT_ALLOWED_FOR_NODE", nodeType),
    ]);
  }

  if (!contract.formalRunAllowed) {
    throw new ToolContractLintError([
      issue(contract, "ERROR", "TOOL_NOT_ALLOWED_FOR_FORMAL_RUN", contract.name),
    ]);
  }

  if (contract.releaseStatus !== "RELEASED") {
    throw new ToolContractLintError([
      issue(contract, "ERROR", "TOOL_SCHEMA_RELEASE_GATE_FAILED", contract.name),
    ]);
  }
}

export function contractJsonSchema(contract: ToolContract): {
  inputSchema: JsonObject;
  outputSchema: JsonObject;
} {
  return {
    inputSchema: z.toJSONSchema(contract.inputSchema, { target: "draft-07" }) as JsonObject,
    outputSchema: z.toJSONSchema(contract.outputSchema, { target: "draft-07" }) as JsonObject,
  };
}

function lintSingleContract(contract: ToolContract): ToolContractLintIssue[] {
  const issues: ToolContractLintIssue[] = [];
  requiredText(contract.name, "TOOL_NAME_REQUIRED", contract, issues);
  requiredText(contract.version, "TOOL_VERSION_REQUIRED", contract, issues);
  requiredText(contract.description, "TOOL_DESCRIPTION_REQUIRED", contract, issues);
  requiredText(contract.evalBindingRef, "EVAL_BINDING_REQUIRED", contract, issues);
  requiredText(contract.guardrailBindingRef, "GUARDRAIL_BINDING_REQUIRED", contract, issues);

  if (contract.allowedNodeTypes.length === 0) {
    issues.push(issue(contract, "ERROR", "ALLOWED_NODE_REQUIRED", contract.name));
  }
  if (contract.errorCodes.length === 0) {
    issues.push(issue(contract, "ERROR", "ERROR_CODES_REQUIRED", contract.name));
  }
  if (contract.actionScope.length !== 1) {
    issues.push(issue(contract, "ERROR", "SINGLE_ACTION_SCOPE_REQUIRED", contract.name));
  }
  if (contract.timeoutMs < 1_000 || contract.timeoutMs > 60_000) {
    issues.push(issue(contract, "ERROR", "TIMEOUT_OUT_OF_RANGE", String(contract.timeoutMs)));
  }
  if (contract.retryPolicy.maxRetries < 0 || contract.retryPolicy.maxRetries > 3) {
    issues.push(issue(contract, "ERROR", "RETRY_POLICY_OUT_OF_RANGE", contract.name));
  }
  if (!contract.idempotencyRequired) {
    issues.push(issue(contract, "ERROR", "IDEMPOTENCY_REQUIRED", contract.name));
  }
  if (["R2", "R3", "R4"].includes(contract.riskLevel) && !contract.requiresApproval) {
    issues.push(issue(contract, "ERROR", "R2_PLUS_REQUIRES_APPROVAL", contract.name));
  }
  if (contract.requiresApproval && contract.approvalPolicy.mode === "NOT_REQUIRED") {
    issues.push(issue(contract, "ERROR", "APPROVAL_POLICY_MISSING", contract.name));
  }
  if (contract.formalRunAllowed && contract.releaseStatus !== "RELEASED") {
    issues.push(issue(contract, "ERROR", "FORMAL_TOOL_NOT_RELEASED", contract.name));
  }
  if (contract.formalRunAllowed && contract.criticalEvalStatus !== "MISSING") {
    issues.push(issue(contract, "WARNING", "FORMAL_TOOL_EVAL_STATUS_MUST_COME_FROM_EVAL_RUN", contract.name));
  }
  if (!contract.traceFieldPolicy.evidenceRefsOnly) {
    issues.push(issue(contract, "WARNING", "TRACE_SHOULD_PREFER_EVIDENCE_REFS", contract.name));
  }
  ensureZodObject(contract.inputSchema, "INPUT_SCHEMA_MUST_BE_ZOD_OBJECT", contract, issues);
  ensureZodObject(contract.outputSchema, "OUTPUT_SCHEMA_MUST_BE_ZOD_OBJECT", contract, issues);
  return issues;
}

function requiredText(
  value: string,
  code: string,
  contract: ToolContract,
  issues: ToolContractLintIssue[],
) {
  if (!value.trim()) {
    issues.push(issue(contract, "ERROR", code, contract.name));
  }
}

function ensureZodObject(
  schema: z.ZodTypeAny,
  code: string,
  contract: ToolContract,
  issues: ToolContractLintIssue[],
) {
  if (!(schema instanceof z.ZodObject)) {
    issues.push(issue(contract, "ERROR", code, contract.name));
  }
}

function issue(
  contract: Pick<ToolContract, "name">,
  severity: ToolContractLintIssue["severity"],
  code: string,
  message: string,
): ToolContractLintIssue {
  return { contractName: contract.name, severity, code, message };
}
