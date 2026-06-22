import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postQuestion } from "@/app/api/questions/route";

const payrollRunFindUniqueMock = vi.hoisted(() => vi.fn());
const rawInputFindUniqueMock = vi.hoisted(() => vi.fn());
const changeProposalFindUniqueMock = vi.hoisted(() => vi.fn());
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
    rawInputItem: { findUnique: rawInputFindUniqueMock },
    changeProposal: { findUnique: changeProposalFindUniqueMock },
  },
}));

beforeEach(() => {
  payrollRunFindUniqueMock.mockReset();
  rawInputFindUniqueMock.mockReset();
  changeProposalFindUniqueMock.mockReset();
  transactionMock.mockReset();
  payrollRunFindUniqueMock.mockResolvedValue({ clientId: "client-a" });
});

describe("phase 9 question API guardrails", () => {
  it("rejects question creation with raw input from another run", async () => {
    rawInputFindUniqueMock.mockResolvedValue({ clientId: "client-a", runId: "run-b" });

    const response = await postQuestion(
      jsonRequest({
        action: "create",
        clientId: "client-a",
        runId: "run-a",
        rawInputItemId: "raw-run-b",
        title: "确认奖金来源",
        detail: "客户表格奖金列需要确认",
        reason: "影响应发工资",
        impactSummary: "employee-a bonusAmount",
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "QUESTION_RAW_INPUT_SCOPE_MISMATCH",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects question creation with change proposal from another run", async () => {
    changeProposalFindUniqueMock.mockResolvedValue({ clientId: "client-a", runId: "run-b" });

    const response = await postQuestion(
      jsonRequest({
        action: "create",
        clientId: "client-a",
        runId: "run-a",
        changeProposalId: "proposal-run-b",
        title: "确认调薪",
        detail: "调薪依据需要客户确认",
        reason: "影响工资结果",
        impactSummary: "employee-a salaryAmount",
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()) as { errorCode: string }).toMatchObject({
      errorCode: "QUESTION_CHANGE_PROPOSAL_SCOPE_MISMATCH",
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

function jsonRequest(body: unknown) {
  return new NextRequest("http://test.local/api/questions", {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "user-agent": "vitest",
    },
    method: "POST",
  });
}
