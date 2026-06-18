import { describe, expect, it } from "vitest";
import { releaseGateMatrix, runPhase7EvalSuite } from "@/domain/evals/eval-service";

describe("Phase 7 customer confirmation pack eval", () => {
  it("requires confirmation packs to preserve every critical category", () => {
    const suite = runPhase7EvalSuite({
      caseKeys: [
        "customer-confirmation-pack-omits-no-critical-items",
        "customer-confirmation-critical-omission-blocked",
      ],
    });

    expect(suite.status).toBe("PASSED");
    expect(resultFor(suite, "customer-confirmation-pack-omits-no-critical-items")).toMatchObject({
      observedOutput: { omittedCriticalItems: [], sendRequiresHuman: true },
    });
    expect(resultFor(suite, "customer-confirmation-critical-omission-blocked")).toMatchObject({
      observedOutput: {
        action: "BLOCK",
        issueCodes: ["CONFIRMATION_PACK_CRITICAL_OMISSION"],
      },
    });
  });

  it("requires RAG fallback, summary integrity, and every workflow node release gate", () => {
    const suite = runPhase7EvalSuite();
    const matrix = releaseGateMatrix();

    expect(resultFor(suite, "rag-reconciliation-citation-required")).toMatchObject({
      observedOutput: {
        answer: "不确定/需人工确认",
        fabricatedCitation: false,
      },
    });
    expect(resultFor(suite, "confirmation-summary-critical-exceptions-preserved")).toMatchObject({
      observedOutput: {
        omittedCriticalItems: [],
        summaryDoesNotChangeResults: true,
      },
    });
    expect(suite.releaseGatePassed).toBe(true);
    expect(suite.evaluationScope).toBe("FULL");
    expect(suite.missingCriticalNodeTypes).toEqual([]);
    expect(matrix.every((node) => node.releaseAllowed)).toBe(true);
  });
});

function resultFor(suite: ReturnType<typeof runPhase7EvalSuite>, caseKey: string) {
  const result = suite.results.find((item) => item.caseKey === caseKey);
  if (!result) {
    throw new Error(`missing eval result ${caseKey}`);
  }
  return result;
}
