import { describe, expect, it } from "vitest";
import {
  assertClientActionAllowed,
  canPerformClientAction,
  PermissionDeniedError,
  type ActorContext,
} from "@/domain/auth/permissions";

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

const systemAdminActor: ActorContext = {
  id: "user-admin",
  email: "admin@example.local",
  roleCodes: ["SYSTEM_ADMIN"],
  authorizedClientIds: [],
};

describe("permissions", () => {
  it("does not infer export or approval from client visibility", () => {
    expect(canPerformClientAction(deliveryActor, "viewClient", "client-a")).toBe(true);
    expect(canPerformClientAction(deliveryActor, "downloadExport", "client-a")).toBe(true);
    expect(canPerformClientAction(deliveryActor, "releaseHighRisk", "client-a")).toBe(false);
    expect(canPerformClientAction(deliveryActor, "configureRules", "client-a")).toBe(false);
  });

  it("blocks users from clients outside their authorization scope", () => {
    expect(canPerformClientAction(deliveryActor, "viewEmployee", "client-b")).toBe(false);

    expect(() => assertClientActionAllowed(deliveryActor, "viewEmployee", "client-b")).toThrow(
      PermissionDeniedError,
    );
  });

  it("lets payroll leads release high risk only inside authorized clients", () => {
    expect(canPerformClientAction(payrollLeadActor, "releaseHighRisk", "client-a")).toBe(true);
    expect(canPerformClientAction(payrollLeadActor, "releaseHighRisk", "client-b")).toBe(false);
  });

  it("separates payroll run creation and updates from business approvals", () => {
    expect(canPerformClientAction(deliveryActor, "createPayrollRun", "client-a")).toBe(true);
    expect(canPerformClientAction(deliveryActor, "updatePayrollRun", "client-a")).toBe(true);
    expect(canPerformClientAction(deliveryActor, "lockPayroll", "client-a")).toBe(false);
  });

  it("lets system admins see all clients but rejects business approvals", () => {
    expect(canPerformClientAction(systemAdminActor, "viewClient", "client-x")).toBe(true);
    expect(canPerformClientAction(systemAdminActor, "downloadExport", "client-x")).toBe(true);
    expect(canPerformClientAction(systemAdminActor, "releaseHighRisk", "client-x")).toBe(false);
    expect(canPerformClientAction(systemAdminActor, "lockPayroll", "client-x")).toBe(false);
  });
});
