import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";
import { STATUS_LABELS } from "@/app/(app)/payroll-runs/dashboard-data";
import { prisma } from "@/lib/db/prisma";

const STAGE_NAMES = [
  "Intake 归属",
  "文件",
  "Proposal",
  "映射",
  "标准化",
  "追问 / 证据",
  "客户确认",
  "预检查",
  "算薪",
  "确认包",
  "导出",
  "归档",
] as const;

const STATUS_STAGE_INDEX: Record<PayrollRunStatus, number> = {
  DRAFT: 0,
  PENDING_MAPPING_CONFIRMATION: 3,
  PENDING_STANDARDIZATION_CONFIRMATION: 4,
  PENDING_CUSTOMER_CONFIRMATION: 6,
  PENDING_PRECHECK: 7,
  PENDING_CALCULATION: 8,
  PENDING_HIGH_RISK_RELEASE: 8,
  PENDING_PAYROLL_CONFIRMATION: 9,
  LOCKED: 10,
  EXPORTED: 11,
  ARCHIVED: 11,
  VOIDED: 0,
  CORRECTED: 11,
};

const NEXT_STATUS: Partial<Record<PayrollRunStatus, PayrollRunStatus>> = {
  DRAFT: "PENDING_MAPPING_CONFIRMATION",
  PENDING_MAPPING_CONFIRMATION: "PENDING_STANDARDIZATION_CONFIRMATION",
  PENDING_STANDARDIZATION_CONFIRMATION: "PENDING_CUSTOMER_CONFIRMATION",
  PENDING_CUSTOMER_CONFIRMATION: "PENDING_PRECHECK",
  PENDING_PRECHECK: "PENDING_CALCULATION",
  PENDING_HIGH_RISK_RELEASE: "PENDING_PAYROLL_CONFIRMATION",
  PENDING_PAYROLL_CONFIRMATION: "LOCKED",
  LOCKED: "EXPORTED",
  EXPORTED: "ARCHIVED",
};

export async function loadRunDetail(actor: ActorContext, runId: string) {
  try {
    const run = await prisma.payrollRun.findUnique({
      where: { id: runId },
      include: {
        client: { select: { id: true, code: true, name: true } },
        assignments: {
          where: { releasedAt: null },
          include: { user: { select: { id: true, displayName: true, email: true } } },
          orderBy: { assignedAt: "desc" },
        },
        reminders: {
          where: { status: "OPEN" },
          orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
        },
        statusEvents: {
          include: { triggeredBy: { select: { displayName: true, email: true } } },
          orderBy: { createdAt: "desc" },
          take: 15,
        },
        auditLogs: {
          orderBy: { createdAt: "desc" },
          take: 15,
        },
        payrollResults: {
          where: { status: "FINAL" },
          orderBy: [{ calculatedAt: "desc" }, { employeeId: "asc" }],
          take: 50,
          include: {
            _count: { select: { lines: true, traces: true } },
          },
        },
      },
    });

    if (!run) {
      return { run: null, stages: [], nextStatus: null, timeline: [], error: null };
    }

    assertClientActionAllowed(actor, "viewClient", run.clientId);
    const stageIndex = STATUS_STAGE_INDEX[run.status];
    const stages = STAGE_NAMES.map((name, index) => ({
      name,
      index: index + 1,
      state:
        index < stageIndex
          ? "done"
          : index === stageIndex && run.blockingIssueCount > 0
            ? "blocked"
            : index === stageIndex
              ? "current"
              : "future",
    }));
    const timeline = [
      ...run.statusEvents.map((event) => ({
        id: event.id,
        action: `${event.fromStatus ?? "创建"} → ${STATUS_LABELS[event.toStatus]}`,
        actor: event.triggeredBy?.displayName ?? event.triggeredBy?.email ?? "系统",
        createdAt: event.createdAt.toLocaleString("zh-CN"),
        detail: event.reason,
      })),
      ...run.auditLogs.map((audit) => ({
        id: audit.id,
        action: audit.action,
        actor: audit.actorEmail,
        createdAt: audit.createdAt.toLocaleString("zh-CN"),
        detail: audit.purpose ?? undefined,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const nextStatus =
      run.status === "PENDING_CALCULATION" && run.highRiskIssueCount > 0
        ? "PENDING_HIGH_RISK_RELEASE"
        : NEXT_STATUS[run.status] ?? null;

    return {
      run,
      stages,
      nextStatus,
      timeline,
      error: null,
    };
  } catch (error) {
    return {
      run: null,
      stages: [],
      nextStatus: null,
      timeline: [],
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}
