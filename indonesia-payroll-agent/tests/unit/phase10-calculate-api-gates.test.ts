import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/payroll-runs/[runId]/calculate/route";

const precheckFindFirstMock = vi.hoisted(() => vi.fn());
const blockingIssueCountMock = vi.hoisted(() => vi.fn());
const payrollRunFindUniqueMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/domain/auth/request-context", () => ({
  actorFromHeadersWithDatabase: vi.fn(async () => ({
    id: "payroll-user",
    email: "payroll@example.local",
    roleCodes: ["PAYROLL_SPECIALIST"],
    authorizedClientIds: ["client-a"],
  })),
}));

vi.mock("@/lib/audit/request-audit-fields", () => ({
  requestAuditFields: vi.fn(async () => ({
    actorUserId: "payroll-user",
    actorEmail: "payroll@example.local",
    actorRoleCodes: ["PAYROLL_SPECIALIST"],
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    payrollRun: { findUnique: payrollRunFindUniqueMock },
    precheckRun: { findFirst: precheckFindFirstMock },
    blockingIssue: { count: blockingIssueCountMock },
    $transaction: transactionMock,
  },
}));

beforeEach(() => {
  precheckFindFirstMock.mockReset();
  blockingIssueCountMock.mockReset();
  payrollRunFindUniqueMock.mockReset();
  transactionMock.mockReset();
  payrollRunFindUniqueMock.mockResolvedValue({ id: "run-a", status: "PENDING_CALCULATION" });
});

describe("phase 10 calculate API gates", () => {
  it("rejects unknown payroll runs before checking precheck state", async () => {
    payrollRunFindUniqueMock.mockResolvedValue(null);

    const response = await POST(request(), { params: Promise.resolve({ runId: "run-a" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "PAYROLL_RUN_NOT_FOUND" });
    expect(precheckFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects calculation outside the pending calculation state", async () => {
    payrollRunFindUniqueMock.mockResolvedValue({
      id: "run-a",
      status: "PENDING_PAYROLL_CONFIRMATION",
    });

    const response = await POST(request(), { params: Promise.resolve({ runId: "run-a" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      errorCode: "PAYROLL_RUN_NOT_READY_FOR_CALCULATION",
    });
    expect(precheckFindFirstMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects formal calculation when precheck has not run", async () => {
    precheckFindFirstMock.mockResolvedValue(null);

    const response = await POST(request(), { params: Promise.resolve({ runId: "run-a" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "PAYROLL_PRECHECK_REQUIRED" });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects formal calculation when any blocking issue is still open", async () => {
    precheckFindFirstMock.mockResolvedValue({ id: "precheck-a", status: "PASSED" });
    blockingIssueCountMock.mockResolvedValue(1);

    const response = await POST(request(), { params: Promise.resolve({ runId: "run-a" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "PAYROLL_BLOCKING_ISSUES_OPEN" });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

function request() {
  return new NextRequest("http://test.local/api/payroll-runs/run-a/calculate", {
    method: "POST",
    headers: { "user-agent": "vitest" },
  });
}
