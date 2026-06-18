import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type AuditService } from "@/domain/audit/audit-service";
import {
  detectInstructionLikeContent,
  evidenceCandidateRefForRawInput,
  hashRawInputContent,
  summarizeRawInput,
} from "@/domain/intake/raw-input-redaction";
import {
  type CaseItemType,
  type RawInputSourceChannel,
  type RawInputStatus,
  type RawInputType,
} from "@/domain/intake/intake-types";

export {
  CASE_ITEM_STATUSES,
  CASE_ITEM_TYPES,
  RAW_INPUT_SOURCE_CHANNELS,
  RAW_INPUT_STATUSES,
  RAW_INPUT_TYPES,
} from "@/domain/intake/intake-types";
export type {
  CaseItemStatus,
  CaseItemType,
  RawInputSourceChannel,
  RawInputStatus,
  RawInputType,
} from "@/domain/intake/intake-types";

export type RawInputRecord = {
  id: string;
  clientId?: string | null;
  payrollMonth?: string | null;
  runId?: string | null;
  sourceChannel: RawInputSourceChannel;
  inputType: RawInputType;
  status: RawInputStatus;
  originalText?: string | null;
  redactedSummary: string;
  contentHash?: string | null;
  duplicateGroupHash?: string | null;
  duplicateRiskScore: number;
  evidenceCandidateRefs: string[];
  securityFlags: string[];
  createdById?: string | null;
};

export type CaseItemDraft = {
  clientId?: string | null;
  runId?: string | null;
  rawInputItemId?: string | null;
  type: CaseItemType;
  title: string;
  detail: string;
  riskLevel: "R1" | "R2" | "R3";
  metadata?: Record<string, unknown>;
};

export type RawInputDraft = Omit<
  RawInputRecord,
  "id" | "evidenceCandidateRefs" | "createdById"
> & {
  createdById: string;
};

export type IntakeStore = {
  findRunById(id: string): Promise<{ id: string; clientId: string; payrollMonth: string } | null>;
  findDuplicateRawInput(input: {
    contentHash: string;
    clientId?: string | null;
    payrollMonth?: string | null;
  }): Promise<RawInputRecord | null>;
  createRawInput(input: RawInputDraft): Promise<RawInputRecord>;
  updateRawInput(input: {
    id: string;
    clientId?: string | null;
    payrollMonth?: string | null;
    runId?: string | null;
    status?: RawInputStatus;
    evidenceCandidateRefs?: string[];
  }): Promise<RawInputRecord>;
  createCaseItem(input: CaseItemDraft): Promise<void>;
};

export class IntakeService {
  constructor(
    private readonly store: IntakeStore,
    private readonly auditService: AuditService,
  ) {}

  async createRawInput(input: {
    actor: ActorContext;
    sourceChannel: RawInputSourceChannel;
    inputType: RawInputType;
    originalText: string;
    clientId?: string | null;
    payrollMonth?: string | null;
    runId?: string | null;
  }): Promise<RawInputRecord> {
    const binding = await this.resolveBinding(input);
    if (binding.clientId) {
      assertClientActionAllowed(input.actor, "updatePayrollRun", binding.clientId);
    }

    const originalText = input.originalText.trim();
    if (!originalText) {
      throw new IntakeServiceError("RAW_INPUT_TEXT_REQUIRED");
    }

    const contentHash = hashRawInputContent(originalText);
    const duplicate = await this.store.findDuplicateRawInput({
      contentHash,
      clientId: binding.clientId,
      payrollMonth: binding.payrollMonth,
    });
    const securityFlags = detectInstructionLikeContent(originalText);
    const isAssigned = Boolean(binding.clientId && binding.payrollMonth);
    const record = await this.store.createRawInput({
      clientId: binding.clientId,
      payrollMonth: binding.payrollMonth,
      runId: binding.runId,
      sourceChannel: input.sourceChannel,
      inputType: input.inputType,
      status: isAssigned ? "PENDING_EXTRACTION" : "PENDING_ASSIGNMENT",
      originalText,
      redactedSummary: summarizeRawInput(originalText),
      contentHash,
      duplicateGroupHash: duplicate?.contentHash ?? null,
      duplicateRiskScore: duplicate ? 1 : 0,
      securityFlags,
      createdById: input.actor.id,
    });
    const withEvidenceRef = await this.store.updateRawInput({
      id: record.id,
      evidenceCandidateRefs: [evidenceCandidateRefForRawInput(record.id)],
    });

    await this.auditService.record({
      actor: input.actor,
      action: "RAW_INPUT_CREATED",
      objectType: "RAW_INPUT_ITEM",
      objectId: withEvidenceRef.id,
      riskLevel: "R1",
      clientId: withEvidenceRef.clientId ?? undefined,
      runId: withEvidenceRef.runId ?? undefined,
      metadata: {
        inputType: withEvidenceRef.inputType,
        sourceChannel: withEvidenceRef.sourceChannel,
        status: withEvidenceRef.status,
        securityFlags,
        duplicateRiskScore: withEvidenceRef.duplicateRiskScore,
        inputSummary: "保存原始输入为不可信 evidence 候选，不触发生效变更",
      },
    });

    await this.createDerivedCases(withEvidenceRef, duplicate, securityFlags);

    return withEvidenceRef;
  }

