import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postEvidence } from "@/app/api/evidence/route";
import { assertEvidenceCreateScope } from "@/app/api/evidence/route-guards";

const payrollRunFindUniqueMock = vi.hoisted(() => vi.fn());
const rawInputFindUniqueMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

vi.mock("@/domain/auth/request-context", () => ({
  actorFromHeadersWithDatabase: vi.fn(async () => ({
    id: "user-phase9",
    email: "phase9@example.local",
    roleCodes: ["DELIVERY_SPECIALIST"],
    authorizedClientIds: ["client-a"],
  })),
}));

vi.mock("@/lib/audit/request-audit-fields", () => ({
  requestAuditFields: vi.fn(async () => ({
    actorUserId: "user-phase9",
    actorEmail: "phase9@example.local",
    actorRoleCodes: ["DELIVERY_SPECIALIST"],
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  })),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    $transaction: transactionMock,
    payrollRun: { findUnique: payrollRunFindUniqueMock },
    client: { findUnique: vi.fn() },
    employee: { findUnique: vi.fn() },
    employeeMasterVersion: { findUnique: vi.fn() },
    rawInputItem: { findUnique: rawInputFindUniqueMock },
    uploadedFileVersion: { findUnique: vi.fn() },
    workbookCell: { findUnique: vi.fn() },
    changeProposal: { findUnique: vi.fn() },
    changeLedgerEntry: { findUnique: vi.fn() },
    questionItem: { findUnique: vi.fn() },
    customerConfirmationPack: { findUnique: vi.fn() },
    customerConfirmationPackItem: { findUnique: vi.fn() },
    customerConfirmation: { findUnique: vi.fn() },
    fieldMappingVersion: { findUnique: vi.fn() },
    standardizedPayrollInput: { findUnique: vi.fn() },
    ruleVersion: { findUnique: vi.fn() },
    fXRateVersion: { findUnique: vi.fn() },
    caseItem: { findUnique: vi.fn() },
  },
}));

const run = {
  id: "run-a",
  clientId: "client-a",
  payrollMonth: "2026-06",
  status: "PENDING_CUSTOMER_CONFIRMATION",
  lockedAt: null,
};

beforeEach(() => {
  payrollRunFindUniqueMock.mockReset();
  rawInputFindUniqueMock.mockReset();
  transactionMock.mockReset();
  payrollRunFindUniqueMock.mockResolvedValue(run);
});

describe("phase 9 evidence API guardrails", () => {
  it("rejects evidence created without explicit coverage", async () => {
    const response = await postEvidence(
      jsonRequest("http://test.local/api/evidence", {
        clientId: "client-a",
        runId: "run-a",
        kind: "WECHAT_TEXT",
        sourceChannel: "WECHAT_TEXT",
        sourceLabel: "客户回复",
        contentText: "确认无误",
        coverageScope: { type: "MIXED", runId: "run-a" },
        links: [
          {
            clientId: "client-a",
            runId: "run-a",
            objectType: "PAYROLL_RUN",
            objectId: "run-a",
            coverageScope: { type: "MIXED", runId: "run-a", fields: ["salaryAmount"] },
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "CONFIRMATION_COVERAGE_SCOPE_REQUIRED",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects evidence links outside the evidence client and run", async () => {
    const response = await postEvidence(
      jsonRequest("http://test.local/api/evidence", {
        clientId: "client-a",
        runId: "run-a",
        kind: "WECHAT_TEXT",
        sourceChannel: "WECHAT_TEXT",
        sourceLabel: "客户回复",
        contentText: "确认 salaryAmount",
        coverageScope: { type: "MIXED", runId: "run-a", fields: ["salaryAmount"] },
        links: [
          {
            clientId: "client-b",
            runId: "run-b",
            objectType: "PAYROLL_RUN",
            objectId: "run-b",
            coverageScope: { type: "MIXED", runId: "run-b", fields: ["salaryAmount"] },
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "EVIDENCE_LINK_SCOPE_MISMATCH",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects evidence direct raw input provenance outside the evidence run", async () => {
    rawInputFindUniqueMock.mockResolvedValue({ clientId: "client-a", runId: "run-b" });

    const response = await postEvidence(
      jsonRequest("http://test.local/api/evidence", {
        clientId: "client-a",
        runId: "run-a",
        rawInputItemId: "raw-input-run-b",
        kind: "WECHAT_TEXT",
        sourceChannel: "WECHAT_TEXT",
        sourceLabel: "客户回复",
        contentText: "确认 salaryAmount",
        coverageScope: { type: "MIXED", runId: "run-a", fields: ["salaryAmount"] },
        links: [
          {
            clientId: "client-a",
            runId: "run-a",
            objectType: "PAYROLL_RUN",
            objectId: "run-a",
            coverageScope: { type: "MIXED", runId: "run-a", fields: ["salaryAmount"] },
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "EVIDENCE_PROVENANCE_SCOPE_MISMATCH",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("accepts EmployeeMasterVersion evidence links only after client scope verification", async () => {
    const employeeMasterVersionFindUniqueMock = vi.fn(async () => ({
      employeeId: "employee-a",
      employee: { clientId: "client-a" },
    }));

    await expect(
      assertEvidenceCreateScope({
        db: {
          employeeMasterVersion: { findUnique: employeeMasterVersionFindUniqueMock },
        } as never,
        clientId: "client-a",
        runId: "run-a",
        coverageScope: {
          type: "MIXED",
          runId: "run-a",
          employeeIds: ["employee-a"],
          fields: ["bankAccountNumber"],
        },
        links: [
          {
            clientId: "client-a",
            runId: "run-a",
            objectType: "EMPLOYEE_MASTER_VERSION",
            objectId: "employee-master-version-a",
            coverageScope: {
              type: "MIXED",
              runId: "run-a",
              employeeIds: ["employee-a"],
              fields: ["bankAccountNumber"],
            },
          },
        ],
      }),
    ).resolves.toBeUndefined();
    expect(employeeMasterVersionFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "employee-master-version-a" },
      select: { employeeId: true, employee: { select: { clientId: true } } },
    });
  });

  it("rejects EmployeeMasterVersion evidence links whose coverage names another employee", async () => {
    const employeeMasterVersionFindUniqueMock = vi.fn(async () => ({
      employeeId: "employee-b",
      employee: { clientId: "client-a" },
    }));

    await expect(
      assertEvidenceCreateScope({
        db: {
          employeeMasterVersion: { findUnique: employeeMasterVersionFindUniqueMock },
        } as never,
        clientId: "client-a",
        runId: "run-a",
        coverageScope: { type: "MIXED", runId: "run-a", employeeIds: ["employee-a"], fields: ["bankAccountNumber"] },
        links: [
          {
            clientId: "client-a",
            runId: "run-a",
            objectType: "EMPLOYEE_MASTER_VERSION",
            objectId: "employee-master-version-b",
            coverageScope: { type: "MIXED", runId: "run-a", employeeIds: ["employee-a"], fields: ["bankAccountNumber"] },
          },
        ],
      }),
    ).rejects.toThrow("EVIDENCE_LINK_EMPLOYEE_SCOPE_MISMATCH");
  });
});

function jsonRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest",
    },
    method: "POST",
  });
}
