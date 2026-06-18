import { randomUUID } from "node:crypto";
import { type AuditService } from "@/domain/audit/audit-service";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type ConfidenceBand } from "@/domain/changes/change-review-policy";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";

export const FIELD_MAPPING_SOURCES = ["AGENT", "HISTORICAL_TEMPLATE", "MANUAL"] as const;
export const FIELD_MAPPING_STATUSES = ["CANDIDATE", "CONFIRMED", "REJECTED", "SUPERSEDED"] as const;

export type FieldMappingSource = (typeof FIELD_MAPPING_SOURCES)[number];
export type FieldMappingStatus = (typeof FIELD_MAPPING_STATUSES)[number];

export type FieldMappingCandidateRecord = {
  id: string;
  clientId: string;
  runId: string;
  rawInputItemId?: string | null;
  fileVersionId?: string | null;
  workbookParseId?: string | null;
  sheetId?: string | null;
  sourceAgentRunId?: string | null;
  source: FieldMappingSource;
  status: FieldMappingStatus;
  sourceSheetName: string;
  sourceColumnLabel: string;
  sourceColumnIndex?: number | null;
  sampleValues: unknown[];
  targetField: string;
  fieldCategory: string;
  confidence: ConfidenceBand;
  rationale: string;
  evidenceRefs: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type FieldMappingVersionRecord = Omit<
  FieldMappingCandidateRecord,
  "id" | "rawInputItemId" | "workbookParseId" | "sourceAgentRunId" | "sampleValues"
> & {
  id: string;
  candidateId?: string | null;
  versionNumber: number;
  templateSourceRef?: string | null;
  confirmedById?: string | null;
  confirmedAt: Date;
};

export type FieldMappingStore = {
  findRunById(id: string): Promise<{
    id: string;
    clientId: string;
    status: PayrollRunStatus;
    lockedAt?: Date | null;
  } | null>;
  createCandidate(input: FieldMappingCandidateRecord): Promise<FieldMappingCandidateRecord>;
  findCandidateById(id: string): Promise<FieldMappingCandidateRecord | null>;
  confirmCandidateWithVersion(input: {
    candidateId: string;
    expectedStatus: Extract<FieldMappingStatus, "CANDIDATE">;
    version: Omit<FieldMappingVersionRecord, "versionNumber">;
  }): Promise<FieldMappingVersionRecord | null>;
};

const HISTORY_STATUSES = new Set<PayrollRunStatus>([
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
]);

export class MappingService {
  constructor(
    private readonly store: FieldMappingStore,
    private readonly auditService: AuditService,
  ) {}

  async createCandidate(input: {
    actor: ActorContext;
    candidate: Omit<FieldMappingCandidateRecord, "id" | "status" | "createdAt" | "updatedAt">;
  }): Promise<FieldMappingCandidateRecord> {
    const run = await this.requireWritableRun(input.candidate.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    assertCandidateScope(input.candidate, run.clientId);

    const now = new Date();
    const created = await this.store.createCandidate({
      ...input.candidate,
      id: randomUUID(),
      status: "CANDIDATE",
      createdAt: now,
      updatedAt: now,
    });
    await this.auditService.record({
      actor: input.actor,
      action: "FIELD_MAPPING_CANDIDATE_CREATED",
      objectType: "FIELD_MAPPING_CANDIDATE",
      objectId: created.id,
      riskLevel: created.confidence === "HIGH" ? "R1" : "R2",
      clientId: created.clientId,
      runId: created.runId,
      metadata: {
        source: created.source,
        targetField: created.targetField,
        confidence: created.confidence,
        inputSummary: "字段映射候选已创建，人工确认前不得生效",
      },
    });

    return created;
  }

  async confirmCandidate(input: {
    actor: ActorContext;
    candidateId: string;
    targetField?: string;
    fieldCategory?: string;
    confidence?: Exclude<ConfidenceBand, "LOW" | "CONFLICT">;
    rationale: string;
    evidenceRefs?: string[];
    templateSourceRef?: string;
  }): Promise<FieldMappingVersionRecord> {
    const candidate = await this.requireCandidate(input.candidateId);
    const run = await this.requireWritableRun(candidate.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    if (candidate.status !== "CANDIDATE") {
      throw new MappingServiceError("FIELD_MAPPING_CANDIDATE_NOT_REVIEWABLE");
    }

    const confidence = input.confidence ?? candidate.confidence;
    if (confidence === "LOW" || confidence === "CONFLICT") {
      throw new MappingServiceError("LOW_CONFIDENCE_MAPPING_REQUIRES_MANUAL_TARGET");
    }
    const targetField = (input.targetField ?? candidate.targetField).trim();
    if (!targetField) {
      throw new MappingServiceError("FIELD_MAPPING_TARGET_REQUIRED");
    }

    const now = new Date();
    const version = await this.store.confirmCandidateWithVersion({
      candidateId: candidate.id,
      expectedStatus: "CANDIDATE",
      version: {
        ...candidate,
        id: randomUUID(),
        candidateId: candidate.id,
        source: "MANUAL",
        status: "CONFIRMED",
        targetField,
        fieldCategory: input.fieldCategory ?? candidate.fieldCategory,
        confidence,
        rationale: input.rationale.trim(),
        evidenceRefs: input.evidenceRefs ?? candidate.evidenceRefs,
        templateSourceRef: input.templateSourceRef ?? null,
        confirmedById: input.actor.id,
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });
    if (!version) {
      throw new MappingServiceError("FIELD_MAPPING_CANDIDATE_NOT_REVIEWABLE");
    }
    await this.auditService.record({
      actor: input.actor,
      action: "FIELD_MAPPING_VERSION_CONFIRMED",
      objectType: "FIELD_MAPPING_VERSION",
      objectId: version.id,
      riskLevel: "R2",
      clientId: version.clientId,
      runId: version.runId,
      metadata: {
        candidateId: candidate.id,
        targetField: version.targetField,
        confidence: version.confidence,
        inputSummary: "人工确认后生成 FieldMappingVersion；历史模板或 Agent 候选未自动生效",
      },
    });

    return version;
  }

  private async requireCandidate(id: string) {
    const candidate = await this.store.findCandidateById(id);
    if (!candidate) {
      throw new MappingServiceError("FIELD_MAPPING_CANDIDATE_NOT_FOUND");
    }
    return candidate;
  }

  private async requireWritableRun(runId: string) {
    const run = await this.store.findRunById(runId);
    if (!run) {
      throw new MappingServiceError("PAYROLL_RUN_NOT_FOUND");
    }
    if (HISTORY_STATUSES.has(run.status) || run.lockedAt) {
      throw new MappingServiceError("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    return run;
  }
}

function assertCandidateScope(candidate: { clientId: string }, runClientId: string) {
  if (candidate.clientId !== runClientId) {
    throw new MappingServiceError("FIELD_MAPPING_RUN_SCOPE_MISMATCH");
  }
}

export class MappingServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MappingServiceError";
  }
}
