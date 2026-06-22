import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/change-proposals/[proposalId]/route";

const proposalFindUniqueMock = vi.hoisted(() => vi.fn());
const proposalFindManyMock = vi.hoisted(() => vi.fn());
const proposalUpdateManyMock = vi.hoisted(() => vi.fn());
const ledgerCreateMock = vi.hoisted(() => vi.fn());
const auditCreateManyMock = vi.hoisted(() => vi.fn());
const auditCreateMock = vi.hoisted(() => vi.fn());
const caseItemCreateMock = vi.hoisted(() => vi.fn());
const rawInputUpdateManyMock = vi.hoisted(() => vi.fn());
const payrollRunUpdateMock = vi.hoisted(() => vi.fn());
const customerConfirmationFindManyMock = vi.hoisted(() => vi.fn());
const customerConfirmationUpdateManyMock = vi.hoisted(() => vi.fn());
const customerConfirmationPackUpdateManyMock = vi.hoisted(() => vi.fn());
const customerConfirmationPackItemFindManyMock = vi.hoisted(() => vi.fn());
const questionCountMock = vi.hoisted(() => vi.fn());
const packItemCountMock = vi.hoisted(() => vi.fn());
const staleConfirmationCountMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() =>
  vi.fn(async (callback: (tx: Record<string, unknown>) => Promise<unknown>) =>
    callback({
      changeProposal: {
        findUnique: proposalFindUniqueMock,
        findMany: proposalFindManyMock,
        updateMany: proposalUpdateManyMock,
      },
      changeLedgerEntry: {
        create: ledgerCreateMock,
      },
      auditLog: {
        create: auditCreateMock,
        createMany: auditCreateManyMock,
      },
      caseItem: {
        create: caseItemCreateMock,
      },
      rawInputItem: {
        updateMany: rawInputUpdateManyMock,
      },
      payrollRun: {
        update: payrollRunUpdateMock,
      },
      customerConfirmation: {
        findMany: customerConfirmationFindManyMock,
        updateMany: customerConfirmationUpdateManyMock,
        count: staleConfirmationCountMock,
      },
      customerConfirmationPack: {
        updateMany: customerConfirmationPackUpdateManyMock,
      },
      customerConfirmationPackItem: {
        findMany: customerConfirmationPackItemFindManyMock,
        count: packItemCountMock,
      },
      questionItem: {
        count: questionCountMock,
      },
    }),
  ),
);
const mocksToReset = [
  proposalFindUniqueMock,
  proposalFindManyMock,
  proposalUpdateManyMock,
  ledgerCreateMock,
  auditCreateManyMock,
  auditCreateMock,
  caseItemCreateMock,
  rawInputUpdateManyMock,
  payrollRunUpdateMock,
  customerConfirmationFindManyMock,
  customerConfirmationUpdateManyMock,
  customerConfirmationPackUpdateManyMock,
  customerConfirmationPackItemFindManyMock,
  questionCountMock,
  packItemCountMock,
  staleConfirmationCountMock,
];

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
    changeProposal: {
      findUnique: proposalFindUniqueMock,
      findMany: proposalFindManyMock,
      updateMany: proposalUpdateManyMock,
    },
    changeLedgerEntry: {
      create: ledgerCreateMock,
    },
    auditLog: {
      create: auditCreateMock,
      createMany: auditCreateManyMock,
    },
    caseItem: {
      create: caseItemCreateMock,
    },
    rawInputItem: {
      updateMany: rawInputUpdateManyMock,
    },
    payrollRun: {
      update: payrollRunUpdateMock,
    },
    customerConfirmation: {
      findMany: customerConfirmationFindManyMock,
      updateMany: customerConfirmationUpdateManyMock,
      count: staleConfirmationCountMock,
    },
    customerConfirmationPack: {
      updateMany: customerConfirmationPackUpdateManyMock,
    },
    customerConfirmationPackItem: {
      findMany: customerConfirmationPackItemFindManyMock,
      count: packItemCountMock,
    },
    questionItem: {
      count: questionCountMock,
    },
  },
}));

