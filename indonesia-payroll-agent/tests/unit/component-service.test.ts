import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { PermissionDeniedError, type ActorContext } from "@/domain/auth/permissions";
import {
  ComponentService,
  ComponentServiceError,
  type ClientComponentAliasRecord,
  type ComponentStore,
  type PayrollComponentRecord,
} from "@/domain/components/component-service";

const ruleAdmin: ActorContext = {
  id: "rule-admin",
  email: "rule-admin@example.local",
  roleCodes: ["RULE_ADMIN"],
  authorizedClientIds: ["client-a"],
};

const deliveryActor: ActorContext = {
  id: "delivery",
  email: "delivery@example.local",
  roleCodes: ["DELIVERY_SPECIALIST"],
  authorizedClientIds: ["client-a"],
};

const component: PayrollComponentRecord = {
  id: "component-gross",
  code: "GROSS",
  name: "Gross Salary",
  componentType: "EARNING",
  taxableCash: true,
  bpjsHealthBase: false,
  bpjsEmploymentBase: false,
  paidOut: true,
  affectsNetPay: true,
  affectsEmployerCost: false,
  status: "ACTIVE",
};

class FakeComponentStore implements ComponentStore {
  aliases: ClientComponentAliasRecord[] = [];
  components = new Map([[component.id, component]]);

  async findPayrollComponentById(id: string) {
    return this.components.get(id) ?? null;
  }

  async findPayrollComponentByCode(code: string) {
    return Array.from(this.components.values()).find((item) => item.code === code) ?? null;
  }

  async createPayrollComponent(input: Omit<PayrollComponentRecord, "id" | "status">) {
    const created = { ...input, id: "component-new", status: "ACTIVE" as const };
    this.components.set(created.id, created);
    return created;
  }

  async findLatestAliasVersion() {
    return this.aliases.at(-1) ?? null;
  }

  async createAliasVersion(input: Omit<ClientComponentAliasRecord, "id" | "status">) {
    const alias = { ...input, id: `alias-${this.aliases.length + 1}`, status: "DRAFT" as const };
    this.aliases.push(alias);
    return alias;
  }
}

describe("component service", () => {
  it("rejects component dictionary edits without rule configuration permission", async () => {
    const service = new ComponentService(
      new FakeComponentStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.createPayrollComponent({
        actor: deliveryActor,
        code: "BONUS",
        name: "Bonus",
        componentType: "EARNING",
        attributes: component,
      }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("does not let client aliases override standard component attributes", async () => {
    const service = new ComponentService(
      new FakeComponentStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.createClientAliasVersion({
        actor: ruleAdmin,
        clientId: "client-a",
        componentId: component.id,
        sourceLabel: "税后工资",
        effectiveMonth: "2026-06",
        evidenceRefs: [],
        changeReason: "客户字段映射",
        attemptedAttributeOverrides: { taxableCash: false },
      }),
    ).rejects.toThrow(ComponentServiceError);
  });

  it("creates alias drafts as mapping suggestions and records audit", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const service = new ComponentService(new FakeComponentStore(), new AuditService(auditStore));

    const alias = await service.createClientAliasVersion({
      actor: ruleAdmin,
      clientId: "client-a",
      componentId: component.id,
      sourceLabel: "Gaji Pokok",
      effectiveMonth: "2026-06",
      evidenceRefs: ["evidence-1"],
      changeReason: "客户模板字段",
    });

    expect(alias).toMatchObject({ status: "DRAFT", normalizedLabel: "gaji pokok" });
    expect((await auditStore.listAuditLogs())[0]).toMatchObject({
      action: "CLIENT_COMPONENT_ALIAS_VERSION_CREATED",
      riskLevel: "R2",
    });
  });
});
