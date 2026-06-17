import { describe, expect, it } from "vitest";
import {
  canPerformClientAction,
  type ActorContext,
} from "@/domain/auth/permissions";
import {
  actionRequiredForRunTransition,
  riskLevelForRunTransition,
} from "@/domain/payroll-runs/run-transition-permissions";

const deliveryActor: ActorContext = {
  id: "user-delivery",
  email: "delivery@example.local",
  roleCodes: ["DELIVERY_SPECIALIST"],
  authorizedClientIds: ["client-a"],
};

const payrollLeadActor: ActorContext = {
  id: "user-lead",
  email: "lead@example.local",
  roleCodes: ["PAYROLL_LEAD"],
  authorizedClientIds: ["client-a"],
};

describe("run transition permissions", () => {
  it("requires high impact permissions for R3 transitions", () => {
    expect(actionRequiredForRunTransition("PENDING_PAYROLL_CONFIRMATION", "LOCKED")).toBe(
      "lockPayroll",
    );
    expect(
      actionRequiredForRunTransition(
        "PENDING_HIGH_RISK_RELEASE",
        "PENDING_PAYROLL_CONFIRMATION",
      ),
    ).toBe("releaseHighRisk");
    expect(actionRequiredForRunTransition("LOCKED", "EXPORTED")).toBe("downloadExport");
    expect(actionRequiredForRunTransition("EXPORTED", "ARCHIVED")).toBe("downloadExport");
    expect(actionRequiredForRunTransition("DRAFT", "VOIDED")).toBe("voidPayrollRun");
    expect(actionRequiredForRunTransition("LOCKED", "CORRECTED")).toBe("createCorrectionRun");
  });

  it("does not let delivery specialists perform approval, void, or correction transitions", () => {
    expect(canPerformClientAction(deliveryActor, "releaseHighRisk", "client-a")).toBe(false);
    expect(canPerformClientAction(deliveryActor, "voidPayrollRun", "client-a")).toBe(false);
    expect(canPerformClientAction(deliveryActor, "createCorrectionRun", "client-a")).toBe(false);
  });

  it("lets payroll leads perform high impact run transitions inside authorized clients", () => {
    expect(canPerformClientAction(payrollLeadActor, "releaseHighRisk", "client-a")).toBe(true);
    expect(canPerformClientAction(payrollLeadActor, "voidPayrollRun", "client-a")).toBe(true);
    expect(canPerformClientAction(payrollLeadActor, "createCorrectionRun", "client-a")).toBe(true);
  });

  it("classifies high impact transitions as R3 audit risk", () => {
    expect(riskLevelForRunTransition("LOCKED", "EXPORTED")).toBe("R3");
    expect(riskLevelForRunTransition("DRAFT", "VOIDED")).toBe("R3");
    expect(riskLevelForRunTransition("LOCKED", "CORRECTED")).toBe("R3");
    expect(
      riskLevelForRunTransition("PENDING_HIGH_RISK_RELEASE", "PENDING_PAYROLL_CONFIRMATION"),
    ).toBe("R3");
    expect(riskLevelForRunTransition("DRAFT", "PENDING_MAPPING_CONFIRMATION")).toBe("R2");
  });
});
