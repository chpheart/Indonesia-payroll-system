import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/standardized-inputs/route";

const inputFindUniqueMock = vi.hoisted(() => vi.fn());
const inputUpdateManyMock = vi.hoisted(() => vi.fn());
const mappingFindUniqueMock = vi.hoisted(() => vi.fn());
const matchFindUniqueMock = vi.hoisted(() => vi.fn());
const auditCreateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() =>
  vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
    callback({
      standardizedPayrollInput: {
        findUnique: inputFindUniqueMock,
        updateMany: inputUpdateManyMock,
      },
      auditLog: {
        create: auditCreateMock,
      },
    }),
  ),
);

vi.mock("@/domain/auth/request-context", () => ({
  actorFromHeadersWithDatabase: vi.fn(async () => ({
    id: "user-delivery",
    email: "delivery@example.local",
    roleCodes: ["DELIVERY_SPECIALIST"],
    authorizedClientIds: ["client-a"],
  })),
}));

vi.mock("@/lib/audit/request-audit-fields", () => ({
  requestAuditFields: vi.fn(async () => ({
    actorUserId: "user-delivery",
    actorEmail: "delivery@example.local",
    actorRoleCodes: ["DELIVERY_SPECIALIST"],
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: transactionMock,
    standardizedPayrollInput: {
      findUnique: inputFindUniqueMock,
      updateMany: inputUpdateManyMock,
    },
    fieldMappingVersion: {
      findUnique: mappingFindUniqueMock,
    },
    employeeMatchCandidate: {
      findUnique: matchFindUniqueMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
  },
}));

function request(body: unknown) {
  return new NextRequest("http://test.local/api/standardized-inputs", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest",
    },
    method: "POST",
  });
}

beforeEach(() => {
  inputFindUniqueMock.mockReset();
  inputUpdateManyMock.mockReset();
  mappingFindUniqueMock.mockReset();
  matchFindUniqueMock.mockReset();
  auditCreateMock.mockReset();
  transactionMock.mockClear();
});

describe("standardized input API review gates", () => {
  it("rejects confirming an already confirmed standardized input", async () => {
    inputFindUniqueMock.mockResolvedValue({
      id: "input-a",
      clientId: "client-a",
      runId: "run-a",
      status: "CONFIRMED",
      optimisticLockVersion: 2,
      standardField: "grossSalaryAmount",
      evidenceStatus: "VALID",
      evidenceRefs: ["evidence:gross"],
      value: { amount: 12000000 },
      amount: 12000000,
      fieldMappingVersionId: "mapping-a",
      employeeMatchCandidateId: "match-a",
      payrollRun: { clientId: "client-a", status: "PENDING_STANDARDIZATION", lockedAt: null },
    });

    const response = await POST(
      request({
        action: "confirm",
        inputId: "input-a",
        expectedLockVersion: 2,
        amount: 999,
      }),
    );
    const body = (await response.json()) as { errorCode: string };

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe("STANDARDIZED_INPUT_NOT_REVIEWABLE");
    expect(inputUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects stale concurrent confirmation when atomic update affects no rows", async () => {
    inputFindUniqueMock.mockResolvedValue({
      id: "input-a",
      clientId: "client-a",
      runId: "run-a",
      status: "PREVIEW",
      optimisticLockVersion: 1,
      standardField: "grossSalaryAmount",
      evidenceStatus: "VALID",
      evidenceRefs: ["evidence:gross"],
      value: { amount: 12000000 },
      amount: 12000000,
      fieldMappingVersionId: "mapping-a",
      employeeMatchCandidateId: "match-a",
      payrollRun: { clientId: "client-a", status: "PENDING_STANDARDIZATION", lockedAt: null },
    });
    mappingFindUniqueMock.mockResolvedValue({
      id: "mapping-a",
      clientId: "client-a",
      runId: "run-a",
      status: "CONFIRMED",
      confidence: "HIGH",
    });
    matchFindUniqueMock.mockResolvedValue({
      id: "match-a",
      clientId: "client-a",
      runId: "run-a",
      status: "CONFIRMED",
      employeeId: "emp-a",
    });
    inputUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await POST(
      request({
        action: "confirm",
        inputId: "input-a",
        expectedLockVersion: 1,
        amount: 999,
      }),
    );
    const body = (await response.json()) as { errorCode: string };

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe("STANDARDIZED_INPUT_STALE_VERSION");
    expect(inputUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "input-a",
          optimisticLockVersion: 1,
          status: { in: ["PREVIEW", "BLOCKED"] },
        }),
      }),
    );
    expect(auditCreateMock).not.toHaveBeenCalled();
  });
});
