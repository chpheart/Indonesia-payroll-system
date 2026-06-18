import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { PermissionDeniedError, type ActorContext } from "@/domain/auth/permissions";
import {
  ClientService,
  ClientServiceError,
  type ClientConfigVersionDraft,
  type ClientRecord,
  type ClientStore,
} from "@/domain/clients/client-service";

const systemAdmin: ActorContext = {
  id: "user-admin",
  email: "admin@example.local",
  roleCodes: ["SYSTEM_ADMIN"],
  authorizedClientIds: [],
};

const deliveryActor: ActorContext = {
  id: "user-delivery",
  email: "delivery@example.local",
  roleCodes: ["DELIVERY_SPECIALIST"],
  authorizedClientIds: ["client-a"],
};

const client: ClientRecord = {
  id: "client-a",
  code: "SFC",
  name: "San Fu",
  status: "ACTIVE",
  hasHistoricalPayroll: true,
};

class FakeClientStore implements ClientStore {
  configVersions: ClientConfigVersionDraft[] = [];

  async findClientById(id: string) {
    return id === client.id ? client : null;
  }

  async createClient() {
    return client;
  }

  async disableClient() {
    return { ...client, status: "DISABLED" as const };
  }

  async createConfigVersion(input: ClientConfigVersionDraft) {
    this.configVersions.push(input);
    return input;
  }
}

describe("client service", () => {
  it("allows system admins to create clients and records audit", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const service = new ClientService(new FakeClientStore(), new AuditService(auditStore));

    await service.createClient({
      actor: systemAdmin,
      code: "SFC",
      name: "San Fu",
    });

    expect((await auditStore.listAuditLogs())[0]?.action).toBe("CLIENT_CREATED");
  });

  it("does not let delivery users create clients", async () => {
    const service = new ClientService(
      new FakeClientStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.createClient({ actor: deliveryActor, code: "SFC", name: "San Fu" }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("rejects physical delete for clients with history and records audit", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const service = new ClientService(new FakeClientStore(), new AuditService(auditStore));

    await expect(
      service.assertClientCanBePhysicallyDeleted({ actor: systemAdmin, clientId: client.id }),
    ).rejects.toThrow(ClientServiceError);

    expect((await auditStore.listAuditLogs())[0]?.action).toBe("CLIENT_DELETE_REJECTED");
  });
});
