import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type AuditService } from "@/domain/audit/audit-service";
import {
  actionRequiredForRunTransition,
  riskLevelForRunTransition,
} from "@/domain/payroll-runs/run-transition-permissions";
import {
  assertValidRunTransition,
  targetStatusForRunImpact,
  type PayrollRunStatus,
  type RunChangeSourceType,
  type RunGateCounts,
} from "@/domain/payroll-runs/run-state-machine";

export type RunAssignmentRole = "DELIVERY_OWNER" | "PAYROLL_OWNER" | "APPROVAL_OWNER";
export type RunReminderType =
  | "INTAKE_ASSIGNMENT"
  | "PROPOSAL_REVIEW"
  | "BLOCKING_ISSUE"
  | "HIGH_RISK_REVIEW"
  | "CUSTOMER_CONFIRMATION"
  | "OVERDUE"
  | "STAGE_ACTION";

export type PayrollRunRecord = RunGateCounts & {
  id: string;
  clientId: string;
  payrollMonth: string;
  status: PayrollRunStatus;
  statusReason?: string | null;
  targetCompletionDate?: Date | null;
  payDate?: Date | null;
  pendingIntakeAssignmentCount: number;
  pendingProposalReviewCount: number;
};

export type RunStatusEventDraft = {
  runId: string;
  fromStatus?: PayrollRunStatus | null;
  toStatus: PayrollRunStatus;
  sourceType: RunChangeSourceType;
  reason: string;
  impactedObjectType?: string;
  impactedObjectId?: string;
  triggeredById?: string;
  metadata?: Record<string, unknown>;
};

export type PayrollRunStore = {
  findRunById(id: string): Promise<PayrollRunRecord | null>;
  findClientById(id: string): Promise<{ id: string } | null>;
  createRun(input: {
    clientId: string;
    payrollMonth: string;
    targetCompletionDate?: Date;
    payDate?: Date;
    createdById: string;
  }): Promise<PayrollRunRecord>;
  updateRunStatus(input: {
    runId: string;
    status: PayrollRunStatus;
    statusReason: string;
  }): Promise<PayrollRunRecord>;
  createStatusEvent(input: RunStatusEventDraft): Promise<void>;
  assignRun(input: {
    runId: string;
    role: RunAssignmentRole;
    userId: string;
    assignedById: string;
  }): Promise<void>;
  completeReminder(input: {
    reminderId: string;
    actorId: string;
  }): Promise<{ id: string; runId: string; type: RunReminderType }>;
};

export class PayrollRunService {
  constructor(
    private readonly store: PayrollRunStore,
    private readonly auditService: AuditService,
  ) {}

  async createRun(input: {
    actor: ActorContext;
    clientId: string;
    payrollMonth: string;
    targetCompletionDate?: Date;
    payDate?: Date;
  }): Promise<PayrollRunRecord> {
    assertClientActionAllowed(input.actor, "createPayrollRun", input.clientId);
    assertPayrollMonth(input.payrollMonth);

    const client = await this.store.findClientById(input.clientId);
    if (!client) {
      throw new PayrollRunServiceError("CLIENT_NOT_FOUND");
    }

    const run = await this.store.createRun({
      clientId: input.clientId,
      payrollMonth: input.payrollMonth,
      targetCompletionDate: input.targetCompletionDate,
      payDate: input.payDate,
      createdById: input.actor.id,
    });

    await this.store.createStatusEvent({
      runId: run.id,
      fromStatus: null,
      toStatus: run.status,
      sourceType: "MANUAL_STAGE_ROLLBACK",
      reason: "Payroll run created in draft state",
      triggeredById: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "PAYROLL_RUN_CREATED",
      objectType: "PAYROLL_RUN",
      objectId: run.id,
      riskLevel: "R1",
      clientId: run.clientId,
      runId: run.id,
      metadata: {
        payrollMonth: run.payrollMonth,
        inputSummary: "新建客户月度 payroll run，不触发算薪或导出",
        outputSummary: "run 已进入草稿状态，等待 intake 和映射确认",
      },
    });

    return run;
  }

