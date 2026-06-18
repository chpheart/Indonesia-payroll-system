import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/clients/[clientId]/route";
import { POST as createConfigVersion } from "@/app/api/clients/[clientId]/config-versions/route";

const clientFindUniqueMock = vi.hoisted(() => vi.fn());
const clientUpdateMock = vi.hoisted(() => vi.fn());
const configFindFirstMock = vi.hoisted(() => vi.fn());
const configCreateMock = vi.hoisted(() => vi.fn());
const auditCreateMock = vi.hoisted(() => vi.fn());

vi.mock("@/domain/auth/request-context", () => ({
  actorFromHeadersWithDatabase: vi.fn(async () => ({
    id: "user-admin",
    email: "admin@example.local",
    roleCodes: ["SYSTEM_ADMIN"],
    authorizedClientIds: [],
  })),
}));

vi.mock("@/lib/audit/request-audit-fields", () => ({
  requestAuditFields: vi.fn(async () => ({
    actorUserId: "user-admin",
    actorEmail: "admin@example.local",
    actorRoleCodes: ["SYSTEM_ADMIN"],
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    client: {
      findUnique: clientFindUniqueMock,
      update: clientUpdateMock,
    },
    clientConfigVersion: {
      findFirst: configFindFirstMock,
      create: configCreateMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
  },
}));

function request(url: string, body: unknown) {
  return new NextRequest(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest",
    },
    method: "POST",
  });
}

const context = { params: Promise.resolve({ clientId: "client-a" }) };

beforeEach(() => {
  clientFindUniqueMock.mockReset();
  clientUpdateMock.mockReset();
  configFindFirstMock.mockReset();
  configCreateMock.mockReset();
  auditCreateMock.mockReset();
});

describe("client API audit behavior", () => {
  it("records audit when a client is re-enabled", async () => {
    clientFindUniqueMock.mockResolvedValue({
      id: "client-a",
      code: "SFC",
      status: "DISABLED",
    });
    clientUpdateMock.mockResolvedValue({
      id: "client-a",
      code: "SFC",
      status: "ACTIVE",
    });

    const response = await PATCH(
      request("http://test.local/api/clients/client-a", { status: "ACTIVE" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(auditCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "CLIENT_ENABLED",
          actorUserId: "user-admin",
          metadata: expect.objectContaining({
            fromStatus: "DISABLED",
            toStatus: "ACTIVE",
          }),
        }),
      }),
    );
  });

  it("stores creator on client config draft versions", async () => {
    clientFindUniqueMock.mockResolvedValue({ id: "client-a" });
    configFindFirstMock.mockResolvedValue({ versionNumber: 2 });
    configCreateMock.mockImplementation(async ({ data }) => ({ id: "config-v3", ...data }));

    const response = await createConfigVersion(
      request("http://test.local/api/clients/client-a/config-versions", {
        effectiveMonth: "2026-06",
        grossUpDefault: false,
        changeReason: "Monthly setup",
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(configCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createdById: "user-admin",
          status: "DRAFT",
          versionNumber: 3,
        }),
      }),
    );
  });
});
