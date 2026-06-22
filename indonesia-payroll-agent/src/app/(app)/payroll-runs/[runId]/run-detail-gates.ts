export function canAdvanceToNext({
  nextStatus,
  blockingIssueCount,
  highRiskIssueCount,
  pendingCustomerConfirmationCount,
  payrollResultCount,
  calculationTraceCount,
  blockedReconciliationCheckCount,
  readyPayrollConfirmationPackageCount,
}: {
  nextStatus: string | null;
  blockingIssueCount: number;
  highRiskIssueCount: number;
  pendingCustomerConfirmationCount: number;
  payrollResultCount: number;
  calculationTraceCount: number;
  blockedReconciliationCheckCount: number;
  readyPayrollConfirmationPackageCount: number;
}) {
  if (!nextStatus) return false;
  if (nextStatus === "LOCKED") {
    return (
      blockingIssueCount === 0 &&
      highRiskIssueCount === 0 &&
      pendingCustomerConfirmationCount === 0 &&
      payrollResultCount > 0 &&
      calculationTraceCount > 0 &&
      blockedReconciliationCheckCount === 0 &&
      readyPayrollConfirmationPackageCount > 0
    );
  }
  if (nextStatus === "PENDING_CALCULATION") return blockingIssueCount === 0;
  if (nextStatus === "PENDING_PRECHECK") return pendingCustomerConfirmationCount === 0;
  if (nextStatus === "PENDING_PAYROLL_CONFIRMATION") {
    return highRiskIssueCount === 0 && payrollResultCount > 0 && calculationTraceCount > 0;
  }
  return true;
}
