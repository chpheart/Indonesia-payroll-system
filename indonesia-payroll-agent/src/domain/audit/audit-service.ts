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
  "EXPORT_CREATED",
  "PAYROLL_RUN_LOCKED",
  "HIGH_RISK_RELEASED",
  "RULE_VERSION_PUBLISHED",
  "CORRECTION_RUN_CREATED",
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
  "CORRECTION_RUN",
  "SENSITIVE_FIELD",
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
