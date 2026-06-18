import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { PermissionDeniedError, type ActorContext } from "@/domain/auth/permissions";
import {
  PayrollRunService,
  PayrollRunServiceError,
  type PayrollRunRecord,
  type PayrollRunStore,
  type RunStatusEventDraft,
} from "@/domain/payroll-runs/run-service";

const deliveryActor: ActorContext = {
  id: "user-delivery",
  email: "delivery@example.local",
  roleCodes: ["DELIVERY_SPECIALIST"],
  authorizedClientIds: ["client-a"],
};

const unauthorizedActor: ActorContext = {
  id: "user-outsider",
  email: "outsider@example.local",
  roleCodes: ["DELIVERY_SPECIALIST"],
  authorizedClientIds: ["client-b"],
};

const payrollLeadActor: ActorContext = {
  id: "user-lead",
  email: "lead@example.local",
  roleCodes: ["PAYROLL_LEAD"],
  authorizedClientIds: ["client-a"],
};

class FakeRunStore implements PayrollRunStore {
  events: RunStatusEventDraft[] = [];
  run: PayrollRunRecord = {
    id: "run-a",
    clientId: "client-a",
    payrollMonth: "2026-06",
    status: "DRAFT",
    blockingIssueCount: 0,
    highRiskIssueCount: 0,
    pendingCustomerConfirmationCount: 0,
    pendingIntakeAssignmentCount: 0,
    pendingProposalReviewCount: 0,
  };

  async findRunById(id: string) {
    return id === this.run.id ? this.run : null;
  }

  async findClientById(id: string) {
    return id === "client-a" ? { id } : null;
  }

  async createRun() {
    return this.run;
  }

  async updateRunStatus(input: {
    runId: string;
    status: PayrollRunRecord["status"];
    statusReason: string;
  }) {
    this.run = { ...this.run, status: input.status, statusReason: input.statusReason };
    return this.run;
  }

  async createStatusEvent(input: RunStatusEventDraft) {
    this.events.push(input);
  }

  async assignRun() {}

  async completeReminder() {
    return { id: "reminder-a", runId: this.run.id, type: "STAGE_ACTION" as const };
  }
}

describe("payroll run service", () => {
  it("creates a draft run with status event and audit log", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new FakeRunStore();
    const service = new PayrollRunService(store, new AuditService(auditStore));

    await service.createRun({
      actor: deliveryActor,
      clientId: "client-a",
      payrollMonth: "2026-06",
    });

    expect(store.events[0]).toMatchObject({ runId: "run-a", toStatus: "DRAFT" });
    expect((await auditStore.listAuditLogs())[0]).toMatchObject({
      action: "PAYROLL_RUN_CREATED",
      objectId: "run-a",
    });
  });

  it("rejects run creation outside the actor client scope", async () => {
    const service = new PayrollRunService(
      new FakeRunStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.createRun({
        actor: unauthorizedActor,
        clientId: "client-a",
        payrollMonth: "2026-06",
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("validates payroll month format before persisting", async () => {
    const service = new PayrollRunService(
      new FakeRunStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.createRun({
        actor: deliveryActor,
        clientId: "client-a",
        payrollMonth: "2026-13",
      }),
    ).rejects.toThrow(PayrollRunServiceError);
  });

  it("does not let delivery users perform R3 transition through the service", async () => {
    const service = new PayrollRunService(
      new FakeRunStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.transitionRun({
        actor: deliveryActor,
        runId: "run-a",
        toStatus: "VOIDED",
        reason: "void run",
      }),
    ).rejects.toThrow("ROLE_MISSING_PERMISSION");
  });

  it("records R3 risk level for high impact service transitions", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const service = new PayrollRunService(new FakeRunStore(), new AuditService(auditStore));

    await service.transitionRun({
      actor: payrollLeadActor,
      runId: "run-a",
      toStatus: "VOIDED",
      reason: "void run",
    });

    expect((await auditStore.listAuditLogs())[0]).toMatchObject({
      action: "PAYROLL_RUN_STATUS_CHANGED",
      riskLevel: "R3",
    });
  });
});
