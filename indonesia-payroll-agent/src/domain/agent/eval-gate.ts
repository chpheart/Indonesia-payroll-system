import {
  type EvalCaseType,
  type EvalResultStatus,
  type EvalRun,
  type PrismaClient,
} from "@/generated/prisma/client";
import { type AuditRiskLevel } from "@/domain/audit/audit-service";
import { type JsonObject } from "@/domain/agent/agent-types";
import { type GoldenEvalTargetAdapter } from "@/domain/agent/golden-eval-set";
import { toInputJsonObject } from "@/lib/json/input-json";

export type EvalTargetType =
  | "PROMPT_VERSION"
  | "MODEL_VERSION"
  | "RETRIEVAL_INDEX_VERSION"
  | "TOOL_SCHEMA_VERSION"
  | "WORKFLOW_NODE";

export type EvalCaseOutcome = {
  status: EvalResultStatus;
  observedOutput: JsonObject;
  failureReason?: string;
};

export type ReleaseEvalCaseSpec = {
  caseKey: string;
  caseType: EvalCaseType;
  riskLevel: AuditRiskLevel;
  inputFixture: JsonObject;
  expectedOutput: JsonObject;
  sourceRefs: string[];
  evaluate: (adapter: GoldenEvalTargetAdapter) => EvalCaseOutcome;
};

export type ReleaseEvalTarget = {
  evalBindingRef: string;
  targetType: EvalTargetType;
  targetRef: string;
  cases: ReleaseEvalCaseSpec[];
  adapter: GoldenEvalTargetAdapter;
};

export type EvalGateResult = {
  evalRunId: string;
  evalBindingRef: string;
  status: EvalRun["status"];
};

export class AgentEvalGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentEvalGateError";
  }
}

export async function ensureReleaseEvalGate(
  db: PrismaClient,
  target: ReleaseEvalTarget,
): Promise<EvalGateResult> {
  if (target.cases.length === 0) {
    throw new AgentEvalGateError("EVAL_GATE_REQUIRES_CASES");
  }

  const evalCases = await Promise.all(
    target.cases.map((testCase) =>
      db.evalCase.upsert({
        where: {
          evalBindingRef_caseKey: {
            evalBindingRef: target.evalBindingRef,
            caseKey: testCase.caseKey,
          },
        },
        update: {
          caseType: testCase.caseType,
          riskLevel: testCase.riskLevel,
          requiredForRelease: true,
          inputFixture: toInputJsonObject(testCase.inputFixture),
          expectedOutput: toInputJsonObject(testCase.expectedOutput),
          sourceRefs: testCase.sourceRefs,
        },
        create: {
          evalBindingRef: target.evalBindingRef,
          caseKey: testCase.caseKey,
          caseType: testCase.caseType,
          riskLevel: testCase.riskLevel,
          requiredForRelease: true,
          inputFixture: toInputJsonObject(testCase.inputFixture),
          expectedOutput: toInputJsonObject(testCase.expectedOutput),
          sourceRefs: testCase.sourceRefs,
        },
      }),
    ),
  );

  const requiredCaseKeys = new Set(target.cases.map((testCase) => testCase.caseKey));
  const evalRun = await db.evalRun.create({
    data: {
      evalBindingRef: target.evalBindingRef,
      targetType: target.targetType,
      targetRef: target.targetRef,
      status: "PENDING",
      totalCaseCount: target.cases.length,
      resultSummary: toInputJsonObject({ requiredCaseKeys: Array.from(requiredCaseKeys) }),
    },
  });

  const outcomes = target.cases.map((testCase, index) => ({
    testCase,
    evalCase: evalCases[index],
    outcome: testCase.evaluate(target.adapter),
  }));
  await db.evalRunResult.createMany({
    data: outcomes.map(({ evalCase, outcome }) => ({
      evalRunId: evalRun.id,
      evalCaseId: evalCase.id,
      status: outcome.status,
      observedOutput: toInputJsonObject(outcome.observedOutput),
      failureReason: outcome.failureReason,
    })),
  });

  const passedCaseCount = outcomes.filter(({ outcome }) => outcome.status === "PASSED").length;
  const failedCaseCount = outcomes.filter(({ outcome }) => outcome.status === "FAILED").length;
  const blockedCaseCount = outcomes.filter(({ outcome }) => outcome.status === "BLOCKED").length;
  const status = failedCaseCount > 0 || blockedCaseCount > 0 ? "FAILED" : "PASSED";
  const completedRun = await db.evalRun.update({
    where: { id: evalRun.id },
    data: {
      status,
      passedCaseCount,
      failedCaseCount,
      blockedCaseCount,
      completedAt: new Date(),
      resultSummary: toInputJsonObject({
        requiredCaseKeys: Array.from(requiredCaseKeys),
        failedCases: outcomes
          .filter(({ outcome }) => outcome.status !== "PASSED")
          .map(({ testCase, outcome }) => ({
            caseKey: testCase.caseKey,
            failureReason: outcome.failureReason ?? "EVAL_CASE_FAILED",
          })),
      }),
    },
  });

  if (completedRun.status !== "PASSED") {
    throw new AgentEvalGateError(`EVAL_GATE_FAILED:${target.evalBindingRef}`);
  }

  return {
    evalRunId: completedRun.id,
    evalBindingRef: completedRun.evalBindingRef,
    status: completedRun.status,
  };
}

export {
  modelVersionEvalTarget,
  promptVersionEvalTarget,
  retrievalIndexEvalTarget,
} from "@/domain/agent/version-eval-targets";
export { toolSchemaEvalTarget, workflowNodeEvalTarget } from "@/domain/agent/tool-node-eval-targets";
