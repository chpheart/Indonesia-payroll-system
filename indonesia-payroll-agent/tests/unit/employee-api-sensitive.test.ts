import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/employees/route";

const findEmployeeMock = vi.hoisted(() => vi.fn());
const findEmployeesMock = vi.hoisted(() => vi.fn());
const createAuditMock = vi.hoisted(() => vi.fn());

vi.mock("@/domain/auth/request-context", () => ({
  actorFromHeadersWithDatabase: vi.fn(async () => ({
    id: "user-payroll",
    email: "payroll@example.local",
    roleCodes: ["PAYROLL_SPECIALIST"],
    authorizedClientIds: ["client-a"],
  })),
}));

vi.mock("@/lib/audit/request-audit-fields", () => ({
  requestAuditFields: vi.fn(async () => ({
    actorUserId: "user-payroll",
    actorEmail: "payroll@example.local",
    actorRoleCodes: ["PAYROLL_SPECIALIST"],
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    employee: {
      findUnique: findEmployeeMock,
      findMany: findEmployeesMock,
    },
    auditLog: {
      create: createAuditMock,
    },
  },
}));

const employee = {
  id: "employee-a",
  clientId: "client-a",
  employeeCode: "E-001",
  npwp: "091234567890000",
};

function request(url: string) {
  return new NextRequest(url, { headers: { "user-agent": "vitest" } });
}

beforeEach(() => {
  findEmployeeMock.mockReset();
  findEmployeesMock.mockReset();
  createAuditMock.mockReset();
});

describe("employee sensitive API access", () => {
  it("rejects sensitive reveal without explicit confirmation", async () => {
    findEmployeeMock.mockResolvedValue(employee);

    const response = await GET(
      request("http://test.local/api/employees?employeeId=employee-a&revealField=npwp&purpose=payroll%20validation"),
    );
    const body = (await response.json()) as { errorCode: string };

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe("SENSITIVE_REVEAL_CONFIRMATION_REQUIRED");
    expect(createAuditMock).not.toHaveBeenCalled();
  });

  it("returns a sensitive field only after confirmation and audit", async () => {
    findEmployeeMock.mockResolvedValue(employee);

    const response = await GET(
      request(
        "http://test.local/api/employees?employeeId=employee-a&revealField=npwp&purpose=payroll%20validation&confirmed=on",
      ),
    );
    const body = (await response.json()) as { field: string; value: string };

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({ field: "npwp", value: employee.npwp });
    expect(createAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "SENSITIVE_FIELD_REVEALED",
          purpose: "payroll validation",
        }),
      }),
    );
  });
});
