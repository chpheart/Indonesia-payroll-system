import {
  type ClientScopedAction,
} from "@/domain/auth/permissions";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";
import { type AuditRiskLevel } from "@/domain/audit/audit-service";

export function actionRequiredForRunTransition(
  fromStatus: PayrollRunStatus,
  toStatus: PayrollRunStatus,
): ClientScopedAction {
  if (toStatus === "PENDING_PAYROLL_CONFIRMATION" && fromStatus === "PENDING_HIGH_RISK_RELEASE") {
    return "releaseHighRisk";
  }

  switch (toStatus) {
    case "LOCKED":
      return "lockPayroll";
    case "EXPORTED":
      return "downloadExport";
    case "ARCHIVED":
      return "downloadExport";
    case "VOIDED":
      return "voidPayrollRun";
    case "CORRECTED":
      return "createCorrectionRun";
    default:
      return "updatePayrollRun";
  }
}

export function riskLevelForRunTransition(
  fromStatus: PayrollRunStatus,
  toStatus: PayrollRunStatus,
): AuditRiskLevel {
  const action = actionRequiredForRunTransition(fromStatus, toStatus);
  return action === "updatePayrollRun" ? "R2" : "R3";
}
