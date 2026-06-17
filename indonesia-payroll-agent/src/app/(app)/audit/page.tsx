import { AUDIT_ACTIONS } from "@/domain/audit/audit-service";
import {
  assertClientActionAllowed,
  isSystemAdmin,
  isRoleCode,
  type ActorContext,
} from "@/domain/auth/permissions";
import { ROLE_CODES } from "@/domain/auth/permissions";
import { AuditLogDetail } from "@/app/(app)/audit/audit-log-detail";
import { currentActor } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function normalizeSearchParams(searchParams?: PageProps["searchParams"]) {
  const resolved = searchParams ? await searchParams : {};
  const clientId = resolved.clientId;
  const runId = resolved.runId;
  const action = resolved.action;
  const actorEmail = resolved.actorEmail;
  const employee = resolved.employee;
  const roleCode = resolved.roleCode;
  const from = resolved.from;
  const to = resolved.to;

  return {
    clientId: Array.isArray(clientId) ? clientId[0] : clientId,
    runId: Array.isArray(runId) ? runId[0] : runId,
    action: Array.isArray(action) ? action[0] : action,
    actorEmail: Array.isArray(actorEmail) ? actorEmail[0] : actorEmail,
    employee: Array.isArray(employee) ? employee[0] : employee,
    roleCode: Array.isArray(roleCode) ? roleCode[0] : roleCode,
    from: Array.isArray(from) ? from[0] : from,
    to: Array.isArray(to) ? to[0] : to,
  };
}

function dateFilter(value?: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function loadAuditLogs(actor: ActorContext, filters: {
  clientId?: string;
  runId?: string;
  action?: string;
  actorEmail?: string;
  employee?: string;
  roleCode?: string;
  from?: string;
  to?: string;
}) {
  try {
    if (filters.clientId) {
      assertClientActionAllowed(actor, "viewAudit", filters.clientId);
    }
    const action = AUDIT_ACTIONS.includes(filters.action as (typeof AUDIT_ACTIONS)[number])
      ? (filters.action as (typeof AUDIT_ACTIONS)[number])
      : undefined;
    const roleCode = filters.roleCode && isRoleCode(filters.roleCode) ? filters.roleCode : undefined;
    const from = dateFilter(filters.from);
    const to = dateFilter(filters.to);
    const clientScope = filters.clientId
      ? filters.clientId
      : isSystemAdmin(actor)
        ? undefined
        : actor.authorizedClientIds;
    const logs = await prisma.auditLog.findMany({
      where: {
        clientId: Array.isArray(clientScope)
          ? { in: clientScope }
          : clientScope
            ? clientScope
            : undefined,
        runId: filters.runId || undefined,
        action,
        actorEmail: filters.actorEmail || undefined,
        actorRoleCodes: roleCode ? { has: roleCode } : undefined,
        createdAt: from || to ? { gte: from, lte: to } : undefined,
      },
      include: {
        client: { select: { code: true, name: true } },
        corrections: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const employeeQuery = filters.employee?.trim().toLowerCase();
    const filteredLogs = employeeQuery
      ? logs.filter((log) => auditLogMatchesEmployee(log, employeeQuery))
      : logs;

    return { logs: filteredLogs, error: null };
  } catch (error) {
    return {
      logs: [],
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}

function auditLogMatchesEmployee(
  log: { objectId: string; metadata: unknown },
  query: string,
) {
  return `${log.objectId} ${JSON.stringify(log.metadata)}`.toLowerCase().includes(query);
}

export default async function AuditPage({ searchParams }: PageProps) {
  const actor = await currentActor();
  const filters = await normalizeSearchParams(searchParams);
  const { logs, error } = await loadAuditLogs(actor, filters);

  return (
    <div className="page-stack">
      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">SCREEN-013</p>
            <h2>审计日志</h2>
          </div>
          <span className="risk-badge r3">不可编辑 / 不可删除</span>
        </div>
        <form className="filter-bar" action="/audit">
          <input
            aria-label="客户 ID"
            name="clientId"
            placeholder="clientId"
            defaultValue={filters.clientId ?? ""}
          />
          <input
            aria-label="Run ID"
            name="runId"
            placeholder="runId"
            defaultValue={filters.runId ?? ""}
          />
          <select aria-label="动作类型" name="action" defaultValue={filters.action ?? ""}>
            <option value="">全部动作</option>
            {AUDIT_ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action}
              </option>
            ))}
          </select>
          <input
            aria-label="操作者"
            name="actorEmail"
            placeholder="actor@example.com"
            defaultValue={filters.actorEmail ?? ""}
          />
          <input
            aria-label="员工关键字"
            name="employee"
            placeholder="员工 ID / 员工编号"
            defaultValue={filters.employee ?? ""}
          />
          <select aria-label="角色" name="roleCode" defaultValue={filters.roleCode ?? ""}>
            <option value="">全部角色</option>
            {ROLE_CODES.map((roleCode) => (
              <option key={roleCode} value={roleCode}>
                {roleCode}
              </option>
            ))}
          </select>
          <input
            aria-label="开始时间"
            name="from"
            type="datetime-local"
            defaultValue={filters.from ?? ""}
          />
          <input
            aria-label="结束时间"
            name="to"
            type="datetime-local"
            defaultValue={filters.to ?? ""}
          />
          <button type="submit">查询</button>
        </form>
        <p className="section-note">
          高影响事件、敏感明文查看、导出、锁定、放行、规则发布和 correction run 都必须在这里留痕。
        </p>
        {error ? <div className="alert error">数据库不可用：{error}</div> : null}
        {logs.length === 0 && !error ? (
          <div className="empty-state">没有匹配的审计事件。</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>动作</th>
                  <th>对象</th>
                  <th>操作者</th>
                  <th>客户 / Run</th>
                  <th>更正说明</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.createdAt.toISOString()}</td>
                    <td>
                      <span className={`risk-badge ${log.riskLevel.toLowerCase()}`}>
                        {log.riskLevel}
                      </span>
                      <span className="stacked-text">{log.action}</span>
                    </td>
                    <td>
                      <strong>{log.objectType}</strong>
                      <span>{log.objectId}</span>
                    </td>
                    <td>
                      <strong>{log.actorEmail}</strong>
                      <span>{log.actorRoleCodes.join(", ")}</span>
                    </td>
                    <td>
                      <span className="stacked-text">
                        {log.client ? `${log.client.code} · ${log.client.name}` : "-"}
                      </span>
                      <span className="stacked-text">run：{log.runId ?? "-"}</span>
                    </td>
                    <td>
                      <AuditLogDetail log={log} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
