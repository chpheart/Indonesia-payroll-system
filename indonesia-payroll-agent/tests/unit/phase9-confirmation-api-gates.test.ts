import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postConfirmationPack } from "@/app/api/payroll-runs/[runId]/customer-confirmation-pack/route";

const packFindUniqueMock = vi.hoisted(() => vi.fn());
const packFindFirstMock = vi.hoisted(() => vi.fn());
const evidenceFindUniqueMock = vi.hoisted(() => vi.fn());
const confirmationCreateMock = vi.hoisted(() => vi.fn());
const evidenceLinkCreateMock = vi.hoisted(() => vi.fn());
const auditCreateMock = vi.hoisted(() => vi.fn());
const packUpdateMock = vi.hoisted(() => vi.fn());
const packItemUpdateManyMock = vi.hoisted(() => vi.fn());
const payrollRunUpdateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) => callback(txMock())));

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

vi.mock("@/app/(app)/payroll-runs/[runId]/phase9-pack-snapshot", () => ({
  loadRunForConfirmationPack: vi.fn(async () => ({
    id: "run-a",
    clientId: "client-a",
    status: "PENDING_CUSTOMER_CONFIRMATION",
    lockedAt: null,
    client: { id: "client-a", code: "ACME", name: "Acme", hasHistoricalPayroll: false },
    changeLedgerEntries: [],
    questionItems: [],
    caseItems: [],
    customerConfirmations: [],
    previousRun: null,
    blockingIssueCount: 0,
    highRiskIssueCount: 0,
    payrollMonth: "2026-06",
    updatedAt: new Date("2026-06-18T00:00:00.000Z"),
    exportedAt: null,
  })),
  packSnapshotFromRun: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $transaction: transactionMock },
}));

beforeEach(() => {
  packFindUniqueMock.mockReset();
  packFindFirstMock.mockReset();
  evidenceFindUniqueMock.mockReset();
  confirmationCreateMock.mockReset();
  evidenceLinkCreateMock.mockReset();
  auditCreateMock.mockReset();
  packUpdateMock.mockReset();
  packItemUpdateManyMock.mockReset();
  payrollRunUpdateMock.mockReset();
  transactionMock.mockClear();
  packFindFirstMock.mockResolvedValue({ status: "PARTIALLY_CONFIRMED" });
  confirmationCreateMock.mockResolvedValue({
    id: "confirmation-a",
    packId: "pack-a",
    clientId: "client-a",
    runId: "run-a",
    coverageScopeType: "MIXED",
  });
});

