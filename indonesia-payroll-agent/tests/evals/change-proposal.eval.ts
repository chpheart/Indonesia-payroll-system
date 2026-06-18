import { describe, expect, it } from "vitest";
import { runPhase7EvalSuite } from "@/domain/evals/eval-service";

describe("Phase 7 change proposal eval", () => {
  it("extracts Blue Focus changes as candidates only with evidence and month", () => {
    const suite = runPhase7EvalSuite({
      caseKeys: [
        "blue-focus-movement-floating-leave-overtime-adjustment",
        "blue-focus-thr-key-change-evidence",
      ],
    });

    expect(suite.status).toBe("PASSED");
    for (const result of suite.results) {
      expect(result.observedOutput).toMatchObject({
        candidateOnly: true,
        evidenceMissing: false,
        effectiveMonthMissing: false,
        writesLedger: false,
      });
    }
  });

  it("blocks proposal-before-commit violations against ledger, master data, and payroll results", () => {
    const suite = runPhase7EvalSuite({
      caseKeys: ["change-proposal-direct-write-blocked"],
    });

    expect(suite.status).toBe("PASSED");
    expect(suite.results[0]).toMatchObject({
      observedOutput: {
        action: "BLOCK",
        issueCodes: ["PROPOSAL_DIRECT_WRITE_BLOCKED"],
        proposalWriteBlocked: true,
      },
    });
  });

  it("keeps unknown salary component amounts out of silent merge paths", () => {
    const suite = runPhase7EvalSuite({
      caseKeys: ["payroll-component-unknown-not-silent-merge"],
    });

    expect(suite.status).toBe("PASSED");
    expect(suite.results[0]).toMatchObject({
      observedOutput: {
        unknownAmountNeedsReview: true,
        notSilentlyMerged: true,
        manualConfirmationRequired: true,
      },
    });
  });
});
