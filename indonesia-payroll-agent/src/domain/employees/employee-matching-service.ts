import { randomUUID } from "node:crypto";
import { type AuditService } from "@/domain/audit/audit-service";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type ConfidenceBand } from "@/domain/changes/change-review-policy";
import { rankEmployeeMatch } from "@/domain/employees/employee-match-ranking";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";

export const EMPLOYEE_MATCH_METHODS = [
  "EMPLOYEE_CODE",
  "NIK_OR_PASSPORT",
  "NPWP",
  "NAME_WITH_CONTEXT",
  "NAME_ONLY",
  "UNMATCHED",
  "NEW_EMPLOYEE_REQUIRED",
] as const;

export const EMPLOYEE_MATCH_STATUSES = ["CANDIDATE", "CONFIRMED", "REJECTED", "BLOCKED"] as const;

export type EmployeeMatchMethod = (typeof EMPLOYEE_MATCH_METHODS)[number];
export type EmployeeMatchStatus = (typeof EMPLOYEE_MATCH_STATUSES)[number];

export type EmployeeIdentityRecord = {
  id: string;
  clientId: string;
  employeeCode: string;
  fullName: string;
  nikOrPassport?: string | null;
  npwp?: string | null;
  workCity?: string | null;
};

export type EmployeeMatchRow = {
  clientId: string;
  runId: string;
  rawInputItemId?: string | null;
  sheetId?: string | null;
  sourceAgentRunId?: string | null;
  employeeCodeRaw?: string | null;
  fullNameRaw: string;
  nikOrPassportRaw?: string | null;
  npwpRaw?: string | null;
  joinDateRaw?: string | null;
  storeCode?: string | null;
  positionRaw?: string | null;
  evidenceRefs: string[];
};

export type EmployeeMatchCandidateRecord = EmployeeMatchRow & {
  id: string;
  employeeId?: string | null;
  matchMethod: EmployeeMatchMethod;
  confidence: ConfidenceBand;
  status: EmployeeMatchStatus;
  conflictSummary: Record<string, unknown>;
  reason: string;
  confirmedById?: string | null;
  confirmedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type EmployeeMatchingStore = {
  findRunById(id: string): Promise<{
    id: string;
    clientId: string;
    status: PayrollRunStatus;
    lockedAt?: Date | null;
  } | null>;
  findEmployeesByClient(clientId: string): Promise<EmployeeIdentityRecord[]>;
  createCandidate(input: EmployeeMatchCandidateRecord): Promise<EmployeeMatchCandidateRecord>;
  findCandidateById(id: string): Promise<EmployeeMatchCandidateRecord | null>;
  updateCandidate(input: {
    id: string;
    employeeId: string;
    status: EmployeeMatchStatus;
    confirmedById: string;
    confirmedAt: Date;
    confidence?: ConfidenceBand;
    reason?: string;
  }): Promise<EmployeeMatchCandidateRecord>;
};

const HISTORY_STATUSES = new Set<PayrollRunStatus>([
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
]);

export class EmployeeMatchingService {
  constructor(
    private readonly store: EmployeeMatchingStore,
    private readonly auditService: AuditService,
  ) {}

  async createCandidate(input: {
    actor: ActorContext;
    row: EmployeeMatchRow;
  }): Promise<EmployeeMatchCandidateRecord> {
    const run = await this.requireWritableRun(input.row.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    if (input.row.clientId !== run.clientId) {
      throw new EmployeeMatchingServiceError("EMPLOYEE_MATCH_RUN_SCOPE_MISMATCH");
    }
    const employees = await this.store.findEmployeesByClient(input.row.clientId);
    const match = rankEmployeeMatch(input.row, employees);
    const now = new Date();
    const candidate = await this.store.createCandidate({
      ...input.row,
      id: randomUUID(),
      employeeId: match.employeeId,
      matchMethod: match.matchMethod,
      confidence: match.confidence,
      status: match.status,
      conflictSummary: match.conflictSummary,
      reason: match.reason,
      confirmedById: null,
      confirmedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.auditService.record({
      actor: input.actor,
      action: "EMPLOYEE_MATCH_CANDIDATE_CREATED",
      objectType: "EMPLOYEE_MATCH_CANDIDATE",
      objectId: candidate.id,
      riskLevel: candidate.status === "BLOCKED" ? "R3" : "R2",
      clientId: candidate.clientId,
      runId: candidate.runId,
      metadata: {
        matchMethod: candidate.matchMethod,
        confidence: candidate.confidence,
        inputSummary: "员工匹配候选已生成，低置信、姓名单独、未匹配和冲突不得自动确认",
      },
    });

    return candidate;
  }

  async confirmCandidate(input: {
    actor: ActorContext;
    candidateId: string;
    employeeId?: string;
    evidenceRefs?: string[];
    reason: string;
  }): Promise<EmployeeMatchCandidateRecord> {
    const candidate = await this.requireCandidate(input.candidateId);
    const run = await this.requireWritableRun(candidate.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    if (!["CANDIDATE", "BLOCKED"].includes(candidate.status)) {
      throw new EmployeeMatchingServiceError("EMPLOYEE_MATCH_CANDIDATE_NOT_REVIEWABLE");
    }

    const employeeId = input.employeeId ?? candidate.employeeId;
    if (!employeeId) {
      throw new EmployeeMatchingServiceError("EMPLOYEE_MATCH_EMPLOYEE_REQUIRED");
    }
    const evidenceRefs = input.evidenceRefs ?? candidate.evidenceRefs;
    if (
      ["NAME_ONLY", "UNMATCHED", "NEW_EMPLOYEE_REQUIRED"].includes(candidate.matchMethod) &&
      evidenceRefs.length === 0
    ) {
      throw new EmployeeMatchingServiceError("EMPLOYEE_MATCH_LOW_CONFIDENCE_EVIDENCE_REQUIRED");
    }

    const updated = await this.store.updateCandidate({
      id: candidate.id,
      employeeId,
      status: "CONFIRMED",
      confirmedById: input.actor.id,
      confirmedAt: new Date(),
      confidence: candidate.confidence === "CONFLICT" ? "MEDIUM" : candidate.confidence,
      reason: input.reason.trim(),
    });
    await this.auditService.record({
      actor: input.actor,
      action: "EMPLOYEE_MATCH_CONFIRMED",
      objectType: "EMPLOYEE_MATCH_CANDIDATE",
      objectId: candidate.id,
      riskLevel: candidate.confidence === "LOW" || candidate.confidence === "CONFLICT" ? "R3" : "R2",
      clientId: candidate.clientId,
      runId: candidate.runId,
      metadata: { employeeId, matchMethod: candidate.matchMethod, reason: input.reason },
    });

    return updated;
  }

  private async requireCandidate(id: string) {
    const candidate = await this.store.findCandidateById(id);
    if (!candidate) {
      throw new EmployeeMatchingServiceError("EMPLOYEE_MATCH_CANDIDATE_NOT_FOUND");
    }
    return candidate;
  }

  private async requireWritableRun(runId: string) {
    const run = await this.store.findRunById(runId);
    if (!run) {
      throw new EmployeeMatchingServiceError("PAYROLL_RUN_NOT_FOUND");
    }
    if (HISTORY_STATUSES.has(run.status) || run.lockedAt) {
      throw new EmployeeMatchingServiceError("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    return run;
  }
}

export class EmployeeMatchingServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EmployeeMatchingServiceError";
  }
}
