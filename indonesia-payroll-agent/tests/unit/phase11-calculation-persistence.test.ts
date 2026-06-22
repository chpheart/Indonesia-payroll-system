import { describe, expect, it, vi } from "vitest";
import { persistPayrollCalculation } from "@/app/api/payroll-runs/[runId]/calculate/calculation-persistence";
import { calculatePayroll } from "@/domain/payroll-engine/engine";
import { evaluatePayrollReconciliation } from "@/domain/reconciliation/reconciliation-service";
import { buildHighRiskIssues } from "@/domain/risks/risk-service";
import { type Prisma } from "@/generated/prisma/client";
import { basePayrollInput } from "./phase10-test-fixtures";

describe("phase 11 calculation persistence", () => {
  it("persists reconciliation checks and high risk issues before moving to release gate", async () => {
    const input = basePayrollInput();
    const output = calculatePayroll(input);
    output.results[0].comparisonValues.push({
      employeeId: "employee-a",
      sourceInputId: "input-customer-net",
      targetField: "netPay",
      customerValue: output.results[0].netPay + 20_000,
      systemValue: output.results[0].netPay,
      delta: 20_000,
      status: "DIFF",
      currencyCode: "IDR",
      sourceLabel: "Customer payroll sheet",
    });
    const reconciliation = evaluatePayrollReconciliation(input, output);
    const highRiskIssues = buildHighRiskIssues(reconciliation.highRiskSignals);
    const tx = fakeTx(1);

    await persistPayrollCalculation(
      tx as unknown as Prisma.TransactionClient,
      { id: "run-a", clientId: "client-a", status: "PENDING_CALCULATION" },
      output,
      reconciliation,
      highRiskIssues,
      {
        actorUserId: "payroll-user",
        actorEmail: "payroll@example.local",
        actorRoleCodes: ["PAYROLL_SPECIALIST"],
      },
    );

    expect(tx.reconciliationCheck.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ runId: "run-a", checkType: "CUSTOMER_COMPARISON" }),
        ]),
      }),
    );
    expect(tx.highRiskIssue.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ issueType: "CUSTOMER_COMPARISON_DIFF" }),
        ]),
      }),
    );
    expect(tx.payrollRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PENDING_HIGH_RISK_RELEASE",
          highRiskIssueCount: 1,
        }),
      }),
    );
    expect(tx.highRiskIssue.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "OPEN",
          targetObjectType: { not: "PRECHECK_RUN" },
        }),
      }),
    );
    expect(tx.payrollConfirmationPackage.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "INVALIDATED" }),
      }),
    );
  });
});

function fakeTx(openHighRiskIssueCount: number) {
  return {
    payrollResult: {
      updateMany: vi.fn(),
      create: vi.fn(async () => ({ id: "result-a" })),
    },
    highRiskIssue: {
      updateMany: vi.fn(),
      createMany: vi.fn(),
      count: vi.fn(async () => openHighRiskIssueCount),
    },
    reconciliationCheck: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    payrollConfirmationPackage: { updateMany: vi.fn() },
    payrollRun: { update: vi.fn() },
    runStatusEvent: { create: vi.fn() },
    customerComparisonValue: { createMany: vi.fn() },
    auditLog: { create: vi.fn() },
  };
}
