export const PAYROLL_RUN_STATUSES = [
  "DRAFT",
  "PENDING_MAPPING_CONFIRMATION",
  "PENDING_STANDARDIZATION_CONFIRMATION",
  "PENDING_CUSTOMER_CONFIRMATION",
  "PENDING_PRECHECK",
  "PENDING_CALCULATION",
  "PENDING_PAYROLL_CONFIRMATION",
  "PENDING_HIGH_RISK_RELEASE",
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
] as const;

export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const RUN_CHANGE_SOURCE_TYPES = [
  "RAW_INPUT",
  "FILE",
  "FIELD_MAPPING",
  "STANDARDIZED_INPUT",
  "EMPLOYEE_MASTER",
  "CLIENT_CONFIG",
  "CUSTOMER_RULE",
  "PUBLIC_RULE",
  "FX_RATE",
  "CUSTOMER_CONFIRMATION_PACK",
  "PAYROLL_RESULT",
  "MANUAL_STAGE_ROLLBACK",
] as const;

export type RunChangeSourceType = (typeof RUN_CHANGE_SOURCE_TYPES)[number];

export type RunGateCounts = {
  blockingIssueCount: number;
  highRiskIssueCount: number;
  pendingCustomerConfirmationCount: number;
  payrollResultCount?: number;
  calculationTraceCount?: number;
};

const STATUS_ORDER: Record<PayrollRunStatus, number> = {
  DRAFT: 0,
  PENDING_MAPPING_CONFIRMATION: 1,
  PENDING_STANDARDIZATION_CONFIRMATION: 2,
  PENDING_CUSTOMER_CONFIRMATION: 3,
  PENDING_PRECHECK: 4,
  PENDING_CALCULATION: 5,
  PENDING_HIGH_RISK_RELEASE: 6,
  PENDING_PAYROLL_CONFIRMATION: 7,
  LOCKED: 8,
  EXPORTED: 9,
  ARCHIVED: 10,
  VOIDED: 11,
  CORRECTED: 12,
};

const TERMINAL_OR_HISTORY_STATUSES = new Set<PayrollRunStatus>([
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
]);

const ALLOWED_FORWARD_TRANSITIONS: Record<PayrollRunStatus, PayrollRunStatus[]> = {
  DRAFT: ["PENDING_MAPPING_CONFIRMATION", "VOIDED"],
  PENDING_MAPPING_CONFIRMATION: ["PENDING_STANDARDIZATION_CONFIRMATION", "VOIDED"],
  PENDING_STANDARDIZATION_CONFIRMATION: ["PENDING_CUSTOMER_CONFIRMATION", "VOIDED"],
  PENDING_CUSTOMER_CONFIRMATION: ["PENDING_PRECHECK", "VOIDED"],
  PENDING_PRECHECK: ["PENDING_CALCULATION", "PENDING_HIGH_RISK_RELEASE", "VOIDED"],
  PENDING_CALCULATION: ["PENDING_HIGH_RISK_RELEASE", "VOIDED"],
  PENDING_HIGH_RISK_RELEASE: ["PENDING_PAYROLL_CONFIRMATION", "VOIDED"],
  PENDING_PAYROLL_CONFIRMATION: ["LOCKED", "VOIDED"],
  LOCKED: ["EXPORTED", "CORRECTED"],
  EXPORTED: ["ARCHIVED", "CORRECTED"],
  ARCHIVED: ["CORRECTED"],
  VOIDED: [],
  CORRECTED: [],
};

export function assertValidRunTransition(
  fromStatus: PayrollRunStatus,
  toStatus: PayrollRunStatus,
  gates: RunGateCounts,
): void {
  if (!ALLOWED_FORWARD_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new RunStateMachineError("PAYROLL_RUN_STATUS_TRANSITION_NOT_ALLOWED");
  }

  if (toStatus === "LOCKED") {
    assertRunCanLock(gates);
  }

  if (toStatus === "PENDING_PAYROLL_CONFIRMATION" || toStatus === "LOCKED") {
    assertRunHasCalculationArtifacts(gates);
  }

  if (fromStatus === "PENDING_CUSTOMER_CONFIRMATION" && gates.pendingCustomerConfirmationCount > 0) {
    throw new RunStateMachineError("PAYROLL_RUN_CUSTOMER_CONFIRMATION_REQUIRED");
  }

  if (toStatus === "PENDING_CALCULATION" && gates.blockingIssueCount > 0) {
    throw new RunStateMachineError("PAYROLL_RUN_BLOCKERS_MUST_BE_CLEARED");
  }

  if (fromStatus === "PENDING_HIGH_RISK_RELEASE" && gates.highRiskIssueCount > 0) {
    throw new RunStateMachineError("PAYROLL_RUN_HIGH_RISK_MUST_BE_RELEASED");
  }
}

export function assertRunCanLock(gates: RunGateCounts): void {
  if (gates.blockingIssueCount > 0) {
    throw new RunStateMachineError("PAYROLL_RUN_BLOCKERS_MUST_BE_CLEARED");
  }

  if (gates.highRiskIssueCount > 0) {
    throw new RunStateMachineError("PAYROLL_RUN_HIGH_RISK_MUST_BE_RELEASED");
  }

  if (gates.pendingCustomerConfirmationCount > 0) {
    throw new RunStateMachineError("PAYROLL_RUN_CUSTOMER_CONFIRMATION_REQUIRED");
  }
}

function assertRunHasCalculationArtifacts(gates: RunGateCounts): void {
  if ((gates.payrollResultCount ?? 0) <= 0 || (gates.calculationTraceCount ?? 0) <= 0) {
    throw new RunStateMachineError("PAYROLL_RUN_CALCULATION_RESULT_REQUIRED");
  }
}

export function targetStatusForRunImpact(
  currentStatus: PayrollRunStatus,
  sourceType: RunChangeSourceType,
): PayrollRunStatus {
  if (TERMINAL_OR_HISTORY_STATUSES.has(currentStatus)) {
    throw new RunStateMachineError("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
  }

  const targetStatus = rollbackTargetForSource(sourceType);
  return STATUS_ORDER[currentStatus] > STATUS_ORDER[targetStatus] ? targetStatus : currentStatus;
}

export function rollbackTargetForSource(sourceType: RunChangeSourceType): PayrollRunStatus {
  switch (sourceType) {
    case "RAW_INPUT":
    case "FILE":
    case "FIELD_MAPPING":
      return "PENDING_MAPPING_CONFIRMATION";
    case "STANDARDIZED_INPUT":
      return "PENDING_STANDARDIZATION_CONFIRMATION";
    case "CUSTOMER_CONFIRMATION_PACK":
      return "PENDING_CUSTOMER_CONFIRMATION";
    case "EMPLOYEE_MASTER":
    case "CLIENT_CONFIG":
    case "CUSTOMER_RULE":
    case "PUBLIC_RULE":
    case "FX_RATE":
      return "PENDING_PRECHECK";
    case "PAYROLL_RESULT":
      return "PENDING_PAYROLL_CONFIRMATION";
    case "MANUAL_STAGE_ROLLBACK":
      return "DRAFT";
  }
}

export function isRunActionable(status: PayrollRunStatus): boolean {
  return !["ARCHIVED", "VOIDED", "CORRECTED"].includes(status);
}

export class RunStateMachineError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RunStateMachineError";
  }
}
