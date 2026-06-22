import { describe, expect, it } from "vitest";
import { evaluatePayrollPrecheck, type PrecheckSnapshot } from "@/domain/prechecks/precheck-service";
import { isCriticalStandardField } from "@/domain/standardization/standardization-policy";

describe("phase 10 payroll precheck service", () => {
  it("blocks calculation when required rules, confirmations, and fx rates are missing", () => {
    const result = evaluatePayrollPrecheck(snapshot({
      publishedRuleTypes: ["PPH21", "BPJS"],
      pendingChangeProposalCount: 1,
      unconfirmedStandardizedInputCount: 1,
      requiredFxCurrencies: ["USD"],
      confirmedFxCurrencies: [],
      latestCustomerConfirmationPack: { id: "pack-a", status: "INVALIDATED" },
    }));

    expect(result.status).toBe("BLOCKED");
    expect(result.issues.map((issue) => issue.issueType)).toEqual(
      expect.arrayContaining([
        "RULE_VERSION_MISSING",
        "CHANGE_PROPOSAL_PENDING_REVIEW",
        "STANDARDIZED_INPUT_UNCONFIRMED",
        "CUSTOMER_CONFIRMATION_NOT_CLOSED",
        "FX_RATE_MISSING_OR_UNCONFIRMED",
      ]),
    );
  });

  it("passes when deterministic inputs, rules, ledger, confirmation, and fx are closed", () => {
    const result = evaluatePayrollPrecheck(snapshot());

    expect(result.status).toBe("PASSED");
    expect(result.issues).toHaveLength(0);
    expect(result.gates.every((gate) => gate.status === "PASSED")).toBe(true);
  });

  it("fails closed when net-pay mode inputs appear without Gross Up configuration", () => {
    const result = evaluatePayrollPrecheck(snapshot({
      netPayModeInputCount: 1,
      netPayModeWithoutGrossUpEmployeeCount: 1,
    }));

    expect(result.status).toBe("BLOCKED");
    expect(result.issues.map((issue) => issue.issueType)).toContain(
      "GROSS_UP_MODE_CONFIRMATION_REQUIRED",
    );
  });

  it("fails closed per employee when another employee has Gross Up enabled", () => {
    const result = evaluatePayrollPrecheck(snapshot({
      netPayModeInputCount: 1,
      grossUpOverrideInputCount: 1,
      netPayModeWithoutGrossUpEmployeeCount: 1,
    }));

    expect(result.status).toBe("BLOCKED");
    expect(result.gates.find((gate) => gate.code === "gross_up_mode")?.evidence).toMatchObject({
      netPayModeWithoutGrossUpEmployeeCount: 1,
    });
  });

  it.each(["READY_FOR_CUSTOMER", "PARTIALLY_CONFIRMED"] as const)(
    "fails closed when customer confirmation pack is %s",
    (status) => {
      const result = evaluatePayrollPrecheck(snapshot({
        latestCustomerConfirmationPack: { id: "pack-a", status },
        run: {
          id: "run-a",
          clientId: "client-a",
          payrollMonth: "2026-06",
          status: "PENDING_PRECHECK",
          lockedAt: null,
          pendingCustomerConfirmationCount: 0,
        },
      }));

      expect(result.status).toBe("BLOCKED");
      expect(result.issues.map((issue) => issue.issueType)).toContain(
        "CUSTOMER_CONFIRMATION_NOT_CLOSED",
      );
    },
  );

  it("treats tax and foreign status inputs as critical evidence-bound fields", () => {
    expect(isCriticalStandardField("ptkpStatus")).toBe(true);
    expect(isCriticalStandardField("isForeignEmployee")).toBe(true);
    expect(isCriticalStandardField("bpjsJpExempt")).toBe(true);
  });

  it("fails closed when an employee has no calculable payroll amount input", () => {
    const result = evaluatePayrollPrecheck(snapshot({
      employeeWithoutCalculablePayrollInputCount: 1,
    }));

    expect(result.status).toBe("BLOCKED");
    expect(result.issues.map((issue) => issue.issueType)).toContain(
      "CALCULABLE_PAYROLL_INPUT_REQUIRED",
    );
  });

  it("separates high risk candidates from blocking issues before calculation", () => {
    const result = evaluatePayrollPrecheck(snapshot({
      grossUpEmployeeCount: 1,
      lowConfidenceMappingCount: 1,
    }));

    expect(result.status).toBe("PASSED");
    expect(result.issues).toHaveLength(0);
    expect(result.highRiskIssues.map((issue) => issue.issueType)).toEqual(
      expect.arrayContaining(["GROSS_UP", "LOW_CONFIDENCE_MAPPING"]),
    );
  });
});

function snapshot(overrides: Partial<PrecheckSnapshot> = {}): PrecheckSnapshot {
  return {
    run: {
      id: "run-a",
      clientId: "client-a",
      payrollMonth: "2026-06",
      status: "PENDING_PRECHECK",
      lockedAt: null,
      pendingCustomerConfirmationCount: 0,
    },
    actorCanExecuteCalculation: true,
    publishedRuleTypes: ["PPH21", "BPJS", "THR", "GROSS_UP", "ROUNDING"],
    publishedRuleCount: 5,
    effectiveClientConfigCount: 1,
    clientGrossUpDefault: false,
    pendingChangeProposalCount: 0,
    approvedProposalWithoutLedgerCount: 0,
    confirmedMappingCount: 1,
    confirmedStandardizedInputCount: 2,
    unconfirmedStandardizedInputCount: 0,
    criticalInputEvidenceMissingCount: 0,
    standardizedInputEmployeeMissingCount: 0,
    employeeWithoutCalculablePayrollInputCount: 0,
    netPayModeInputCount: 0,
    grossUpOverrideInputCount: 0,
    netPayModeWithoutGrossUpEmployeeCount: 0,
    requiredFxCurrencies: [],
    confirmedFxCurrencies: [],
    unconfirmedFxCurrencies: [],
    latestCustomerConfirmationPack: { id: "pack-a", status: "CONFIRMED" },
    openBlockingIssueCount: 0,
    ...overrides,
  };
}
