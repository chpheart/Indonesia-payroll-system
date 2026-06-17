import { afterEach, describe, expect, it, vi } from "vitest";
import { actorFromHeaders, actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";

const findUniqueMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: {
      findUnique: findUniqueMock,
      update: updateMock,
    },
  },
}));

class TestHeaders {
  constructor(private readonly values: Record<string, string>) {}

  get(name: string) {
    return this.values[name] ?? null;
  }
}

afterEach(() => {
  findUniqueMock.mockReset();
  updateMock.mockReset();
  vi.unstubAllEnvs();
  delete process.env.DEV_ACTOR_REGISTRY_JSON;
  delete process.env.DEV_DEFAULT_ACTOR_ID;
});

describe("request actor context", () => {
  it("does not trust caller supplied role or client scope headers", () => {
    const actor = actorFromHeaders(
      new TestHeaders({
        "x-role-codes": "SYSTEM_ADMIN",
        "x-client-ids": "client-b",
        "x-user-email": "attacker@example.local",
      }),
    );

    expect(actor.id).toBe("anonymous");
    expect(actor.roleCodes).toEqual([]);
    expect(actor.authorizedClientIds).toEqual([]);
  });

  it("loads roles and client scopes only from the server-side actor registry", () => {
    process.env.DEV_ACTOR_REGISTRY_JSON = JSON.stringify({
      "demo-lead": {
        email: "lead@example.local",
        roleCodes: ["PAYROLL_LEAD"],
        authorizedClientIds: ["client-a"],
      },
    });

    const actor = actorFromHeaders(new TestHeaders({ "x-user-id": "demo-lead" }));

    expect(actor.email).toBe("lead@example.local");
    expect(actor.roleCodes).toEqual(["PAYROLL_LEAD"]);
    expect(actor.authorizedClientIds).toEqual(["client-a"]);
  });

  it("falls closed when requested actor id is not in the registry", () => {
    process.env.DEV_ACTOR_REGISTRY_JSON = JSON.stringify({
      "demo-admin": {
        email: "admin@example.local",
        roleCodes: ["SYSTEM_ADMIN"],
        authorizedClientIds: [],
      },
    });

    const actor = actorFromHeaders(new TestHeaders({ "x-user-id": "not-real" }));

    expect(actor.id).toBe("anonymous");
    expect(actor.roleCodes).toEqual([]);
  });

  it("ignores development actor headers and defaults in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DEV_DEFAULT_ACTOR_ID = "demo-lead";
    process.env.DEV_ACTOR_REGISTRY_JSON = JSON.stringify({
      "demo-lead": {
        email: "lead@example.local",
        roleCodes: ["PAYROLL_LEAD"],
        authorizedClientIds: ["client-a"],
      },
    });

    const actor = await actorFromHeadersWithDatabase(
      new TestHeaders({ "x-user-id": "demo-lead" }),
    );

    expect(actor.id).toBe("anonymous");
    expect(actor.roleCodes).toEqual([]);
    expect(actor.authorizedClientIds).toEqual([]);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it("prefers database roles and client access over the dev registry", async () => {
    process.env.DEV_ACTOR_REGISTRY_JSON = JSON.stringify({
      "demo-lead": {
        email: "registry@example.local",
        roleCodes: ["PAYROLL_SPECIALIST"],
        authorizedClientIds: ["client-registry"],
      },
    });
    findUniqueMock.mockResolvedValue({
      id: "demo-lead",
      email: "db@example.local",
      status: "ACTIVE",
      userRoles: [{ role: { code: "PAYROLL_LEAD" } }],
      clientAccesses: [{ clientId: "client-db" }],
    });

    const actor = await actorFromHeadersWithDatabase(
      new TestHeaders({ "x-user-id": "demo-lead" }),
    );

    expect(actor.email).toBe("db@example.local");
    expect(actor.roleCodes).toEqual(["PAYROLL_LEAD"]);
    expect(actor.authorizedClientIds).toEqual(["client-db"]);
  });

  it("does not let disabled database users fall back to registry permissions", async () => {
    process.env.DEV_ACTOR_REGISTRY_JSON = JSON.stringify({
      "demo-lead": {
        email: "registry@example.local",
        roleCodes: ["PAYROLL_LEAD"],
        authorizedClientIds: ["client-registry"],
      },
    });
    findUniqueMock.mockResolvedValue({
      id: "demo-lead",
      email: "db@example.local",
      status: "DISABLED",
      userRoles: [{ role: { code: "PAYROLL_LEAD" } }],
      clientAccesses: [{ clientId: "client-db" }],
    });

    const actor = await actorFromHeadersWithDatabase(
      new TestHeaders({ "x-user-id": "demo-lead" }),
    );

    expect(actor.id).toBe("anonymous");
    expect(actor.roleCodes).toEqual([]);
    expect(actor.authorizedClientIds).toEqual([]);
  });

  it("does not create registry-only actors while preparing audit fields", async () => {
    process.env.DEV_ACTOR_REGISTRY_JSON = JSON.stringify({
      "demo-lead": {
        email: "lead@example.local",
        roleCodes: ["PAYROLL_LEAD"],
        authorizedClientIds: ["client-a"],
      },
    });
    findUniqueMock.mockResolvedValue(null);
    const actor = actorFromHeaders(new TestHeaders({ "x-user-id": "demo-lead" }));

    const auditFields = await requestAuditFields(
      actor,
      new TestHeaders({ "user-agent": "vitest", "x-forwarded-for": "127.0.0.1" }),
    );

    expect(auditFields.actorUserId).toBeUndefined();
    expect(auditFields.actorEmail).toBe("lead@example.local");
    expect(auditFields.actorRoleCodes).toEqual(["PAYROLL_LEAD"]);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
