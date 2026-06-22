import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "@/app/api/change-proposals/[proposalId]/route";

const proposalFindUniqueMock = vi.hoisted(() => vi.fn());
const proposalFindManyMock = vi.hoisted(() => vi.fn());
const proposalUpdateManyMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

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
  },
}));

const context = { params: Promise.resolve({ proposalId: "proposal-a" }) };

function request(body: unknown) {
  return new NextRequest("http://test.local/api/change-proposals/proposal-a", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "user-agent": "vitest" },
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
  [proposalFindUniqueMock, proposalFindManyMock, proposalUpdateManyMock, transactionMock].forEach((mock) =>
    mock.mockReset(),
  );
});

describe("change proposal API related proposal scope", () => {
  it("rejects merge or split without related proposal ids", async () => {
    proposalFindUniqueMock.mockResolvedValue(pendingProposal());

    const response = await PATCH(
      request({ action: "merge", reviewNote: "merge requires target proposals" }),
      context,
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "RELATED_PROPOSALS_REQUIRED_FOR_REVIEW_ACTION",
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects merge or split when related proposal ids are not traceable", async () => {
    proposalFindUniqueMock.mockResolvedValue(pendingProposal());
    proposalFindManyMock.mockResolvedValueOnce([]);

    const missing = await PATCH(
      request({ action: "split", relatedProposalIds: ["missing-proposal"], reviewNote: "missing relation" }),
      context,
    );
    expect(missing.status).toBe(400);
    expect((await missing.json()) as { errorCode: string }).toMatchObject({
      errorCode: "RELATED_PROPOSALS_NOT_FOUND",
    });

    const self = await PATCH(
      request({ action: "merge", relatedProposalIds: ["proposal-a"], reviewNote: "self relation" }),
      context,
    );
    expect(self.status).toBe(400);
    expect((await self.json()) as { errorCode: string }).toMatchObject({
      errorCode: "RELATED_PROPOSAL_CANNOT_REFERENCE_SELF",
    });

    proposalFindManyMock.mockResolvedValueOnce([{ id: "proposal-b", clientId: "client-a", runId: "other-run" }]);
    const crossRun = await PATCH(
      request({ action: "merge", relatedProposalIds: ["proposal-b"], reviewNote: "cross run" }),
      context,
    );
    expect(crossRun.status).toBe(400);
    expect((await crossRun.json()) as { errorCode: string }).toMatchObject({
      errorCode: "RELATED_PROPOSALS_SCOPE_MISMATCH",
    });
    expect(proposalUpdateManyMock).not.toHaveBeenCalled();
  });
});
