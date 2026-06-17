import {
  type AgentNodeDefinition,
  type JsonObject,
  type ToolContract,
} from "@/domain/agent/agent-types";
import {
  type EvalCaseOutcome,
  type ReleaseEvalCaseSpec,
  type ReleaseEvalTarget,
} from "@/domain/agent/eval-gate";
import {
  createGoldenEvalTargetAdapter,
  workflowNodeBusinessGoldenCases,
} from "@/domain/agent/golden-eval-set";
import { lintToolContracts } from "@/domain/agent/tool-contract-linter";

export function toolSchemaEvalTarget(input: {
  id: string;
  contract: ToolContract;
}): ReleaseEvalTarget {
  const lint = lintToolContracts([input.contract]);
  const businessCases = uniqueReleaseEvalCases(
    input.contract.allowedNodeTypes.flatMap(workflowNodeBusinessGoldenCases),
  );
  const requiresApprovalForRisk =
    !["R2", "R3", "R4"].includes(input.contract.riskLevel) || input.contract.requiresApproval;
  return {
    evalBindingRef: input.contract.evalBindingRef,
    targetType: "TOOL_SCHEMA_VERSION",
    targetRef: input.id,
    adapter: createGoldenEvalTargetAdapter({
      targetType: "TOOL_SCHEMA_VERSION",
      targetRef: input.id,
      policy: "CANDIDATE_ONLY",
      sourceRefs: ["Product-Spec.md", "DEV-PLAN.md"],
      canGenerateQuestions: input.contract.allowedNodeTypes.includes("QUESTION_GENERATION"),
      canFallbackWhenNoSource: true,
      canClassifyGrossMode: input.contract.allowedNodeTypes.includes("PRECHECK_ADVICE"),
      canBlockHighRisk: input.contract.allowedNodeTypes.includes("PRECHECK_ADVICE"),
      canMapCriticalFields: input.contract.allowedNodeTypes.includes("FIELD_MAPPING"),
      traceIncludesSensitiveData: !input.contract.traceFieldPolicy.evidenceRefsOnly,
      previewBeforeWrite: true,
    }),
    cases: [
      {
        caseKey: "tool-contract-lint",
        caseType: "GOLDEN",
        riskLevel: input.contract.riskLevel,
        inputFixture: {
          toolName: input.contract.name,
          schemaVersion: input.contract.version,
          issueCodes: lint.issues.map((issue) => issue.code),
        },
        expectedOutput: { lintOk: true },
        sourceRefs: ["DEV-PLAN.md#Phase-6"],
        evaluate: () =>
          passIf(
            lint.ok,
            { lintOk: lint.ok, issueCodes: lint.issues.map((issue) => issue.code) },
            "TOOL_CONTRACT_LINT_MUST_PASS",
          ),
      },
      {
        caseKey: "r2-plus-preview-approval",
        caseType: "PERMISSION",
        riskLevel: input.contract.riskLevel,
        inputFixture: {
          riskLevel: input.contract.riskLevel,
          requiresApproval: input.contract.requiresApproval,
          approvalMode: input.contract.approvalPolicy.mode,
        },
        expectedOutput: { r2PlusRequiresApproval: true, previewBeforeApproval: true },
        sourceRefs: ["Product-Spec.md#高责任-Agent-设计原则"],
        evaluate: () =>
          passIf(
            requiresApprovalForRisk && input.contract.approvalPolicy.previewBeforeApproval,
            {
              riskLevel: input.contract.riskLevel,
              requiresApproval: input.contract.requiresApproval,
              previewBeforeApproval: input.contract.approvalPolicy.previewBeforeApproval,
            },
            "R2_PLUS_TOOL_MUST_REQUIRE_PREVIEW_APPROVAL",
          ),
      },
      {
        caseKey: "trace-policy-redacts-inputs",
        caseType: "GUARDRAIL",
        riskLevel: "R3",
        inputFixture: { traceFieldPolicy: input.contract.traceFieldPolicy },
        expectedOutput: { evidenceRefsOnly: true, redactsInputSummary: true },
        sourceRefs: ["DEV-PLAN.md#Phase-6"],
        evaluate: () =>
          passIf(
            input.contract.traceFieldPolicy.evidenceRefsOnly &&
              input.contract.traceFieldPolicy.redact.includes("redactedInputSummary"),
            {
              evidenceRefsOnly: input.contract.traceFieldPolicy.evidenceRefsOnly,
              redactedFields: input.contract.traceFieldPolicy.redact,
            },
            "TOOL_TRACE_POLICY_MUST_REDACT_INPUT_SUMMARY",
          ),
      },
      ...businessCases,
    ],
  };
}

