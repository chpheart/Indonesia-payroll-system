import { describe, expect, it } from "vitest";
import {
  assertRegressionGate,
  assertRuleCanRecordRegression,
  regressionStatusFor,
} from "@/domain/rules/rule-gates";

describe("rule gates", () => {
  it("derives regression status from employee counts and IDR diff thresholds", () => {
    expect(
      regressionStatusFor({
        expectedEmployeeCount: 10,
        actualEmployeeCount: 10,
        maxDiffIdr: 1_000,
      }),
    ).toBe("PASSED");
    expect(
      regressionStatusFor({
        expectedEmployeeCount: 10,
        actualEmployeeCount: 10,
        maxDiffIdr: 1_001,
      }),
    ).toBe("WARNING");
    expect(
      regressionStatusFor({
        expectedEmployeeCount: 10,
        actualEmployeeCount: 9,
        maxDiffIdr: 0,
      }),
    ).toBe("BLOCKED");
    expect(
      regressionStatusFor({
        expectedEmployeeCount: 10,
        actualEmployeeCount: 10,
        maxDiffIdr: 10_001,
      }),
    ).toBe("BLOCKED");
  });

  it("requires both blue focus and sanfu regression datasets", () => {
    expect(() =>
      assertRegressionGate([
        {
          datasetCode: "BLUE_FOCUS",
          status: "PASSED",
          maxDiffIdr: 0,
          blockingThresholdIdr: 10_000,
        },
      ]),
    ).toThrow("REQUIRED_REGRESSION_DATASET_MISSING");
  });

  it("blocks publish when any regression failed or exceeds the blocking threshold", () => {
    expect(() =>
      assertRegressionGate([
        {
          datasetCode: "BLUE_FOCUS",
          status: "PASSED",
          maxDiffIdr: 0,
          blockingThresholdIdr: 10_000,
        },
        {
          datasetCode: "SANFU",
          status: "PASSED",
          maxDiffIdr: 10_001,
          blockingThresholdIdr: 10_000,
        },
      ]),
    ).toThrow("RULE_REGRESSION_BLOCKED_PUBLISH");
  });

  it("does not allow published rule regression evidence to be overwritten", () => {
    expect(() => assertRuleCanRecordRegression("PUBLISHED")).toThrow(
      "PUBLISHED_RULE_REGRESSION_IS_IMMUTABLE",
    );
    expect(() => assertRuleCanRecordRegression("APPROVED")).not.toThrow();
  });
});
