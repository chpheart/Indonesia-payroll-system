import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type AuditService } from "@/domain/audit/audit-service";
import { type CaseItemStatus, type CaseItemType } from "@/domain/intake/intake-service";

export type CaseItemRecord = {
  id: string;
  clientId?: string | null;
  runId?: string | null;
  rawInputItemId?: string | null;
  fileVersionId?: string | null;
  type: CaseItemType;
  riskLevel: "R1" | "R2" | "R3";
  status: CaseItemStatus;
  title: string;
  detail: string;
  ownerId?: string | null;
  resolvedById?: string | null;
  resolutionNote?: string | null;
};

export type IntakeCaseStore = {
  createCaseItem(input: Omit<CaseItemRecord, "id" | "status">): Promise<CaseItemRecord>;
  findCaseItemById(id: string): Promise<CaseItemRecord | null>;
  resolveCaseItem(input: {
    id: string;
    resolvedById: string;
    resolutionNote: string;
  }): Promise<CaseItemRecord>;
};

export class IntakeCaseService {
  constructor(
    private readonly store: IntakeCaseStore,
    private readonly auditService: AuditService,
  ) {}

  async createCase(input: {
    actor: ActorContext;
    clientId?: string | null;
    runId?: string | null;
    rawInputItemId?: string | null;
    fileVersionId?: string | null;
    type: CaseItemType;
    riskLevel: "R1" | "R2" | "R3";
    title: string;
    detail: string;
    ownerId?: string | null;
  }): Promise<CaseItemRecord> {
    if (input.clientId) {
      assertClientActionAllowed(input.actor, "updatePayrollRun", input.clientId);
    }

    const record = await this.store.createCaseItem({
      clientId: input.clientId,
      runId: input.runId,
      rawInputItemId: input.rawInputItemId,
      fileVersionId: input.fileVersionId,
      type: input.type,
      riskLevel: input.riskLevel,
      title: input.title,
      detail: input.detail,
      ownerId: input.ownerId,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CASE_ITEM_CREATED",
      objectType: "CASE_ITEM",
      objectId: record.id,
      riskLevel: record.riskLevel,
      clientId: record.clientId ?? undefined,
      runId: record.runId ?? undefined,
      metadata: {
        type: record.type,
        title: record.title,
        inputSummary: "创建 intake/case 队列项，阻断或待处理事项不得被静默跳过",
      },
    });

    return record;
  }

  async resolveCase(input: {
    actor: ActorContext;
    caseItemId: string;
    resolutionNote: string;
  }): Promise<CaseItemRecord> {
    const existing = await this.store.findCaseItemById(input.caseItemId);
    if (!existing) {
      throw new IntakeCaseServiceError("CASE_ITEM_NOT_FOUND");
    }

    if (existing.clientId) {
      assertClientActionAllowed(input.actor, "updatePayrollRun", existing.clientId);
    }

    const note = input.resolutionNote.trim();
    if (!note) {
      throw new IntakeCaseServiceError("CASE_RESOLUTION_NOTE_REQUIRED");
    }

    const record = await this.store.resolveCaseItem({
      id: existing.id,
      resolvedById: input.actor.id,
      resolutionNote: note,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CASE_ITEM_RESOLVED",
      objectType: "CASE_ITEM",
      objectId: record.id,
      riskLevel: record.riskLevel,
      clientId: record.clientId ?? undefined,
      runId: record.runId ?? undefined,
      metadata: {
        type: record.type,
        resolutionNote: note,
      },
    });

    return record;
  }
}

export class IntakeCaseServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "IntakeCaseServiceError";
  }
}
