import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  payrollResultCount: vi.fn(),
  calculationTraceCount: vi.fn(),
  reconciliationCheckCount: vi.fn(),
  payrollResultFindFirst: vi.fn(),
  payrollConfirmationPackageCount: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    payrollResult: {
      count: prismaMocks.payrollResultCount,
      findFirst: prismaMocks.payrollResultFindFirst,
    },
    calculationTrace: { count: prismaMocks.calculationTraceCount },
    reconciliationCheck: { count: prismaMocks.reconciliationCheckCount },
    payrollConfirmationPackage: { count: prismaMocks.payrollConfirmationPackageCount },
  },
}));

import { runGateCountsForTransition } from "@/app/(app)/payroll-runs/transition-gates";

describe("payroll run transition gates", () => {
  beforeEach(() => {
    prismaMocks.payrollResultCount.mockReset();
    prismaMocks.calculationTraceCount.mockReset();
    prismaMocks.reconciliationCheckCount.mockReset();
    prismaMocks.payrollResultFindFirst.mockReset();
    prismaMocks.payrollConfirmationPackageCount.mockReset();
  });

  it("loads confirmation package and blocked reconciliation counts before lock", async () => {
    prismaMocks.payrollResultCount.mockResolvedValue(1);
    prismaMocks.calculationTraceCount.mockResolvedValue(5);
    prismaMocks.reconciliationCheckCount.mockResolvedValue(0);
    prismaMocks.payrollResultFindFirst.mockResolvedValue({ resultVersionRef: "result-v1" });
    prismaMocks.payrollConfirmationPackageCount.mockResolvedValue(1);

    const gates = await runGateCountsForTransition(
      {
        id: "run-a",
        blockingIssueCount: 0,
        highRiskIssueCount: 0,
        pendingCustomerConfirmationCount: 0,
      },
      "LOCKED",
    );

    expect(gates).toMatchObject({
      payrollResultCount: 1,
      calculationTraceCount: 5,
      blockedReconciliationCheckCount: 0,
      readyPayrollConfirmationPackageCount: 1,
    });
    expect(prismaMocks.reconciliationCheckCount).toHaveBeenCalledWith({
      where: { runId: "run-a", status: "BLOCKED" },
    });
    expect(prismaMocks.payrollConfirmationPackageCount).toHaveBeenCalledWith({
      where: {
        runId: "run-a",
        status: "READY_FOR_REVIEW",
        resultVersionRef: "result-v1",
      },
    });
  });
});
