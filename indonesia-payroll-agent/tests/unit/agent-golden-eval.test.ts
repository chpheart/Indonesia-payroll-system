import { describe, expect, it } from "vitest";
import { toolSchemaEvalTarget, workflowNodeEvalTarget } from "@/domain/agent/eval-gate";
import {
  createGoldenEvalTargetAdapter,
  runAgentGoldenCase,
} from "@/domain/agent/golden-eval-set";
import { fieldMappingNode } from "@/domain/agent/nodes/field-mapping-node";
import { findToolContract } from "@/domain/agent/tool-registry";

describe("agent golden eval governance", () => {
  it("scores business golden fixtures from observed outputs instead of metadata", () => {
    expect(runAgentGoldenCase("sanfu-gross-up-not-net-to-gross")).toMatchObject({
      status: "PASSED",
      observedOutput: { grossMode: "GROSS_UP", forbiddenMisclassificationUsed: false },
    });
    expect(
      runAgentGoldenCase("sanfu-gross-up-not-net-to-gross", {
        rawText: "三福工资方案：按 Net-to-Gross 处理",
      }),
    ).toMatchObject({
      status: "FAILED",
      failureReason: "GOLDEN_CASE_ASSERTION_FAILED:sanfu-gross-up-not-net-to-gross",
    });
    expect(
      runAgentGoldenCase("fx-rate-missing-critical-question", { missingFields: [] }),
    ).toMatchObject({
      status: "FAILED",
      failureReason: "GOLDEN_CASE_ASSERTION_FAILED:fx-rate-missing-critical-question",
    });
  });

  it("fails release golden eval when the target adapter produces bad business output", () => {
    const target = workflowNodeEvalTarget(fieldMappingNode);
    const badAdapter = createGoldenEvalTargetAdapter({
      targetType: "WORKFLOW_NODE",
      targetRef: "FIELD_MAPPING:bad",
      policy: "CANDIDATE_ONLY",
      sourceRefs: ["Product-Spec.md"],
      canGenerateQuestions: false,
      canFallbackWhenNoSource: false,
      canClassifyGrossMode: false,
      canBlockHighRisk: false,
      canMapCriticalFields: false,
      traceIncludesSensitiveData: false,
      previewBeforeWrite: true,
    });
    const result = target.cases
      .find((testCase) => testCase.caseKey === "blue-focus-bpa1-bpmp-critical-field-mapping")
      ?.evaluate(badAdapter);

    expect(result).toMatchObject({
      status: "FAILED",
      failureReason: "GOLDEN_CASE_ASSERTION_FAILED:blue-focus-bpa1-bpmp-critical-field-mapping",
    });
  });

  it("scopes tool schema business golden cases to its allowed workflow nodes", () => {
    const contract = findToolContract("field_mapping_candidate");
    if (!contract) {
      throw new Error("missing test contract");
    }

    const target = toolSchemaEvalTarget({ id: "tool-schema-field-mapping", contract });
    const caseKeys = target.cases.map((testCase) => testCase.caseKey);

    expect(caseKeys).toContain("blue-focus-bpa1-bpmp-critical-field-mapping");
    expect(caseKeys).not.toContain("sanfu-gross-pay-total-missing-details-question");
    expect(caseKeys).not.toContain("sanfu-gross-up-not-net-to-gross");
  });
});
