import {
  assertClientActionAllowed,
  type ActorContext,
  visibleClientIdsForActor,
} from "@/domain/auth/permissions";
import { type AuditAction, type AuditLogRecord } from "@/domain/audit/audit-service";

export type AuditQueryFilters = {
  clientId?: string;
  runId?: string;
  action?: AuditAction;
  actorEmail?: string;
  from?: Date;
  to?: Date;
};

export type AuditQueryResult = {
  logs: AuditLogRecord[];
  truncated: boolean;
};

export type ExportAuditCheckInput = {
  actor: ActorContext;
  clientId: string;
  purpose: string;
};

export function filterAuditLogs(
  logs: AuditLogRecord[],
  filters: AuditQueryFilters,
  limit = 100,
): AuditQueryResult {
  const filtered = logs.filter((log) => {
    if (filters.clientId && log.clientId !== filters.clientId) {
      return false;
    }

    if (filters.runId && log.runId !== filters.runId) {
      return false;
    }

    if (filters.action && log.action !== filters.action) {
      return false;
    }

    if (filters.actorEmail && log.actorEmail !== filters.actorEmail) {
      return false;
    }

    if (filters.from && log.createdAt < filters.from) {
      return false;
    }

    if (filters.to && log.createdAt > filters.to) {
      return false;
    }

    return true;
  });

  const sorted = filtered.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  return {
    logs: sorted.slice(0, limit),
    truncated: sorted.length > limit,
  };
}

export function filterVisibleAuditLogs(
  actor: ActorContext,
  logs: AuditLogRecord[],
  allClientIds: string[],
  filters: AuditQueryFilters,
  limit = 100,
): AuditQueryResult {
  const visibleClientIds = new Set(visibleClientIdsForActor(actor, allClientIds));
  const visibleLogs = logs.filter((log) => {
    if (!log.clientId) {
      return false;
    }

    return visibleClientIds.has(log.clientId);
  });

  if (filters.clientId) {
    assertClientActionAllowed(actor, "viewAudit", filters.clientId);
  }

  return filterAuditLogs(visibleLogs, filters, limit);
}

export function assertAuditExportAllowed(input: ExportAuditCheckInput): void {
  assertClientActionAllowed(input.actor, "viewAudit", input.clientId);

  if (!input.purpose.trim()) {
    throw new AuditQueryError("AUDIT_EXPORT_PURPOSE_REQUIRED");
  }
}

export class AuditQueryError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "AuditQueryError";
  }
}
