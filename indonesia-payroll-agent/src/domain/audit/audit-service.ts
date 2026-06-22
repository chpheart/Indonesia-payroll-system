import { randomUUID } from "node:crypto";
import { type ActorContext } from "@/domain/auth/permissions";

export const AUDIT_ACTIONS = [
  "CLIENT_CREATED",
  "CLIENT_ENABLED",
  "CLIENT_DISABLED",
  "CLIENT_DELETE_REJECTED",
  "CLIENT_ACCESS_GRANTED",
  "CLIENT_ACCESS_REVOKED",
  "CLIENT_CONFIG_VERSION_CREATED",
  "EMPLOYEE_CREATED",
  "EMPLOYEE_DISABLED",
  "EMPLOYEE_STATUS_UPDATED",
  "EMPLOYEE_DELETE_REJECTED",
  "EMPLOYEE_MASTER_VERSION_CREATED",
  "SENSITIVE_FIELD_REVEALED",
  "SENSITIVE_FIELD_COPIED",
  "PAYROLL_RUN_CREATED",
  "PAYROLL_RUN_STATUS_CHANGED",
  "PAYROLL_RUN_REOPENED",
  "RUN_ASSIGNMENT_CHANGED",
  "RUN_REMINDER_COMPLETED",
  "EXPORT_CREATED",
  "PAYROLL_RUN_LOCKED",
  "HIGH_RISK_RELEASED",
  "RULE_VERSION_PUBLISHED",
  "CORRECTION_RUN_CREATED",
  "RAW_INPUT_CREATED",
  "RAW_INPUT_BOUND",
  "RAW_INPUT_STATUS_CHANGED",
  "FILE_UPLOADED",
  "FILE_PARSE_COMPLETED",
  "FILE_PARSE_BLOCKED",
  "CASE_ITEM_CREATED",
  "CASE_ITEM_RESOLVED",
  "PAYROLL_COMPONENT_CREATED",
  "CLIENT_COMPONENT_ALIAS_VERSION_CREATED",
  "RULE_VERSION_DRAFTED",
  "RULE_VERSION_APPROVED",
  "RULE_VERSION_DISABLED",
  "FX_RATE_VERSION_CREATED",
  "FX_RATE_VERSION_CONFIRMED",
  "REGRESSION_RUN_RECORDED",
  "AGENT_RUN_CREATED",
  "CHANGE_PROPOSAL_CREATED",
  "CHANGE_PROPOSAL_REVIEWED",
  "CHANGE_LEDGER_ENTRY_CREATED",
  "FIELD_MAPPING_CANDIDATE_CREATED",
  "FIELD_MAPPING_VERSION_CONFIRMED",
  "STANDARDIZED_INPUT_PREVIEW_CREATED",
  "STANDARDIZED_INPUT_CONFIRMED",
  "EMPLOYEE_MATCH_CANDIDATE_CREATED",
  "EMPLOYEE_MATCH_CONFIRMED",
  "EVIDENCE_CREATED",
  "EVIDENCE_LINKED",
  "EVIDENCE_FILE_VIEWED",
  "QUESTION_ITEM_CREATED",
  "QUESTION_STATUS_CHANGED",
  "CUSTOMER_CONFIRMATION_PACK_CREATED",
  "CUSTOMER_CONFIRMATION_PACK_UPDATED",
  "CUSTOMER_CONFIRMATION_RECORDED",
  "CUSTOMER_CONFIRMATION_INVALIDATED",
] as const;

export const AUDIT_OBJECT_TYPES = [
  "USER",
  "CLIENT",
  "CLIENT_CONFIG_VERSION",
  "EMPLOYEE",
  "EMPLOYEE_MASTER_VERSION",
  "PAYROLL_RUN",
  "EXPORT_FILE",
  "RULE_VERSION",
  "PAYROLL_COMPONENT",
  "CLIENT_COMPONENT_ALIAS",
  "FX_RATE_VERSION",
  "REGRESSION_RUN",
  "CORRECTION_RUN",
  "SENSITIVE_FIELD",
  "RAW_INPUT_ITEM",
  "UPLOADED_FILE_VERSION",
  "WORKBOOK_PARSE",
  "CASE_ITEM",
  "AGENT_RUN",
  "AGENT_STEP",
  "TOOL_INVOCATION",
  "GUARDRAIL_RESULT",
  "AGENT_OUTPUT_REVIEW",
  "CHANGE_PROPOSAL",
  "CHANGE_LEDGER_ENTRY",
  "FIELD_MAPPING_CANDIDATE",
  "FIELD_MAPPING_VERSION",
  "STANDARDIZED_PAYROLL_INPUT",
  "EMPLOYEE_MATCH_CANDIDATE",
  "EVIDENCE",
  "EVIDENCE_LINK",
  "QUESTION_ITEM",
  "CUSTOMER_CONFIRMATION_PACK",
  "CUSTOMER_CONFIRMATION_PACK_ITEM",
  "CUSTOMER_CONFIRMATION",
] as const;