const context = { params: Promise.resolve({ proposalId: "proposal-a" }) };

function request(body: unknown) {
  return new NextRequest("http://test.local/api/change-proposals/proposal-a", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest",
    },
    method: "PATCH",
  });
}

function pendingProposal() {
  return {
    id: "proposal-a",
    clientId: "client-a",
    runId: "run-a",
    rawInputItemId: "raw-a",
    status: "PENDING_REVIEW",
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
  mocksToReset.forEach((mock) => mock.mockReset());
  customerConfirmationFindManyMock.mockResolvedValue([]);
  customerConfirmationPackItemFindManyMock.mockResolvedValue([]);
  questionCountMock.mockResolvedValue(0);
  packItemCountMock.mockResolvedValue(0);
  staleConfirmationCountMock.mockResolvedValue(0);
  transactionMock.mockClear();
});

describe("change proposal API review gates", () => {
  it("rejects stale concurrent approval before creating ledger or audit", async () => {
    proposalFindUniqueMock.mockResolvedValue(pendingProposal());
    proposalUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await PATCH(
      request({ action: "approve", reviewNote: "approve with evidence" }),
      context,
    );
    const body = (await response.json()) as { errorCode: string };

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe("CHANGE_PROPOSAL_ALREADY_REVIEWED");
    expect(proposalUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proposal-a", status: "PENDING_REVIEW" },
      }),
    );
    expect(ledgerCreateMock).not.toHaveBeenCalled();
    expect(auditCreateManyMock).not.toHaveBeenCalled();
  });

  it("rejects stale concurrent close before audit", async () => {
    proposalFindUniqueMock.mockResolvedValue(pendingProposal());
    proposalUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await PATCH(
      request({ action: "reject", reviewNote: "duplicate close" }),
      context,
    );
    const body = (await response.json()) as { errorCode: string };

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe("CHANGE_PROPOSAL_ALREADY_REVIEWED");
    expect(auditCreateMock).not.toHaveBeenCalled();
  });

  it("creates ledger with a formal object reference on approval", async () => {
    proposalFindUniqueMock.mockResolvedValueOnce(pendingProposal()).mockResolvedValueOnce({
      ...pendingProposal(),
      status: "APPROVED",
    });
    proposalUpdateManyMock.mockResolvedValue({ count: 1 });
    ledgerCreateMock.mockResolvedValue({ id: "ledger-a", riskLevel: "R3" });

    const response = await PATCH(
      request({ action: "approve", reviewNote: "approve with formal ref" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(ledgerCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          formalObjectType: "EmployeeMasterVersion",
          formalObjectId: "employee-master-a",
          formalObjectVersionRef:
            "EmployeeMasterVersion:employee-master-a:salaryAmount:2026-06",
        }),
      }),
    );
  });

  it("converts a proposal to a tracked question case item", async () => {
    proposalFindUniqueMock.mockResolvedValueOnce(pendingProposal()).mockResolvedValueOnce({
      ...pendingProposal(),
      status: "CONVERTED_TO_QUESTION",
    });
    proposalUpdateManyMock.mockResolvedValue({ count: 1 });
    caseItemCreateMock.mockResolvedValue({ id: "case-a" });

    const response = await PATCH(
      request({ action: "convertToQuestion", reviewNote: "客户需补充调薪生效日" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(caseItemCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "MISSING_INFORMATION",
          rawInputItemId: "raw-a",
          title: "ChangeProposal 转追问",
        }),
      }),
    );
    expect(rawInputUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "raw-a" },
      data: { status: "NEEDS_QUESTION" },
    });
    expect(payrollRunUpdateMock).toHaveBeenCalledWith({
      where: { id: "run-a" },
      data: { blockingIssueCount: { increment: 1 } },
    });
  });

});
