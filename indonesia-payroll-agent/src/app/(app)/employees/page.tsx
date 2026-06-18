import {
  actorHasPermission,
  assertClientActionAllowed,
  isSystemAdmin,
  type ActorContext,
} from "@/domain/auth/permissions";
import { maskEmployeeSensitiveFields } from "@/domain/employees/employee-service";
import { currentActor } from "@/app/(app)/server-actor";
import {
  createEmployeeAction,
  createEmployeeMasterVersionAction,
  deleteEmployeeAction,
} from "@/app/(app)/employees/actions";
import { EmployeeStatusAction } from "@/app/(app)/employees/employee-status-action";
import { RevealSensitiveFieldForm } from "@/app/(app)/employees/reveal-sensitive-field-form";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

async function normalizeSearchParams(searchParams?: PageProps["searchParams"]) {
  const resolved = searchParams ? await searchParams : {};
  const q = resolved.q;
  const clientId = resolved.clientId;

  return {
    q: Array.isArray(q) ? q[0] : q,
    clientId: Array.isArray(clientId) ? clientId[0] : clientId,
  };
}

async function loadEmployees(actor: ActorContext, filters: { q?: string; clientId?: string }) {
  try {
    if (filters.clientId) {
      assertClientActionAllowed(actor, "viewEmployee", filters.clientId);
    }
    const clientScope = filters.clientId
      ? filters.clientId
      : isSystemAdmin(actor)
        ? undefined
        : actor.authorizedClientIds;
    const employees = await prisma.employee.findMany({
      where: {
        clientId: Array.isArray(clientScope)
          ? { in: clientScope }
          : clientScope
            ? clientScope
            : undefined,
        OR: filters.q
          ? [
              { employeeCode: { contains: filters.q, mode: "insensitive" } },
              { fullName: { contains: filters.q, mode: "insensitive" } },
              { nikOrPassport: { contains: filters.q, mode: "insensitive" } },
              { npwp: { contains: filters.q, mode: "insensitive" } },
            ]
          : undefined,
      },
      include: {
        client: { select: { code: true, name: true } },
        masterVersions: {
          orderBy: { versionNumber: "desc" },
          take: 2,
        },
      },
      orderBy: [{ clientId: "asc" }, { employeeCode: "asc" }],
      take: 100,
    });
    const clients = await prisma.client.findMany({
      where: isSystemAdmin(actor) ? undefined : { id: { in: actor.authorizedClientIds } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    });

    return { clients, employees, error: null };
  } catch (error) {
    return {
      clients: [],
      employees: [],
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}

function jsonSummary(value: unknown) {
  if (!value || typeof value !== "object") {
    return "-";
  }

  const keys = Object.keys(value as Record<string, unknown>);
  return keys.length > 0 ? keys.join(", ") : "-";
}

export default async function EmployeesPage({ searchParams }: PageProps) {
  const actor = await currentActor();
  const canEditEmployees = actorHasPermission(actor, "employee.edit");
  const filters = await normalizeSearchParams(searchParams);
  const { clients, employees, error } = await loadEmployees(actor, filters);

  return (
    <div className="page-stack">
      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">SCREEN-010</p>
            <h2>员工主档</h2>
          </div>
          <span className="risk-badge r1">R1 默认脱敏</span>
        </div>
        <form className="filter-bar" action="/employees">
          <input
            aria-label="搜索员工"
            name="q"
            placeholder="按姓名、员工 ID、NIK/护照、NPWP 搜索"
            defaultValue={filters.q ?? ""}
          />
          <input
            aria-label="客户 ID"
            name="clientId"
            placeholder="clientId"
            defaultValue={filters.clientId ?? ""}
          />
          <button type="submit">筛选</button>
        </form>
        <p className="section-note">
          明文查看必须二次确认 purpose 并写入审计；关键字段变更先生成待确认版本，不会静默写入当前主档。
        </p>
        {canEditEmployees ? (
          <form className="inline-form" action={createEmployeeAction}>
            <select name="clientId" aria-label="客户" required>
              <option value="">选择授权客户</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} · {client.name}
                </option>
              ))}
            </select>
            <input name="employeeCode" placeholder="员工唯一 ID" aria-label="员工唯一 ID" required />
            <input name="fullName" placeholder="员工姓名" aria-label="员工姓名" required />
            <button type="submit">新建员工</button>
          </form>
        ) : null}
        {error ? <div className="alert error">数据库不可用：{error}</div> : null}
        {employees.length === 0 && !error ? (
          <div className="empty-state">没有匹配员工。未授权客户的数据不会返回。</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>员工</th>
                  <th>客户</th>
                  <th>敏感字段</th>
                  <th>状态</th>
                  <th>主档版本</th>
                  <th>受控动作</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => {
                  const masked = maskEmployeeSensitiveFields(employee);
                  return (
                    <tr key={employee.id}>
                      <td>
                        <strong>{employee.employeeCode}</strong>
                        <span>{employee.fullName}</span>
                      </td>
                      <td>
                        <strong>{employee.client.code}</strong>
                        <span>{employee.client.name}</span>
                      </td>
                      <td>
                        <span className="stacked-text">NIK/护照：{masked.nikOrPassport ?? "-"}</span>
                        <span className="stacked-text">NPWP：{masked.npwp ?? "-"}</span>
                        <span className="stacked-text">
                          银行账号：{masked.bankAccountNumber ?? "-"}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${employee.status.toLowerCase()}`}>
                          {employee.status}
                        </span>
                      </td>
                      <td>
                        {employee.masterVersions.length > 0
                          ? employee.masterVersions.map((version) => (
                              <span className="stacked-text" key={version.id}>
                                v{version.versionNumber} · {version.effectiveMonth} ·{" "}
                                {version.status} · 差异：{jsonSummary(version.changedFields)}
                              </span>
                            ))
                          : "暂无版本"}
                      </td>
                      <td>
                        {canEditEmployees ? (
                          <div className="action-stack">
                            <EmployeeStatusAction employeeId={employee.id} status={employee.status} />
                            <form action={deleteEmployeeAction}>
                              <input type="hidden" name="employeeId" value={employee.id} />
                              <button disabled={employee.hasHistoricalPayroll} type="submit">
                                删除误建
                              </button>
                            </form>
                            <details className="employee-details">
                              <summary>打开主档详情 / 生成版本</summary>
                              <div className="detail-panel">
                                <h3>
                                  {employee.fullName} · {employee.employeeCode}
                                </h3>
                                <dl>
                                  <dt>客户</dt>
                                  <dd>
                                    {employee.client.code} · {employee.client.name}
                                  </dd>
                                  <dt>状态</dt>
                                  <dd>{employee.status}</dd>
                                  <dt>NIK/护照</dt>
                                  <dd>{masked.nikOrPassport ?? "-"}</dd>
                                  <dt>NPWP</dt>
                                  <dd>{masked.npwp ?? "-"}</dd>
                                  <dt>银行账号</dt>
                                  <dd>{masked.bankAccountNumber ?? "-"}</dd>
                                </dl>
                                <h4>版本历史</h4>
                                {employee.masterVersions.length > 0
                                  ? employee.masterVersions.map((version) => (
                                      <span className="stacked-text" key={version.id}>
                                        v{version.versionNumber} · {version.effectiveMonth} ·{" "}
                                        {version.status} · 证据 {version.evidenceRefs.length} 条
                                      </span>
                                    ))
                                  : "暂无版本"}
                                <h4>查看敏感明文</h4>
                                <RevealSensitiveFieldForm employeeId={employee.id} />
                                <h4>生成待确认主档版本</h4>
                                <form
                                  action={createEmployeeMasterVersionAction}
                                  className="mini-version-form"
                                >
                                  <input type="hidden" name="employeeId" value={employee.id} />
                                  <input
                                    aria-label="主档生效月份"
                                    name="effectiveMonth"
                                    placeholder="YYYY-MM"
                                    required
                                  />
                                  <input
                                    aria-label="证据引用"
                                    name="evidenceRefs"
                                    placeholder="关键字段必填：证据 ID，逗号分隔"
                                    required
                                  />
                                  <input
                                    aria-label="变更理由"
                                    name="changeReason"
                                    placeholder="主档变更理由"
                                    required
                                  />
                                  <textarea
                                    aria-label="变更字段 JSON"
                                    name="changedFieldsJson"
                                    placeholder='{"status":{"from":"ACTIVE","to":"TERMINATED"}}'
                                    required
                                  />
                                  <textarea
                                    aria-label="主档快照 JSON"
                                    name="snapshotJson"
                                    placeholder='{"bankAccountNumber":"1234","npwp":"..."}'
                                    required
                                  />
                                  <button type="submit">生成待确认版本</button>
                                </form>
                              </div>
                            </details>
                          </div>
                        ) : (
                          <span className="stacked-text">当前角色无员工编辑权限</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