export function workflowNodeEvalTarget(node: AgentNodeDefinition): ReleaseEvalTarget {
  const baseCases = workflowNodeBusinessGoldenCases(node.nodeType);
  return {
    evalBindingRef: node.evalBindingRef,
    targetType: "WORKFLOW_NODE",
    targetRef: `${node.nodeType}:v1`,
    adapter: createGoldenEvalTargetAdapter({
      targetType: "WORKFLOW_NODE",
      targetRef: `${node.nodeType}:v1`,
      policy: node.humanGate.previewBeforeApproval ? "CANDIDATE_ONLY" : "READ_ONLY",
      sourceRefs: ["Product-Spec.md", "DEV-PLAN.md"],
      canGenerateQuestions: node.nodeType === "QUESTION_GENERATION",
      canFallbackWhenNoSource: node.nodeType === "RECONCILIATION_EXPLANATION",
      canClassifyGrossMode: node.nodeType === "PRECHECK_ADVICE",
      canBlockHighRisk: node.nodeType === "PRECHECK_ADVICE",
      canMapCriticalFields: node.nodeType === "FIELD_MAPPING",
      traceIncludesSensitiveData: false,
      previewBeforeWrite: node.humanGate.previewBeforeApproval,
    }),
    cases: [
      {
        caseKey: "node-contract-has-trace-guardrail-eval",
        caseType: "GOLDEN",
        riskLevel: node.riskLevel,
        inputFixture: {
          nodeType: node.nodeType,
          allowedToolNames: node.allowedToolNames,
          evalBindingRef: node.evalBindingRef,
          guardrailBindingRef: node.guardrailBindingRef,
        },
        expectedOutput: {
          hasInputSchema: true,
          hasOutputSchema: true,
          hasEvalBinding: true,
          hasGuardrailBinding: true,
          hasTool: true,
        },
        sourceRefs: ["DEV-PLAN.md#Phase-6", "Product-Spec.md#REQ-015B"],
        evaluate: () =>
          passIf(
            Boolean(node.inputSchema) &&
              Boolean(node.outputSchema) &&
              node.evalBindingRef === `critical:${node.nodeType}:v1` &&
              node.guardrailBindingRef === `guardrail:${node.nodeType}:v1` &&
              node.allowedToolNames.length > 0,
            {
              nodeType: node.nodeType,
              evalBindingRef: node.evalBindingRef,
              guardrailBindingRef: node.guardrailBindingRef,
              allowedToolCount: node.allowedToolNames.length,
            },
            "WORKFLOW_NODE_CONTRACT_INCOMPLETE",
          ),
      },
      ...baseCases,
    ],
  };
}

function passIf(
  condition: boolean,
  observedOutput: JsonObject,
  failureReason: string,
): EvalCaseOutcome {
  if (condition) {
    return { status: "PASSED", observedOutput };
  }
  return { status: "FAILED", observedOutput, failureReason };
}

function uniqueReleaseEvalCases(cases: ReleaseEvalCaseSpec[]): ReleaseEvalCaseSpec[] {
  const seen = new Set<string>();
  return cases.filter((testCase) => {
    if (seen.has(testCase.caseKey)) {
      return false;
    }
    seen.add(testCase.caseKey);
    return true;
  });
}
