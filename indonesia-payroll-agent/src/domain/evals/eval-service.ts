import {
  type EvalResultStatus,
  type EvalRunStatus,
  type PrismaClient,
} from "@/generated/prisma/client";
import { PHASE7_DATASET, PHASE7_EVAL_CASES, missingCriticalNodeTypes } from "@/domain/evals/golden-cases";
import { type AgentNodeType, type JsonObject } from "@/domain/agent/agent-types";
import { toInputJsonObject } from "@/lib/json/input-json";

export const PHASE7_EVAL_BINDING_REF = "critical:phase7-golden-eval-guardrails:v1";

export type RunPhase7EvalInput = {
  caseKeys?: string[];
  nodeTypes?: AgentNodeType[];
  promptVersionRef?: string;
  modelVersionRef?: string;
  toolSchemaVersionRef?: string;
  retrievalIndexVersionRef?: string;
  guardrailConfigRef?: string;
};

export type Phase7EvalResult = {
  caseKey: string;
  nodeType: AgentNodeType;
  caseType: string;
  riskLevel: string;
  status: EvalResultStatus;
  observedOutput: JsonObject;
  failureReason?: string;
};

export type Phase7EvalSummary = {
  evalBindingRef: string;
  targetType: "EVAL_DATASET";
  targetRef: string;
  status: EvalRunStatus;
  totalCaseCount: number;
  passedCaseCount: number;
  failedCaseCount: number;
  blockedCaseCount: number;
  releaseGatePassed: boolean;
  evaluationScope: "FULL" | "PARTIAL";
  missingCriticalNodeTypes: AgentNodeType[];
  results: Phase7EvalResult[];
};

export function runPhase7EvalSuite(input: RunPhase7EvalInput = {}): Phase7EvalSummary {
  const cases = selectPhase7Cases(input);
  const fullSuite = isFullSuite(input);
  if (cases.length === 0) {
    throw new Error("PHASE7_EVAL_REQUIRES_CASES");
  }

  const results: Phase7EvalResult[] = cases.map((testCase) => {
    const outcome = testCase.evaluate();
    return {
      caseKey: testCase.caseKey,
      nodeType: testCase.nodeType,
      caseType: testCase.caseType,
      riskLevel: testCase.riskLevel,
      status: outcome.status,
      observedOutput: outcome.observedOutput,
      failureReason: outcome.failureReason,
    };
  });
  const missingNodeTypes = fullSuite ? missingCriticalNodeTypes() : [];
  const passedCaseCount = results.filter((result) => result.status === "PASSED").length;
  const failedCaseCount =
    results.filter((result) => result.status === "FAILED").length + missingNodeTypes.length;
  const blockedCaseCount = results.filter((result) => result.status === "BLOCKED").length;
  const status: EvalRunStatus = failedCaseCount > 0 || blockedCaseCount > 0 ? "FAILED" : "PASSED";

  return {
    evalBindingRef: PHASE7_EVAL_BINDING_REF,
    targetType: "EVAL_DATASET",
    targetRef: `${PHASE7_DATASET.datasetKey}:v${PHASE7_DATASET.versionNumber}`,
    status,
    totalCaseCount: results.length + missingNodeTypes.length,
    passedCaseCount,
    failedCaseCount,
    blockedCaseCount,
    releaseGatePassed: fullSuite && status === "PASSED",
    evaluationScope: fullSuite ? "FULL" : "PARTIAL",
    missingCriticalNodeTypes: missingNodeTypes,
    results,
  };
}

