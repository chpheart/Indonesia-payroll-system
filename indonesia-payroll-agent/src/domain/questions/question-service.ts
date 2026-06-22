import { randomUUID } from "node:crypto";
import { type AuditService } from "@/domain/audit/audit-service";
import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";

export const QUESTION_SOURCES = [
  "AGENT",
  "PRECHECK",
  "CHANGE_PROPOSAL_REVIEW",
  "CUSTOMER_REPLY",
  "MANUAL",
] as const;

export const QUESTION_STATUSES = [
  "PENDING",
  "SENT_TO_CUSTOMER",
  "WAITING_CUSTOMER_REPLY",
  "EVIDENCE_BACKFILLED",
  "RESOLVED",
  "CLOSED",
] as const;

export type QuestionSource = (typeof QUESTION_SOURCES)[number];
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export type QuestionBlockingResolutionStatus = "NONE" | "RESOLVED" | "UNRESOLVED" | "UNKNOWN";

export type QuestionItemRecord = {
  id: string;
  clientId: string;
  runId: string;
  rawInputItemId?: string | null;
  changeProposalId?: string | null;
  source: QuestionSource;
  status: QuestionStatus;
  riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  title: string;
  detail: string;
  reason: string;
  impactSummary: string;
  targetObjectType?: string | null;
  targetObjectId?: string | null;
  targetField?: string | null;
  blockingIssueRef?: string | null;
  dueAt?: Date | null;
  requiredEvidenceTypes: string[];
  evidenceRefs: string[];
  resolutionNote?: string | null;
  createdById?: string | null;
  resolvedById?: string | null;
  closedById?: string | null;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type QuestionStatusEventRecord = {
  id: string;
  questionId: string;
  fromStatus?: QuestionStatus | null;
  toStatus: QuestionStatus;
  changedById?: string | null;
  evidenceId?: string | null;
  reason: string;
  createdAt: Date;
};

export type QuestionStore = {
  findRunById(id: string): Promise<{ id: string; clientId: string } | null>;
  createQuestion(input: QuestionItemRecord): Promise<QuestionItemRecord>;
  findQuestionById(id: string): Promise<QuestionItemRecord | null>;
  updateQuestion(input: QuestionItemRecord): Promise<QuestionItemRecord>;
  createQuestionStatusEvent(input: QuestionStatusEventRecord): Promise<QuestionStatusEventRecord>;
};

const ALLOWED_TRANSITIONS: Record<QuestionStatus, QuestionStatus[]> = {
  PENDING: ["SENT_TO_CUSTOMER", "WAITING_CUSTOMER_REPLY", "EVIDENCE_BACKFILLED", "CLOSED"],
  SENT_TO_CUSTOMER: ["WAITING_CUSTOMER_REPLY", "EVIDENCE_BACKFILLED", "CLOSED"],
  WAITING_CUSTOMER_REPLY: ["EVIDENCE_BACKFILLED", "CLOSED"],
  EVIDENCE_BACKFILLED: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export class QuestionService {
  constructor(
    private readonly store: QuestionStore,
    private readonly auditService: AuditService,
  ) {}

  async createQuestion(input: {
    actor: ActorContext;
    draft: Omit<
      QuestionItemRecord,
      | "id"
      | "status"
      | "createdById"
      | "resolvedById"
      | "closedById"
      | "resolvedAt"
      | "closedAt"
      | "createdAt"
      | "updatedAt"
    >;
  }): Promise<QuestionItemRecord> {
    const run = await this.store.findRunById(input.draft.runId);
    if (!run) {
      throw new QuestionServiceError("PAYROLL_RUN_NOT_FOUND");
    }
    if (run.clientId !== input.draft.clientId) {
      throw new QuestionServiceError("QUESTION_RUN_SCOPE_MISMATCH");
    }
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    assertQuestionText(input.draft);

    const now = new Date();
    const question = await this.store.createQuestion({
      ...input.draft,
      id: randomUUID(),
      status: "PENDING",
      createdById: input.actor.id,
      resolvedById: null,
      closedById: null,
      resolvedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.store.createQuestionStatusEvent({
      id: randomUUID(),
      questionId: question.id,
      fromStatus: null,
      toStatus: "PENDING",
      changedById: input.actor.id,
      reason: "追问创建",
      createdAt: now,
    });
    await this.auditService.record({
      actor: input.actor,
      action: "QUESTION_ITEM_CREATED",
      objectType: "QUESTION_ITEM",
      objectId: question.id,
      riskLevel: question.riskLevel,
      clientId: question.clientId,
      runId: question.runId,
      metadata: {
        source: question.source,
        targetField: question.targetField ?? "",
        inputSummary: "追问已创建；低置信和缺证据不得编造结论",
      },
    });

    return question;
  }

  async transitionQuestion(input: {
    actor: ActorContext;
    questionId: string;
    toStatus: QuestionStatus;
    reason: string;
    evidenceRef?: string;
    evidenceId?: string;
    resolutionNote?: string;
  }): Promise<QuestionItemRecord> {
    const question = await this.store.findQuestionById(input.questionId);
    if (!question) {
      throw new QuestionServiceError("QUESTION_NOT_FOUND");
    }
    assertClientActionAllowed(input.actor, "updatePayrollRun", question.clientId);
    assertQuestionTransitionAllowed(question.status, input.toStatus);
    assertQuestionResolutionAllowed({
      question,
      toStatus: input.toStatus,
      evidenceRef: input.evidenceRef,
      resolutionNote: input.resolutionNote,
      verifiedEvidenceCount: 0,
      blockingStatus: input.toStatus === "RESOLVED" ? "UNKNOWN" : "NONE",
    });

    const now = new Date();
    const evidenceRefs = input.evidenceRef
      ? Array.from(new Set([...question.evidenceRefs, input.evidenceRef]))
      : question.evidenceRefs;
    const updated = await this.store.updateQuestion({
      ...question,
      status: input.toStatus,
      evidenceRefs,
      resolutionNote: input.resolutionNote?.trim() || (question.resolutionNote ?? null),
      resolvedById: input.toStatus === "RESOLVED" ? input.actor.id : question.resolvedById ?? null,
      resolvedAt: input.toStatus === "RESOLVED" ? now : question.resolvedAt ?? null,
      closedById: input.toStatus === "CLOSED" ? input.actor.id : question.closedById ?? null,
      closedAt: input.toStatus === "CLOSED" ? now : question.closedAt ?? null,
      updatedAt: now,
    });

    await this.store.createQuestionStatusEvent({
      id: randomUUID(),
      questionId: question.id,
      fromStatus: question.status,
      toStatus: input.toStatus,
      changedById: input.actor.id,
      evidenceId: input.evidenceId ?? null,
      reason: input.reason.trim(),
      createdAt: now,
    });
    await this.auditService.record({
      actor: input.actor,
      action: "QUESTION_STATUS_CHANGED",
      objectType: "QUESTION_ITEM",
      objectId: question.id,
      riskLevel: question.riskLevel,
      clientId: question.clientId,
      runId: question.runId,
      metadata: {
        fromStatus: question.status,
        toStatus: input.toStatus,
        evidenceRef: input.evidenceRef ?? "",
      },
    });

    return updated;
  }
}

export function assertQuestionTransitionAllowed(fromStatus: QuestionStatus, toStatus: QuestionStatus): void {
  if (!ALLOWED_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new QuestionServiceError("QUESTION_STATUS_TRANSITION_NOT_ALLOWED");
  }
}

export function assertQuestionResolutionAllowed(input: {
  question: Pick<QuestionItemRecord, "blockingIssueRef" | "evidenceRefs">;
  toStatus: QuestionStatus;
  evidenceRef?: string;
  resolutionNote?: string;
  verifiedEvidenceCount?: number;
  blockingStatus?: QuestionBlockingResolutionStatus;
}): void {
  const finalStatus = input.toStatus === "RESOLVED" || input.toStatus === "CLOSED";
  if (!finalStatus) {
    return;
  }
  const hasBlockingIssue = Boolean(input.question.blockingIssueRef?.trim());
  if (input.toStatus === "RESOLVED" || hasBlockingIssue) {
    if (!input.resolutionNote?.trim()) {
      throw new QuestionServiceError("QUESTION_RESOLUTION_NOTE_REQUIRED");
    }
  }

  if (!hasBlockingIssue) {
    return;
  }

  if (input.blockingStatus !== "RESOLVED") {
    throw new QuestionServiceError("QUESTION_BLOCKING_ISSUE_UNRESOLVED");
  }
  if ((input.verifiedEvidenceCount ?? 0) < 1) {
    throw new QuestionServiceError("QUESTION_BLOCKING_EVIDENCE_REQUIRED");
  }
  const hasEvidence = Boolean(input.evidenceRef?.trim()) || input.question.evidenceRefs.length > 0;
  if (!hasEvidence) {
    throw new QuestionServiceError("QUESTION_BLOCKING_EVIDENCE_REQUIRED");
  }
}

export function isQuestionStatus(value: string): value is QuestionStatus {
  return QUESTION_STATUSES.includes(value as QuestionStatus);
}

function assertQuestionText(input: Pick<QuestionItemRecord, "title" | "detail" | "reason" | "impactSummary">) {
  if (!input.title.trim() || !input.detail.trim() || !input.reason.trim() || !input.impactSummary.trim()) {
    throw new QuestionServiceError("QUESTION_REQUIRED_FIELDS_MISSING");
  }
}

export class QuestionServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "QuestionServiceError";
  }
}
