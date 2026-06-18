import { describe, expect, it } from "vitest";
import { runPhase7EvalSuite } from "@/domain/evals/eval-service";

describe("Phase 8 change mapping critical evals", () => {
  it("keeps proposal, field mapping, and employee matching nodes behind human gates", () => {
    const suite = runPhase7EvalSuite({
      caseKeys: [
        "change-proposal-direct-write-blocked",
        "blue-focus-bpa1-bpmp-critical-field-mapping",
        "employee-conflict-no-auto-confirm",
      ],
    });

    expect(suite.status).toBe("PASSED");
    expect(suite.results.map((result) => result.caseKey)).toEqual([
      "blue-focus-bpa1-bpmp-critical-field-mapping",
      "employee-conflict-no-auto-confirm",
      "change-proposal-direct-write-blocked",
    ]);
  });
});