  async bindRawInput(input: {
    actor: ActorContext;
    rawInputItemId: string;
    clientId: string;
    payrollMonth: string;
    runId?: string | null;
  }): Promise<RawInputRecord> {
    assertClientActionAllowed(input.actor, "updatePayrollRun", input.clientId);
    const run = input.runId ? await this.store.findRunById(input.runId) : null;

    if (input.runId && !run) {
      throw new IntakeServiceError("PAYROLL_RUN_NOT_FOUND");
    }

    if (run && (run.clientId !== input.clientId || run.payrollMonth !== input.payrollMonth)) {
      throw new IntakeServiceError("RAW_INPUT_BINDING_MISMATCH");
    }

    const record = await this.store.updateRawInput({
      id: input.rawInputItemId,
      clientId: input.clientId,
      payrollMonth: input.payrollMonth,
      runId: input.runId ?? null,
      status: "PENDING_EXTRACTION",
    });

    await this.auditService.record({
      actor: input.actor,
      action: "RAW_INPUT_BOUND",
      objectType: "RAW_INPUT_ITEM",
      objectId: record.id,
      riskLevel: "R1",
      clientId: record.clientId ?? undefined,
      runId: record.runId ?? undefined,
      metadata: {
        payrollMonth: record.payrollMonth ?? null,
        inputSummary: "原始输入归属到客户/月度/run，仍只作为待抽取 evidence 候选",
      },
    });

    return record;
  }

  private async resolveBinding(input: {
    runId?: string | null;
    clientId?: string | null;
    payrollMonth?: string | null;
  }) {
    if (!input.runId) {
      return {
        clientId: input.clientId ?? null,
        payrollMonth: input.payrollMonth ?? null,
        runId: null,
      };
    }

    const run = await this.store.findRunById(input.runId);
    if (!run) {
      throw new IntakeServiceError("PAYROLL_RUN_NOT_FOUND");
    }

    if (input.clientId && input.clientId !== run.clientId) {
      throw new IntakeServiceError("RAW_INPUT_BINDING_MISMATCH");
    }

    if (input.payrollMonth && input.payrollMonth !== run.payrollMonth) {
      throw new IntakeServiceError("RAW_INPUT_BINDING_MISMATCH");
    }

    return { clientId: run.clientId, payrollMonth: run.payrollMonth, runId: run.id };
  }

  private async createDerivedCases(
    record: RawInputRecord,
    duplicate: RawInputRecord | null,
    securityFlags: string[],
  ) {
    if (!record.clientId || !record.payrollMonth) {
      await this.store.createCaseItem({
        clientId: record.clientId,
        runId: record.runId,
        rawInputItemId: record.id,
        type: "INTAKE_UNASSIGNED",
        title: "原始输入未完成客户/月度归属",
        detail: "未归属输入不得进入 ChangeProposal、映射、算薪或导出流程。",
        riskLevel: "R1",
      });
    }

    if (duplicate) {
      await this.store.createCaseItem({
        clientId: record.clientId,
        runId: record.runId,
        rawInputItemId: record.id,
        type: "DUPLICATE_RISK",
        title: "检测到重复原始输入",
        detail: `与 ${duplicate.id} 的内容 hash 相同，保留证据但需要人工确认是否重复处理。`,
        riskLevel: "R1",
        metadata: { duplicateRawInputItemId: duplicate.id },
      });
    }

    if (securityFlags.length > 0) {
      await this.store.createCaseItem({
        clientId: record.clientId,
        runId: record.runId,
        rawInputItemId: record.id,
        type: "SECURITY_REVIEW",
        title: "原始输入包含疑似指令类内容",
        detail: "客户文本或文件内容只能作为数据处理，不得改变系统规则、权限或工具调用边界。",
        riskLevel: "R2",
        metadata: { securityFlags },
      });
    }
  }
}

export class IntakeServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "IntakeServiceError";
  }
}
