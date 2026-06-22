import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/change-proposals/[proposalId]/route";

const proposalFindUniqueMock = vi.hoisted(() => vi.fn());
const proposalUpdateManyMock = vi.hoisted(() => vi.fn());
const ledgerCreateMock = vi.hoisted(() => vi.fn());
const auditCreateManyMock = vi.hoisted(() => vi.fn());
const customerConfirmationFindManyMock = vi.hoisted(() => vi.fn());
const customerConfirmationUpdateManyMock = vi.hoisted(() => vi.fn());
const customerConfirmationPackUpdateManyMock = vi.hoisted(() => vi.fn());
const customerConfirmationPackFindFirstMock = vi.hoisted(() => vi.fn());
const customerConfirmationPackItemFindManyMock = vi.hoisted(() => vi.fn());
const packItemCountMock = vi.hoisted(() => vi.fn());
const staleConfirmationCountMock = vi.hoisted(() => vi.fn());
const questionCountMock = vi.hoisted(() => vi.fn());
const payrollRunUpdateMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() =>
  vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
    callback({
      changeProposal: { findUnique: proposalFindUniqueMock, updateMany: proposalUpdateManyMock },
      changeLedgerEntry: { create: ledgerCreateMock },
      auditLog: { createMany: auditCreateManyMock },
      customerConfirmation: {
        findMany: customerConfirmationFindManyMock,
        updateMany: customerConfirmationUpdateManyMock,
        count: staleConfirmationCountMock,
      },
      customerConfirmationPack: {
        updateMany: customerConfirmationPackUpdateManyMock,
        findFirst: customerConfirmationPackFindFirstMock,
      },
      customerConfirmationPackItem: {
        findMany: customerConfirmationPackItemFindManyMock,
        count: packItemCountMock,
      },
      questionItem: { count: questionCountMock },
      payrollRun: { update: payrollRunUpdateMock },
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
    changeProposal: { findUnique: proposalFindUniqueMock, updateMany: proposalUpdateManyMock },
    changeLedgerEntry: { create: ledgerCreateMock },
    auditLog: { createMany: auditCreateManyMock },
    customerConfirmation: {
      findMany: customerConfirmationFindManyMock,
      updateMany: customerConfirmationUpdateManyMock,
      count: staleConfirmationCountMock,
    },
    customerConfirmationPack: {
      updateMany: customerConfirmationPackUpdateManyMock,
      findFirst: customerConfirmationPackFindFirstMock,
    },
    customerConfirmationPackItem: {
      findMany: customerConfirmationPackItemFindManyMock,
      count: packItemCountMock,
    },
    questionItem: { count: questionCountMock },
    payrollRun: { update: payrollRunUpdateMock },
  },
}));

function request(body: unknown) {
  return new NextRequest("http://test.local/api/change-proposals/proposal-a", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "user-agent": "vitest" },
    method: "PATCH",
  });
}

function proposal(status = "PENDING_REVIEW") {
  return {
    id: "proposal-a",
    clientId: "client-a",
    runId: "run-a",
    rawInputItemId: "raw-a",
    status,
    proposalType: "SALARY_ADJUSTMENT",
    targetObjectType: "EmployeeMasterVersion",
    targetObjectId: "employee-master-a",
    targetEmployeeId: "employee-a",
    targetField: "salaryAmount",
    previousValue: { amount: 10000000 },
    proposedValue: { amount: 12000000 },
    effectiveFrom: "2026-06",
    effectiveTo: null,
    riskLevel: "R3",
    confidence: "HIGH",
    evidenceRefs: ["evidence:salary"],
    requiredEvidenceRefs: [],
    payrollRun: { clientId: "client-a", status: "PENDING_PROPOSAL_REVIEW", lockedAt: null },
  };
}

beforeEach(() => {
  [
    proposalFindUniqueMock,
    proposalUpdateManyMock,
    ledgerCreateMock,
    auditCreateManyMock,
    customerConfirmationFindManyMock,
    customerConfirmationUpdateManyMock,
    customerConfirmationPackUpdateManyMock,
    customerConfirmationPackFindFirstMock,
    customerConfirmationPackItemFindManyMock,
    packItemCountMock,
    staleConfirmationCountMock,
    questionCountMock,
    payrollRunUpdateMock,
  ].forEach((mock) => mock.mockReset());
  customerConfirmationPackItemFindManyMock.mockResolvedValue([]);
  packItemCountMock.mockResolvedValue(0);
  staleConfirmationCountMock.mockResolvedValue(0);
  questionCountMock.mockResolvedValue(0);
  customerConfirmationPackFindFirstMock.mockResolvedValue({ status: "INVALIDATED" });
  transactionMock.mockClear();
});

describe("change proposal API customer confirmation invalidation", () => {
  it("invalidates matching customer confirmations on approval", async () => {
    proposalFindUniqueMock.mockResolvedValueOnce(proposal()).mockResolvedValueOnce(proposal("APPROVED"));
    proposalUpdateManyMock.mockResolvedValue({ count: 1 });
    ledgerCreateMock.mockResolvedValue({ id: "ledger-a", riskLevel: "R3" });
    customerConfirmationFindManyMock.mockResolvedValue([
      {
        id: "confirmation-a",
        packId: "pack-a",
        status: "VALID",
        coverageScope: {
          type: "MIXED",
          runId: "run-a",
          employeeIds: ["employee-a"],
          fields: ["salaryAmount"],
        },
      },
    ]);

    const response = await PATCH(
      request({ action: "approve", reviewNote: "approve with confirmation invalidation" }),
      { params: Promise.resolve({ proposalId: "proposal-a" }) },
    );

    expect(response.status).toBe(200);
    expect(customerConfirmationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["confirmation-a"] } },
      data: expect.objectContaining({ status: "STALE" }),
    });
    expect(customerConfirmationPackUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["pack-a"] } }),
        data: expect.objectContaining({ status: "INVALIDATED" }),
      }),
    );
    expect(auditCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            action: "CUSTOMER_CONFIRMATION_INVALIDATED",
            objectId: "confirmation-a",
          }),
        ]),
      }),
    );
  });

  it("invalidates active packs when a matching pack item has no confirmation yet", async () => {
    proposalFindUniqueMock.mockResolvedValueOnce(proposal()).mockResolvedValueOnce(proposal("APPROVED"));
    proposalUpdateManyMock.mockResolvedValue({ count: 1 });
    ledgerCreateMock.mockResolvedValue({ id: "ledger-a", riskLevel: "R3" });
    customerConfirmationFindManyMock.mockResolvedValue([]);
    customerConfirmationPackItemFindManyMock.mockResolvedValue([
      {
        packId: "pack-a",
        coverageScope: {
          type: "MIXED",
          runId: "run-a",
          employeeIds: ["employee-a"],
          fields: ["salaryAmount"],
        },
      },
    ]);

    const response = await PATCH(
      request({ action: "approve", reviewNote: "approve with pack invalidation" }),
      { params: Promise.resolve({ proposalId: "proposal-a" }) },
    );

    expect(response.status).toBe(200);
    expect(customerConfirmationUpdateManyMock).not.toHaveBeenCalled();
    expect(customerConfirmationPackUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["pack-a"] } }),
        data: expect.objectContaining({ status: "INVALIDATED" }),
      }),
    );
    expect(auditCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            action: "CUSTOMER_CONFIRMATION_INVALIDATED",
            objectType: "CUSTOMER_CONFIRMATION_PACK",
            objectId: "pack-a",
          }),
        ]),
      }),
    );
  });
});
