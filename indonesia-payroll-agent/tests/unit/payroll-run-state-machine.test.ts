import { describe, expect, it } from "vitest";
import {
  assertValidRunTransition,
  RunStateMachineError,
  targetStatusForRunImpact,
} from "@/domain/payroll-runs/run-state-machine";

const clearGates = {
  blockingIssueCount: 0,
  highRiskIssueCount: 0,
  pendingCustomerConfirmationCount: 0,
};

describe("payroll run state machine", () => {
  it("rolls material rule and FX changes back to precheck before calculation", () => {
    expect(targetStatusForRunImpact("PENDING_PAYROLL_CONFIRMATION", "FX_RATE")).toBe(
      "PENDING_PRECHECK",
    );
    expect(targetStatusForRunImpact("PENDING_CALCULATION", "CLIENT_CONFIG")).toBe(
      "PENDING_PRECHECK",
    );
  });

  it("forces locked history to use correction runs instead of direct rollback", () => {
    expect(() => targetStatusForRunImpact("LOCKED", "FX_RATE")).toThrow(
      RunStateMachineError,
    );
    expect(() => targetStatusForRunImpact("ARCHIVED", "EMPLOYEE_MASTER")).toThrow(
      "LOCKED_RUN_REQUIRES_CORRECTION_RUN",
    );
  });

  it("blocks lock when blockers, high risk, or customer confirmations remain", () => {
    expect(() =>
      assertValidRunTransition("PENDING_PAYROLL_CONFIRMATION", "LOCKED", {
        ...clearGates,
        blockingIssueCount: 1,
      }),
    ).toThrow("PAYROLL_RUN_BLOCKERS_MUST_BE_CLEARED");

    expect(() =>
      assertValidRunTransition("PENDING_PAYROLL_CONFIRMATION", "LOCKED", {
        ...clearGates,
        highRiskIssueCount: 1,
      }),
    ).toThrow("PAYROLL_RUN_HIGH_RISK_MUST_BE_RELEASED");

    expect(() =>
      assertValidRunTransition("PENDING_PAYROLL_CONFIRMATION", "LOCKED", {
        ...clearGates,
        pendingCustomerConfirmationCount: 1,
      }),
    ).toThrow("PAYROLL_RUN_CUSTOMER_CONFIRMATION_REQUIRED");
  });

  it("does not allow leaving confirmation and high risk gates with open counts", () => {
    expect(() =>
      assertValidRunTransition("PENDING_CUSTOMER_CONFIRMATION", "PENDING_PRECHECK", {
        ...clearGates,
        pendingCustomerConfirmationCount: 1,
      }),
    ).toThrow("PAYROLL_RUN_CUSTOMER_CONFIRMATION_REQUIRED");

    expect(() =>
      assertValidRunTransition("PENDING_HIGH_RISK_RELEASE", "PENDING_PAYROLL_CONFIRMATION", {
        ...clearGates,
        highRiskIssueCount: 1,
      }),
    ).toThrow("PAYROLL_RUN_HIGH_RISK_MUST_BE_RELEASED");
  });

  it("allows lock only when all gates are clear", () => {
    expect(() =>
      assertValidRunTransition("PENDING_PAYROLL_CONFIRMATION", "LOCKED", clearGates),
    ).not.toThrow();
  });
});