export async function persistPhase7EvalRun(
  db: PrismaClient,
  input: RunPhase7EvalInput = {},
): Promise<Phase7EvalSummary & { evalRunId: string }> {
  const cases = selectPhase7Cases(input);
  const summary = runPhase7EvalSuite(input);
  const dataset = await db.evalDataset.upsert({
    where: {
      datasetKey_versionNumber: {
        datasetKey: PHASE7_DATASET.datasetKey,
        versionNumber: PHASE7_DATASET.versionNumber,
      },
    },
    update: {
      status: "ACTIVE",
      displayName: PHASE7_DATASET.displayName,
      description: PHASE7_DATASET.description,
      sourceRefs: [...PHASE7_DATASET.sourceRefs],
      requiredForRelease: true,
    },
    create: {
      datasetKey: PHASE7_DATASET.datasetKey,
      versionNumber: PHASE7_DATASET.versionNumber,
      status: "ACTIVE",
      displayName: PHASE7_DATASET.displayName,
      description: PHASE7_DATASET.description,
      sourceRefs: [...PHASE7_DATASET.sourceRefs],
      requiredForRelease: true,
    },
  });
  const persistedCases = await Promise.all(
    cases.map((testCase) =>
      db.evalCase.upsert({
        where: {
          evalBindingRef_caseKey: {
            evalBindingRef: PHASE7_EVAL_BINDING_REF,
            caseKey: testCase.caseKey,
          },
        },
        update: {
          evalDatasetId: dataset.id,
          caseVersion: PHASE7_DATASET.versionNumber,
          caseType: testCase.caseType,
          riskLevel: testCase.riskLevel,
          requiredForRelease: testCase.requiredForRelease,
          inputFixture: toInputJsonObject(testCase.inputFixture),
          expectedOutput: toInputJsonObject(testCase.expectedOutput),
          sourceRefs: testCase.sourceRefs,
        },
        create: {
          evalDatasetId: dataset.id,
          evalBindingRef: PHASE7_EVAL_BINDING_REF,
          caseKey: testCase.caseKey,
          caseVersion: PHASE7_DATASET.versionNumber,
          caseType: testCase.caseType,
          riskLevel: testCase.riskLevel,
          requiredForRelease: testCase.requiredForRelease,
          inputFixture: toInputJsonObject(testCase.inputFixture),
          expectedOutput: toInputJsonObject(testCase.expectedOutput),
          sourceRefs: testCase.sourceRefs,
        },
      }),
    ),
  );
  const evalCaseByKey = new Map(persistedCases.map((testCase) => [testCase.caseKey, testCase]));
  const evalRun = await db.evalRun.create({
    data: {
      evalDatasetId: dataset.id,
      evalDatasetVersion: PHASE7_DATASET.versionNumber,
      evalBindingRef: PHASE7_EVAL_BINDING_REF,
      targetType: summary.targetType,
      targetRef: summary.targetRef,
      promptVersionRef: input.promptVersionRef ?? "controlled_payroll_agent:v1",
      modelVersionRef: input.modelVersionRef ?? "openai_agents_default:v1",
      toolSchemaVersionRef: input.toolSchemaVersionRef ?? "phase7-all-tool-schemas:v1",
      retrievalIndexVersionRef: input.retrievalIndexVersionRef ?? "payroll_policy_references:v1",
      guardrailConfigRef: input.guardrailConfigRef ?? "phase7-guardrails:v1",
      status: "PENDING",
      totalCaseCount: summary.totalCaseCount,
      resultSummary: toInputJsonObject(resultSummary(summary)),
    },
  });
  await db.evalRunResult.createMany({
    data: summary.results.map((result) => {
      const evalCase = evalCaseByKey.get(result.caseKey);
      if (!evalCase) {
        throw new Error(`PHASE7_EVAL_CASE_NOT_PERSISTED:${result.caseKey}`);
      }
      return {
        evalRunId: evalRun.id,
        evalCaseId: evalCase.id,
        status: result.status,
        observedOutput: toInputJsonObject(result.observedOutput),
        failureReason: result.failureReason,
      };
    }),
  });
  await db.evalRun.update({
    where: { id: evalRun.id },
    data: {
      status: summary.status,
      passedCaseCount: summary.passedCaseCount,
      failedCaseCount: summary.failedCaseCount,
      blockedCaseCount: summary.blockedCaseCount,
      completedAt: new Date(),
      resultSummary: toInputJsonObject(resultSummary(summary)),
    },
  });

  return { ...summary, evalRunId: evalRun.id };
}

export function releaseGateMatrix() {
  const byNode = new Map<AgentNodeType, { total: number; guardrail: number; failed: number }>();
  for (const result of runPhase7EvalSuite().results) {
    const current = byNode.get(result.nodeType) ?? { total: 0, guardrail: 0, failed: 0 };
    current.total += 1;
    current.guardrail += result.caseType === "GUARDRAIL" || result.caseType === "PERMISSION" ? 1 : 0;
    current.failed += result.status === "PASSED" ? 0 : 1;
    byNode.set(result.nodeType, current);
  }
  return Array.from(byNode.entries()).map(([nodeType, counts]) => ({
    nodeType,
    ...counts,
    releaseAllowed: counts.total > 0 && counts.failed === 0,
  }));
}

function selectPhase7Cases(input: RunPhase7EvalInput) {
  const caseKeys = new Set(input.caseKeys ?? []);
  const nodeTypes = new Set(input.nodeTypes ?? []);
  return PHASE7_EVAL_CASES.filter((testCase) => {
    if (caseKeys.size > 0 && !caseKeys.has(testCase.caseKey)) {
      return false;
    }
    if (nodeTypes.size > 0 && !nodeTypes.has(testCase.nodeType)) {
      return false;
    }
    return true;
  });
}

function isFullSuite(input: RunPhase7EvalInput) {
  return !input.caseKeys?.length && !input.nodeTypes?.length;
}

function resultSummary(summary: Phase7EvalSummary): JsonObject {
  return {
    releaseGatePassed: summary.releaseGatePassed,
    evaluationScope: summary.evaluationScope,
    evalDatasetVersion: PHASE7_DATASET.versionNumber,
    missingCriticalNodeTypes: summary.missingCriticalNodeTypes,
    failedCases: summary.results
      .filter((result) => result.status !== "PASSED")
      .map((result) => ({
        caseKey: result.caseKey,
        nodeType: result.nodeType,
        failureReason: result.failureReason ?? "EVAL_CASE_FAILED",
      })),
  };
}
