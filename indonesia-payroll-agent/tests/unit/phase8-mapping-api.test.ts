import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mappings/route";

const candidateFindUniqueMock = vi.hoisted(() => vi.fn());
const candidateUpdateManyMock = vi.hoisted(() => vi.fn());
const candidateFindUniqueTxMock = vi.hoisted(() => vi.fn());
const versionAggregateMock = vi.hoisted(() => vi.fn());
const versionCreateMock = vi.hoisted(() => vi.fn());
const auditCreateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() =>
  vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
    callback({
      fieldMappingCandidate: {
        updateMany: candidateUpdateManyMock,
        findUnique: candidateFindUniqueTxMock,
      },
      fieldMappingVersion: {
        aggregate: versionAggregateMock,
        create: versionCreateMock,
      },
      auditLog: {
        create: auditCreateMock,
      },
    }),
  ),
);

vi.mock("@/domain/auth/request-context", () => ({
  actorFromHeadersWithDatabase: vi.fn(async () => ({
    id: "user-reviewer",
    email: "reviewer@example.local",
    roleCodes: ["DELIVERY_SPECIALIST"],
    authorizedClientIds: ["client-a"],
  })),
}));

vi.mock("@/lib/audit/request-audit-fields", () => ({
  requestAuditFields: vi.fn(async () => ({
    actorUserId: "user-reviewer",
    actorEmail: "reviewer@example.local",
    actorRoleCodes: ["DELIVERY_SPECIALIST"],
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: transactionMock,
    fieldMappingCandidate: {
      findUnique: candidateFindUniqueMock,
    },
  },
}));

function request(body: unknown) {
  return new NextRequest("http://test.local/api/mappings", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest",
    },
    method: "POST",
  });
}

function candidate() {
  return {
    id: "mapping-candidate-a",
    clientId: "client-a",
    runId: "run-a",
    fileVersionId: "file-a",
    sheetId: "sheet-a",
    sourceSheetName: "门店工资",
    sourceColumnLabel: "Gross",
    sourceColumnIndex: 2,
    targetField: "grossSalaryAmount",
    fieldCategory: "INPUT",
    confidence: "HIGH",
    rationale: "表头和样例匹配 gross salary",
    evidenceRefs: ["evidence:gross"],
    status: "CANDIDATE",
    payrollRun: { clientId: "client-a", status: "PENDING_MAPPING_CONFIRMATION", lockedAt: null },
  };
}

beforeEach(() => {
  candidateFindUniqueMock.mockReset();
  candidateUpdateManyMock.mockReset();
  candidateFindUniqueTxMock.mockReset();
  versionAggregateMock.mockReset();
  versionCreateMock.mockReset();
  auditCreateMock.mockReset();
  transactionMock.mockClear();
});

describe("mapping API review gates", () => {
  it("rejects stale candidate confirmation before creating a version or audit", async () => {
    candidateFindUniqueMock.mockResolvedValue(candidate());
    candidateUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await POST(
      request({
        action: "confirmCandidate",
        candidateId: "mapping-candidate-a",
        targetField: "grossSalaryAmount",
        confidence: "HIGH",
        rationale: "manual confirmation",
      }),
    );
    const body = (await response.json()) as { errorCode: string };

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe("FIELD_MAPPING_CANDIDATE_NOT_REVIEWABLE");
    expect(candidateUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "mapping-candidate-a", status: "CANDIDATE" },
      data: { status: "CONFIRMED" },
    });
    expect(versionCreateMock).not.toHaveBeenCalled();
    expect(auditCreateMock).not.toHaveBeenCalled();
  });
});
