import { assertReviewableStandardizedInputStatus } from "@/domain/standardization/standardization-policy";

const HISTORY_STATUSES = new Set(["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"]);

export function assertRunWritable(run: { status: string; lockedAt?: Date | null }) {
  if (HISTORY_STATUSES.has(run.status) || run.lockedAt) {
    throw new Error("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
  }
}

export function assertPendingProposalStatus(status: string, hasLedgerEntry = false) {
  if (status !== "PENDING_REVIEW" || hasLedgerEntry) {
    throw new Error("CHANGE_PROPOSAL_ALREADY_REVIEWED");
  }
}

export function assertReviewableMappingCandidate(status: string) {
  if (status !== "CANDIDATE") {
    throw new Error("FIELD_MAPPING_CANDIDATE_NOT_REVIEWABLE");
  }
}

export function assertReviewableStandardizedInput(status: string) {
  assertReviewableStandardizedInputStatus(status);
}

export function assertConfirmedStandardizationDependencies(input: {
  clientId: string;
  runId: string;
  fieldMappingVersionId?: string | null;
  fieldMappingVersion?: {
    clientId: string;
    runId: string;
    status: string;
    confidence: string;
  } | null;
  employeeMatchCandidateId?: string | null;
  employeeMatchCandidate?: {
    clientId: string;
    runId: string;
    status: string;
    employeeId?: string | null;
  } | null;
}) {
  if (!input.fieldMappingVersionId || !input.fieldMappingVersion) {
    throw new Error("FIELD_MAPPING_REQUIRED");
  }
  if (
    input.fieldMappingVersion.clientId !== input.clientId ||
    input.fieldMappingVersion.runId !== input.runId ||
    input.fieldMappingVersion.status !== "CONFIRMED" ||
    ["LOW", "CONFLICT"].includes(input.fieldMappingVersion.confidence)
  ) {
    throw new Error("FIELD_MAPPING_NOT_CONFIRMED");
  }

  if (!input.employeeMatchCandidateId || !input.employeeMatchCandidate) {
    throw new Error("EMPLOYEE_MATCH_REQUIRED");
  }
  if (
    input.employeeMatchCandidate.clientId !== input.clientId ||
    input.employeeMatchCandidate.runId !== input.runId ||
    input.employeeMatchCandidate.status !== "CONFIRMED" ||
    !input.employeeMatchCandidate.employeeId
  ) {
    throw new Error("EMPLOYEE_MATCH_NOT_CONFIRMED");
  }
}
