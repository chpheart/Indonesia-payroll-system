import { prisma } from "@/lib/db/prisma";

export async function runGateCountsForTransition<T extends {
  id: string;
  blockingIssueCount: number;
  highRiskIssueCount: number;
  pendingCustomerConfirmationCount: number;
}>(run: T, toStatus: string) {
  if (toStatus !== "PENDING_PAYROLL_CONFIRMATION" && toStatus !== "LOCKED") {
    return run;
  }

  const [payrollResultCount, calculationTraceCount, blockedReconciliationCheckCount, latestResult] = await Promise.all([
    prisma.payrollResult.count({ where: { runId: run.id, status: "FINAL" } }),
    prisma.calculationTrace.count({
      where: { runId: run.id, result: { status: "FINAL" } },
    }),
    toStatus === "LOCKED"
      ? prisma.reconciliationCheck.count({ where: { runId: run.id, status: "BLOCKED" } })
      : Promise.resolve(0),
    prisma.payrollResult.findFirst({
      where: { runId: run.id, status: "FINAL" },
      orderBy: { calculatedAt: "desc" },
      select: { resultVersionRef: true },
    }),
  ]);
  const readyPayrollConfirmationPackageCount =
    toStatus === "LOCKED" && latestResult
      ? await prisma.payrollConfirmationPackage.count({
          where: {
            runId: run.id,
            status: "READY_FOR_REVIEW",
            resultVersionRef: latestResult.resultVersionRef,
          },
        })
      : 0;

  return {
    ...run,
    payrollResultCount,
    calculationTraceCount,
    blockedReconciliationCheckCount,
    readyPayrollConfirmationPackageCount,
  };
}