export const AUDIT_RISK_LEVELS = ["R0", "R1", "R2", "R3", "R4"] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditObjectType = (typeof AUDIT_OBJECT_TYPES)[number];
export type AuditRiskLevel = (typeof AUDIT_RISK_LEVELS)[number];

export type AuditMetadataValue =
  | string
  | number
  | boolean
  | null
  | AuditMetadataValue[]
  | { [key: string]: AuditMetadataValue };

export type AuditMetadata = Record<string, AuditMetadataValue>;

export type AuditLogRecord = {
  id: string;
  action: AuditAction;
  objectType: AuditObjectType;
  objectId: string;
  riskLevel: AuditRiskLevel;
  actorUserId: string;
  actorEmail: string;
  actorRoleCodes: string[];
  clientId?: string;
  runId?: string;
  purpose?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata: AuditMetadata;
  createdAt: Date;
  corrections: AuditCorrectionRecord[];
};

export type AuditCorrectionRecord = {
  id: string;
  auditLogId: string;
  note: string;
  createdById: string;
  createdByEmail: string;
  createdAt: Date;
};

export type CreateAuditLogInput = {
  actor: ActorContext;
  action: AuditAction;
  objectType: AuditObjectType;
  objectId: string;
  riskLevel: AuditRiskLevel;
  clientId?: string;
  runId?: string;
  purpose?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: AuditMetadata;
};

export type AppendAuditCorrectionInput = {
  actor: ActorContext;
  auditLogId: string;
  note: string;
};

export type AuditLogStore = {
  createAuditLog(record: AuditLogRecord): Promise<AuditLogRecord>;
  appendAuditCorrection(record: AuditCorrectionRecord): Promise<AuditCorrectionRecord>;
  findAuditLogById(id: string): Promise<AuditLogRecord | null>;
};

export class AuditLogImmutableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditLogImmutableError";
  }
}

export class AuditService {
  constructor(private readonly store: AuditLogStore) {}

  async record(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    const record: AuditLogRecord = {
      id: randomUUID(),
      action: input.action,
      objectType: input.objectType,
      objectId: input.objectId,
      riskLevel: input.riskLevel,
      actorUserId: input.actor.id,
      actorEmail: input.actor.email,
      actorRoleCodes: input.actor.roleCodes,
      clientId: input.clientId,
      runId: input.runId,
      purpose: input.purpose,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
      corrections: [],
    };

    return this.store.createAuditLog(record);
  }

  async appendCorrection(input: AppendAuditCorrectionInput): Promise<AuditCorrectionRecord> {
    const auditLog = await this.store.findAuditLogById(input.auditLogId);

    if (!auditLog) {
      throw new AuditLogImmutableError("AUDIT_LOG_NOT_FOUND");
    }

    const note = input.note.trim();
    if (!note) {
      throw new AuditLogImmutableError("AUDIT_CORRECTION_NOTE_REQUIRED");
    }

    return this.store.appendAuditCorrection({
      id: randomUUID(),
      auditLogId: auditLog.id,
      note,
      createdById: input.actor.id,
      createdByEmail: input.actor.email,
      createdAt: new Date(),
    });
  }
}

export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly auditLogs = new Map<string, AuditLogRecord>();

  async createAuditLog(record: AuditLogRecord): Promise<AuditLogRecord> {
    const stored = structuredClone(record);
    this.auditLogs.set(stored.id, stored);
    return structuredClone(stored);
  }

  async appendAuditCorrection(
    record: AuditCorrectionRecord,
  ): Promise<AuditCorrectionRecord> {
    const auditLog = this.auditLogs.get(record.auditLogId);
    if (!auditLog) {
      throw new AuditLogImmutableError("AUDIT_LOG_NOT_FOUND");
    }

    const stored = structuredClone(record);
    auditLog.corrections = [...auditLog.corrections, stored];
    this.auditLogs.set(auditLog.id, structuredClone(auditLog));
    return structuredClone(stored);
  }

  async findAuditLogById(id: string): Promise<AuditLogRecord | null> {
    const auditLog = this.auditLogs.get(id);
    return auditLog ? structuredClone(auditLog) : null;
  }

  async listAuditLogs(): Promise<AuditLogRecord[]> {
    return Array.from(this.auditLogs.values()).map((auditLog) => structuredClone(auditLog));
  }
}