describe("phase 9 customer confirmation API guardrails", () => {
  it("rejects customer confirmation API backfill with stale evidence", async () => {
    packFindUniqueMock.mockResolvedValue(packDraft());
    evidenceFindUniqueMock.mockResolvedValue({ id: "evidence-a", clientId: "client-a", runId: "run-a", status: "STALE" });

    const response = await postConfirmationPack(
      jsonRequest({
        action: "recordConfirmation",
        packId: "pack-a",
        evidenceId: "evidence-a",
        confirmationText: "确认无误，仅覆盖 salaryAmount",
        coverageScope: { type: "MIXED", runId: "run-a", fields: ["salaryAmount"] },
      }),
      { params: Promise.resolve({ runId: "run-a" }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "CUSTOMER_CONFIRMATION_EVIDENCE_SCOPE_MISMATCH",
    });
  });

  it("rejects customer confirmation API backfill with coverage from another run", async () => {
    packFindUniqueMock.mockResolvedValue(packDraft());

    const response = await postConfirmationPack(
      jsonRequest({
        action: "recordConfirmation",
        packId: "pack-a",
        evidenceId: "evidence-a",
        confirmationText: "确认无误，仅覆盖 salaryAmount",
        coverageScope: { type: "MIXED", runId: "run-b", fields: ["salaryAmount"] },
      }),
      { params: Promise.resolve({ runId: "run-a" }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "CUSTOMER_CONFIRMATION_COVERAGE_SCOPE_MISMATCH",
    });
  });

  it("rejects customer confirmation API backfill when evidence coverage does not cover requested scope", async () => {
    packFindUniqueMock.mockResolvedValue(packDraft());
    evidenceFindUniqueMock.mockResolvedValue({
      id: "evidence-a",
      clientId: "client-a",
      runId: "run-a",
      status: "VALID",
      coverageScope: { type: "MIXED", runId: "run-a", fields: ["bankAccountNumber"] },
    });

    const response = await postConfirmationPack(
      jsonRequest({
        action: "recordConfirmation",
        packId: "pack-a",
        evidenceId: "evidence-a",
        confirmationText: "确认无误，仅覆盖 salaryAmount",
        coverageScope: { type: "MIXED", runId: "run-a", fields: ["salaryAmount"] },
      }),
      { params: Promise.resolve({ runId: "run-a" }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "CUSTOMER_CONFIRMATION_EVIDENCE_COVERAGE_MISMATCH",
    });
  });

  it("records customer confirmation only for displayed pack item coverage and closes matching item", async () => {
    packFindUniqueMock.mockResolvedValue(
      packDraft([
        {
          id: "pack-item-salary",
          category: "MONTHLY_CHANGE",
          status: "OPEN",
          coverageScope: {
            type: "MIXED",
            runId: "run-a",
            employeeIds: ["employee-a"],
            fields: ["salaryAmount"],
          },
        },
        {
          id: "pack-item-npwp",
          category: "MISSING_INFORMATION",
          status: "OPEN",
          coverageScope: { type: "MIXED", runId: "run-a", fields: ["npwp"] },
        },
      ]),
    );
    evidenceFindUniqueMock.mockResolvedValue({
      id: "evidence-a",
      clientId: "client-a",
      runId: "run-a",
      status: "VALID",
      coverageScope: {
        type: "MIXED",
        runId: "run-a",
        employeeIds: ["employee-a"],
        fields: ["salaryAmount"],
      },
    });

    const response = await postConfirmationPack(
      jsonRequest({
        action: "recordConfirmation",
        packId: "pack-a",
        evidenceId: "evidence-a",
        confirmationText: "确认 Dewi salaryAmount",
        confirmedByName: "Ibu Customer",
        coverageScope: {
          type: "MIXED",
          runId: "run-a",
          employeeIds: ["employee-a"],
          fields: ["salaryAmount"],
        },
      }),
      { params: Promise.resolve({ runId: "run-a" }) },
    );

    expect(response.status).toBe(201);
    expect(packItemUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["pack-item-salary"] }, status: "OPEN" },
      data: {
        status: "CONFIRMED",
        handlingReason: "客户回复证据覆盖该确认项",
        editedById: "user-phase9",
      },
    });
    expect(packUpdateMock).toHaveBeenCalledWith({
      where: { id: "pack-a" },
      data: { status: "PARTIALLY_CONFIRMED" },
    });
  });

  it("closes real QuestionItem pack items when sourceObjectRefs are confirmed", async () => {
    packFindUniqueMock.mockResolvedValue(
      packDraft([
        {
          id: "pack-item-question",
          category: "MISSING_INFORMATION",
          status: "OPEN",
          coverageScope: {
            type: "MIXED",
            runId: "run-a",
            fields: ["fxRate"],
            sourceObjectRefs: ["QUESTION_ITEM:question-fx"],
          },
        },
      ]),
    );
    evidenceFindUniqueMock.mockResolvedValue({
      id: "evidence-a",
      clientId: "client-a",
      runId: "run-a",
      status: "VALID",
      coverageScope: {
        type: "MIXED",
        runId: "run-a",
        fields: ["fxRate"],
        sourceObjectRefs: ["QUESTION_ITEM:question-fx"],
      },
    });

    const response = await postConfirmationPack(
      jsonRequest({
        action: "recordConfirmation",
        packId: "pack-a",
        evidenceId: "evidence-a",
        confirmationText: "客户确认 fxRate 问题",
        coverageScope: {
          type: "MIXED",
          runId: "run-a",
          fields: ["fxRate"],
          sourceObjectRefs: ["QUESTION_ITEM:question-fx"],
        },
      }),
      { params: Promise.resolve({ runId: "run-a" }) },
    );

    expect(response.status).toBe(201);
    expect(packItemUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["pack-item-question"] }, status: "OPEN" },
      }),
    );
    expect(packUpdateMock).toHaveBeenCalledWith({
      where: { id: "pack-a" },
      data: { status: "CONFIRMED" },
    });
  });
});

function packDraft(items: Array<Record<string, unknown>> = []) {
  return {
    id: "pack-a", clientId: "client-a", runId: "run-a", status: "DRAFT",
    dataVersionRef: "run:run-a:v1", resultVersionRef: null, exportPreviewVersionRef: null,
    items,
  };
}

function txMock() {
  return {
    customerConfirmationPack: { findUnique: packFindUniqueMock, findFirst: packFindFirstMock, update: packUpdateMock },
    evidence: { findUnique: evidenceFindUniqueMock }, customerConfirmation: { create: confirmationCreateMock, count: vi.fn(async () => 0) },
    evidenceLink: { create: evidenceLinkCreateMock }, auditLog: { create: auditCreateMock }, payrollRun: { update: payrollRunUpdateMock },
    questionItem: { count: vi.fn(async () => 0) },
    customerConfirmationPackItem: { count: vi.fn(async () => 0), updateMany: packItemUpdateManyMock },
  };
}

function jsonRequest(body: unknown) {
  return new NextRequest("http://test.local/api/payroll-runs/run-a/customer-confirmation-pack", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    method: "POST",
  });
}
