import {
  assertClientActionAllowed,
  isSystemAdmin,
  type ActorContext,
} from "@/domain/auth/permissions";
import {
  PAYROLL_RUN_STATUSES,
  type PayrollRunStatus,
} from "@/domain/payroll-runs/run-state-machine";
import { prisma } from "@/lib/db/prisma";

export type PayrollRunsSearchParams = Promise<Record<string, string | string[] | undefined>>;

export const STATUS_LABELS: Record<PayrollRunStatus, string> = {
  DRAFT: "草稿",
  PENDING_MAPPING_CONFIRMATION: "待映射确认",
  PENDING_STANDARDIZATION_CONFIRMATION: "待标准化确认",
  PENDING_CUSTOMER_CONFIRMATION: "待客户确认",
  PENDING_PRECHECK: "待预检查",
  PENDING_CALCULATION: "待算薪",
  PENDING_PAYROLL_CONFIRMATION: "待算薪确认",
  PENDING_HIGH_RISK_RELEASE: "待高风险放行",
  LOCKED: "已锁定",
  EXPORTED: "已导出",
  ARCHIVED: "已归档",
  VOIDED: "已作废",
  CORRECTED: "已更正",
};

const CLOSED_STATUSES: PayrollRunStatus[] = [
  "LOCKED",
  "EXPORTED",
  "ARCHIVED",
  "VOIDED",
  "CORRECTED",
];

export async function normalizeRunSearchParams(searchParams?: PayrollRunsSearchParams) {
  const resolved = searchParams ? await searchParams : {};
  const pick = (key: string) => {
    const value = resolved[key];
    return Array.isArray(value) ? value[0] : value;
  };

  return {
    clientId: pick("clientId"),
    payrollMonth: pick("payrollMonth"),
    status: pick("status"),
    ownerId: pick("ownerId"),
    risk: pick("risk"),
  };
}

export function formatShortDate(value?: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

export function statusClass(status: PayrollRunStatus) {
  if (["LOCKED", "EXPORTED", "ARCHIVED"].includes(status)) {
    return "active";
  }
  if (["VOIDED", "CORRECTED"].includes(status)) {
    return "disabled";
  }
  if (["PENDING_HIGH_RISK_RELEASE", "PENDING_PRECHECK"].includes(status)) {
    return "terminated";
  }
  return "draft";
}

function scopedClientFilter(actor: ActorContext, clientId?: string) {
  if (clientId) {
    assertClientActionAllowed(actor, "viewClient", clientId);
    return clientId;
  }

  return isSystemAdmin(actor) ? undefined : actor.authorizedClientIds;
}

export async function loadRunDashboard(
  actor: ActorContext,
  filters: Awaited<ReturnType<typeof normalizeRunSearchParams>>,
) {
  try {
    const clientScope = scopedClientFilter(actor, filters.clientId);
    const selectedStatus = PAYROLL_RUN_STATUSES.includes(filters.status as PayrollRunStatus)
      ? (filters.status as PayrollRunStatus)
      : undefined;
    const where = {
      clientId: Array.isArray(clientScope)
        ? { in: clientScope }
        : clientScope
          ? clientScope
          : undefined,
      payrollMonth: filters.payrollMonth || undefined,
      status: selectedStatus ?? { notIn: CLOSED_STATUSES },
      assignments: filters.ownerId
        ? { some: { userId: filters.ownerId, releasedAt: null } }
        : undefined,
      OR:
        filters.risk === "blocking"
          ? [{ blockingIssueCount: { gt: 0 } }]
          : filters.risk === "high"
            ? [{ highRiskIssueCount: { gt: 0 } }]
            : undefined,
    };

    const [clients, users, runs, aggregate] = await Promise.all([
      prisma.client.findMany({
        where: isSystemAdmin(actor) ? undefined : { id: { in: actor.authorizedClientIds } },
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.user.findMany({
        where: { status: "ACTIVE" },
        orderBy: { displayName: "asc" },
        select: { id: true, displayName: true, email: true },
      }),
      prisma.payrollRun.findMany({
        where,
        include: {
          client: { select: { code: true, name: true } },
          assignments: {
            where: { releasedAt: null },
            include: { user: { select: { id: true, displayName: true, email: true } } },
            orderBy: { assignedAt: "desc" },
          },
          reminders: {
            where: { status: "OPEN" },
            orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }],
            take: 2,
          },
        },
        orderBy: [
          { blockingIssueCount: "desc" },
          { highRiskIssueCount: "desc" },
          { targetCompletionDate: "asc" },
          { createdAt: "desc" },
        ],
        take: 100,
      }),
      prisma.payrollRun.aggregate({
        where,
        _count: { _all: true },
        _sum: {
          pendingIntakeAssignmentCount: true,
          pendingProposalReviewCount: true,
          blockingIssueCount: true,
          highRiskIssueCount: true,
          pendingCustomerConfirmationCount: true,
        },
      }),
    ]);
    const today = new Date();
    const overdue = runs.filter(
      (run) =>
        run.targetCompletionDate &&
        run.targetCompletionDate < today &&
        !["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(run.status),
    ).length;

    return { clients, users, runs, aggregate, overdue, error: null };
  } catch (error) {
    return {
      clients: [],
      users: [],
      runs: [],
      aggregate: null,
      overdue: 0,
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}