  async transitionRun(input: {
    actor: ActorContext;
    runId: string;
    toStatus: PayrollRunStatus;
    reason: string;
    sourceType?: RunChangeSourceType;
  }): Promise<PayrollRunRecord> {
    const run = await this.requireRun(input.runId);
    assertClientActionAllowed(
      input.actor,
      actionRequiredForRunTransition(run.status, input.toStatus),
      run.clientId,
    );
    assertValidRunTransition(run.status, input.toStatus, run);

    const reason = input.reason.trim();
    if (!reason) {
      throw new PayrollRunServiceError("PAYROLL_RUN_STATUS_REASON_REQUIRED");
    }

    const updated = await this.store.updateRunStatus({
      runId: run.id,
      status: input.toStatus,
      statusReason: reason,
    });

    await this.store.createStatusEvent({
      runId: run.id,
      fromStatus: run.status,
      toStatus: updated.status,
      sourceType: input.sourceType ?? "MANUAL_STAGE_ROLLBACK",
      reason,
      triggeredById: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "PAYROLL_RUN_STATUS_CHANGED",
      objectType: "PAYROLL_RUN",
      objectId: run.id,
      riskLevel: riskLevelForRunTransition(run.status, updated.status),
      clientId: run.clientId,
      runId: run.id,
      metadata: { fromStatus: run.status, toStatus: updated.status, reason },
    });

    return updated;
  }

  async rollbackForImpact(input: {
    actor: ActorContext;
    runId: string;
    sourceType: RunChangeSourceType;
    reason: string;
    impactedObjectType?: string;
    impactedObjectId?: string;
    invalidatedResultScope: string;
  }): Promise<PayrollRunRecord> {
    const run = await this.requireRun(input.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    const targetStatus = targetStatusForRunImpact(run.status, input.sourceType);
    const reason = input.reason.trim();
    if (!reason) {
      throw new PayrollRunServiceError("PAYROLL_RUN_ROLLBACK_REASON_REQUIRED");
    }

    if (targetStatus === run.status) {
      return run;
    }

    const updated = await this.store.updateRunStatus({
      runId: run.id,
      status: targetStatus,
      statusReason: reason,
    });

    await this.store.createStatusEvent({
      runId: run.id,
      fromStatus: run.status,
      toStatus: targetStatus,
      sourceType: input.sourceType,
      reason,
      impactedObjectType: input.impactedObjectType,
      impactedObjectId: input.impactedObjectId,
      triggeredById: input.actor.id,
      metadata: { invalidatedResultScope: input.invalidatedResultScope },
    });

    await this.auditService.record({
      actor: input.actor,
      action: "PAYROLL_RUN_REOPENED",
      objectType: "PAYROLL_RUN",
      objectId: run.id,
      riskLevel: "R2",
      clientId: run.clientId,
      runId: run.id,
      metadata: {
        fromStatus: run.status,
        toStatus: targetStatus,
        sourceType: input.sourceType,
        impactedObjectType: input.impactedObjectType ?? null,
        impactedObjectId: input.impactedObjectId ?? null,
        invalidatedResultScope: input.invalidatedResultScope,
        reason,
      },
    });

    return updated;
  }

  async assignRun(input: {
    actor: ActorContext;
    runId: string;
    role: RunAssignmentRole;
    userId: string;
  }): Promise<void> {
    const run = await this.requireRun(input.runId);
    assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);
    await this.store.assignRun({
      runId: run.id,
      role: input.role,
      userId: input.userId,
      assignedById: input.actor.id,
    });
    await this.auditService.record({
      actor: input.actor,
      action: "RUN_ASSIGNMENT_CHANGED",
      objectType: "PAYROLL_RUN",
      objectId: run.id,
      riskLevel: "R1",
      clientId: run.clientId,
      runId: run.id,
      metadata: { role: input.role, assignedUserId: input.userId },
    });
  }

  private async requireRun(runId: string): Promise<PayrollRunRecord> {
    const run = await this.store.findRunById(runId);
    if (!run) {
      throw new PayrollRunServiceError("PAYROLL_RUN_NOT_FOUND");
    }

    return run;
  }
}

export function assertPayrollMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new PayrollRunServiceError("PAYROLL_MONTH_INVALID");
  }
}

export class PayrollRunServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PayrollRunServiceError";
  }
}
