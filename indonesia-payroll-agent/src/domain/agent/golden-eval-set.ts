import { type AgentNodeType } from "@/domain/agent/agent-types";
import { GOLDEN_CASES } from "@/domain/agent/golden-eval-cases";
import {
  definedJsonObject,
  evaluateGoldenCase,
} from "@/domain/agent/golden-eval-evaluator";
import { createGoldenEvalTargetAdapter } from "@/domain/agent/golden-eval-target-adapter";
import {
  type GoldenCaseDefinition,
  type GoldenEvalTargetAdapter,
  type GoldenFixture,
} from "@/domain/agent/golden-eval-types";
import { type EvalCaseOutcome, type ReleaseEvalCaseSpec } from "@/domain/agent/eval-gate";

export { createGoldenEvalTargetAdapter };
export type { GoldenEvalTargetAdapter };

export function globalBusinessGoldenCases(): ReleaseEvalCaseSpec[] {
  return GOLDEN_CASES.map(toReleaseEvalCase);
}

export function workflowNodeBusinessGoldenCases(nodeType: AgentNodeType): ReleaseEvalCaseSpec[] {
  return GOLDEN_CASES.filter((testCase) => testCase.nodeType === nodeType).map(toReleaseEvalCase);
}

export function runAgentGoldenCase(
  caseKey: string,
  fixtureOverride: Partial<GoldenFixture> = {},
): EvalCaseOutcome {
  const testCase = GOLDEN_CASES.find((item) => item.caseKey === caseKey);
  if (!testCase) {
    throw new Error(`AGENT_GOLDEN_CASE_NOT_FOUND:${caseKey}`);
  }
  return evaluateGoldenCase(
    {
      ...testCase,
      inputFixture: {
        ...testCase.inputFixture,
        ...definedJsonObject(fixtureOverride),
        evaluator: testCase.inputFixture.evaluator,
      },
    },
    defaultGoldenEvalAdapter(testCase.nodeType),
  );
}

function toReleaseEvalCase(testCase: GoldenCaseDefinition): ReleaseEvalCaseSpec {
  return {
    caseKey: testCase.caseKey,
    caseType: testCase.caseType,
    riskLevel: testCase.riskLevel,
    inputFixture: testCase.inputFixture,
    expectedOutput: testCase.expectedOutput,
    sourceRefs: testCase.sourceRefs,
    evaluate: (adapter) => evaluateGoldenCase(testCase, adapter),
  };
}

function defaultGoldenEvalAdapter(nodeType: AgentNodeType): GoldenEvalTargetAdapter {
  return createGoldenEvalTargetAdapter({
    targetType: "UNIT_TEST",
    targetRef: `${nodeType}:default`,
    policy: "CANDIDATE_ONLY",
    sourceRefs: ["Product-Spec.md", "DEV-PLAN.md"],
    canGenerateQuestions: true,
    canFallbackWhenNoSource: true,
    canClassifyGrossMode: true,
    canBlockHighRisk: true,
    canMapCriticalFields: true,
    traceIncludesSensitiveData: false,
    previewBeforeWrite: true,
  });
}
