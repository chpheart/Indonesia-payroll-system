import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { type ActorContext } from "@/domain/auth/permissions";
import {
  FXRateService,
  FXRateServiceError,
  type FXRateStore,
  type FXRateVersionRecord,
} from "@/domain/fx/fx-rate-service";

const ruleAdmin: ActorContext = {
  id: "rule-admin",
  email: "rule-admin@example.local",
  roleCodes: ["RULE_ADMIN"],
  authorizedClientIds: ["client-a"],
};

const payrollLead: ActorContext = {
  id: "payroll-lead",
  email: "lead@example.local",
  roleCodes: ["PAYROLL_LEAD"],
  authorizedClientIds: ["client-a"],
};

class FakeFXRateStore implements FXRateStore {
  rates: FXRateVersionRecord[] = [];

  async findFXRateById(id: string) {
    return this.rates.find((rate) => rate.id === id) ?? null;
  }

  async findLatestFXRateVersion() {
    return this.rates.at(-1) ?? null;
  }

  async findConfirmedFXRate(input: {
    clientId: string;
    payrollMonth: string;
    currencyCode: string;
  }) {
    return (
      this.rates.find(
        (rate) =>
          rate.clientId === input.clientId &&
          rate.payrollMonth === input.payrollMonth &&
          rate.currencyCode === input.currencyCode &&
          rate.status === "CONFIRMED",
      ) ?? null
    );
  }

  async createFXRateDraft(input: Omit<FXRateVersionRecord, "id" | "status">) {
    const fxRate = { ...input, id: `fx-${this.rates.length + 1}`, status: "DRAFT" as const };
    this.rates.push(fxRate);
    return fxRate;
  }

  async confirmFXRateVersion(input: { id: string }) {
    const existing = await this.findFXRateById(input.id);
    if (!existing) {
      throw new Error("FX_RATE_VERSION_NOT_FOUND");
    }
    const confirmed = { ...existing, status: "CONFIRMED" as const };
    this.rates = this.rates.map((rate) => (rate.id === input.id ? confirmed : rate));
    return confirmed;
  }
}

describe("fx rate service", () => {
  it("blocks payroll precheck when a confirmed fx rate is missing", async () => {
    const service = new FXRateService(
      new FakeFXRateStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.assertConfirmedRateForPayroll({
        clientId: "client-a",
        payrollMonth: "2026-06",
        currencyCode: "USD",
      }),
    ).rejects.toThrow("FX_RATE_MISSING_OR_UNCONFIRMED");
  });

  it("requires evidence for employee-level overrides", async () => {
    const service = new FXRateService(
      new FakeFXRateStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.createDraft({
        actor: ruleAdmin,
        clientId: "client-a",
        payrollMonth: "2026-06",
        currencyCode: "usd",
        rate: 16_000,
        evidenceRefs: ["evidence-fx"],
        sourceLabel: "Bank Indonesia",
        changeReason: "monthly FX",
        employeeOverrides: [
          { employeeId: "employee-a", rate: 15_900, evidenceRefs: [], reason: "contract" },
        ],
      }),
    ).rejects.toThrow(FXRateServiceError);
  });

  it("confirms evidenced fx rates and records audit", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new FakeFXRateStore();
    const service = new FXRateService(store, new AuditService(auditStore));
    const draft = await service.createDraft({
      actor: ruleAdmin,
      clientId: "client-a",
      payrollMonth: "2026-06",
      currencyCode: "usd",
      rate: 16_000,
      evidenceRefs: ["evidence-fx"],
      sourceLabel: "Bank Indonesia",
      changeReason: "monthly FX",
    });

    const confirmed = await service.confirmRate({
      actor: payrollLead,
      fxRateVersionId: draft.id,
    });

    expect(confirmed.status).toBe("CONFIRMED");
    expect((await auditStore.listAuditLogs()).at(-1)).toMatchObject({
      action: "FX_RATE_VERSION_CONFIRMED",
      riskLevel: "R2",
    });
  });
});
