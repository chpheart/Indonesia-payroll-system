import { actorHasPermission, isSystemAdmin, type ActorContext } from "@/domain/auth/permissions";
import { currentActor } from "@/app/(app)/server-actor";
import {
  createClientAction,
  createClientConfigVersionAction,
  deleteClientAction,
  grantClientAccessAction,
  revokeClientAccessAction,
  updateClientStatusAction,
} from "@/app/(app)/clients/actions";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

async function loadClients(actor: ActorContext) {
  try {
    const [clients, users, roles] = await Promise.all([
      prisma.client.findMany({
        where: isSystemAdmin(actor)
          ? undefined
          : {
              id: { in: actor.authorizedClientIds },
            },
        include: {
          accesses: {
            where: { status: "ACTIVE" },
            include: {
              user: { select: { displayName: true, email: true } },
              role: { select: { code: true, name: true } },
            },
            orderBy: { grantedAt: "desc" },
          },
          configVersions: {
            orderBy: { versionNumber: "desc" },
            take: 3,
          },
        },
        orderBy: { code: "asc" },
      }),
      actorHasPermission(actor, "users.manage")
        ? prisma.user.findMany({
            where: { status: "ACTIVE" },
            orderBy: { email: "asc" },
            select: { id: true, email: true, displayName: true },
          })
        : Promise.resolve([]),
      actorHasPermission(actor, "users.manage")
        ? prisma.role.findMany({
            orderBy: { code: "asc" },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    return { clients, users, roles, error: null };
  } catch (error) {
    return {
      clients: [],
      users: [],
      roles: [],
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}

function statusLabel(status: "ACTIVE" | "DISABLED") {
  return status === "ACTIVE" ? "启用" : "停用";
}

export default async function ClientsPage() {
  const actor = await currentActor();
  const canEditClients = actorHasPermission(actor, "client.edit");
  const canManageUsers = actorHasPermission(actor, "users.manage");
  const { clients, users, roles, error } = await loadClients(actor);

  return (
    <div className="page-stack">
      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">SCREEN-010</p>
            <h2>客户主档与授权</h2>
          </div>
          <span className="risk-badge r1">R1 客户数据读写</span>
        </div>
        <p className="section-note">
          有历史 payroll 的客户不得物理删除，只能停用；客户授权独立于角色权限。
        </p>
        {canEditClients ? (
          <form className="inline-form" action={createClientAction}>
            <input name="code" placeholder="客户编码" aria-label="客户编码" required />
            <input name="name" placeholder="客户名称" aria-label="客户名称" required />
            <input
              name="legalEntityName"
              placeholder="法定主体，可选"
              aria-label="法定主体"
            />
            <button type="submit">新建客户</button>
          </form>
        ) : null}
        {error ? <div className="alert error">数据库不可用：{error}</div> : null}
        {clients.length === 0 && !error ? (
          <div className="empty-state">没有授权客户，或当前筛选范围内还没有客户。</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>客户</th>
                  <th>状态</th>
                  <th>授权用户</th>
                  <th>配置版本</th>
                  <th>删除规则</th>
                  <th>受控动作</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr key={client.id}>
                    <td>
                      <strong>{client.code}</strong>
                      <span>{client.name}</span>
                    </td>
                    <td>
                      <span className={`status-pill ${client.status.toLowerCase()}`}>
                        {statusLabel(client.status)}
                      </span>
                    </td>
                    <td>
                      {client.accesses.length > 0
                        ? client.accesses.map((access) => (
                            <div className="stacked-text" key={access.id}>
                              {access.user.displayName} · {access.role?.name ?? "客户授权"}
                              {canManageUsers ? (
                                <form action={revokeClientAccessAction} className="inline-action">
                                  <input type="hidden" name="accessId" value={access.id} />
                                  <input type="hidden" name="clientId" value={client.id} />
                                  <button type="submit">撤销</button>
                                </form>
                              ) : null}
                            </div>
                          ))
                        : "未授权"}
                      {canManageUsers ? (
                        <form action={grantClientAccessAction} className="mini-version-form">
                          <input type="hidden" name="clientId" value={client.id} />
                          <select aria-label="授权用户" name="userId" required>
                            <option value="">选择用户</option>
                            {users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.displayName} · {user.email}
                              </option>
                            ))}
                          </select>
                          <select aria-label="授权角色标签" name="roleId" required>
                            <option value="">选择角色标签</option>
                            {roles.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name} · {role.code}
                              </option>
                            ))}
                          </select>
                          <button type="submit">授予访问</button>
                        </form>
                      ) : null}
                    </td>
                    <td>
                      {client.configVersions.length > 0
                        ? client.configVersions.map((version) => (
                            <span className="stacked-text" key={version.id}>
                              v{version.versionNumber} · {version.effectiveMonth} · {version.status}
                            </span>
                          ))
                        : "暂无配置版本"}
                    </td>
                    <td>
                      {client.hasHistoricalPayroll ? (
                        <span className="risk-badge r2">只能停用</span>
                      ) : (
                        <span className="risk-badge neutral">可删除误建草稿</span>
                      )}
                    </td>
                    <td>
                      {canEditClients ? (
                        <div className="action-stack">
                          <form action={updateClientStatusAction}>
                            <input type="hidden" name="clientId" value={client.id} />
                            <input
                              type="hidden"
                              name="status"
                              value={client.status === "ACTIVE" ? "DISABLED" : "ACTIVE"}
                            />
                            <button type="submit">
                              {client.status === "ACTIVE" ? "停用客户" : "重新启用"}
                            </button>
                          </form>
                          <form action={deleteClientAction}>
                            <input type="hidden" name="clientId" value={client.id} />
                            <button disabled={client.hasHistoricalPayroll} type="submit">
                              删除误建
                            </button>
                          </form>
                          <form
                            action={createClientConfigVersionAction}
                            className="mini-version-form"
                          >
                            <input type="hidden" name="clientId" value={client.id} />
                            <input
                              aria-label="配置生效月份"
                              name="effectiveMonth"
                              placeholder="YYYY-MM"
                              required
                            />
                            <input
                              aria-label="发薪日"
                              name="payrollDay"
                              placeholder="发薪日"
                              type="number"
                              min="1"
                              max="31"
                            />
                            <input
                              aria-label="模板编码"
                              name="templateCode"
                              placeholder="模板编码"
                            />
                            <input
                              aria-label="证据引用"
                              name="evidenceRefs"
                              placeholder="证据 ID，逗号分隔"
                            />
                            <input
                              aria-label="变更理由"
                              name="changeReason"
                              placeholder="配置变更理由"
                              required
                            />
                            <label className="checkbox-line">
                              <input name="grossUpDefault" type="checkbox" />
                              Gross Up 默认
                            </label>
                            <button type="submit">生成配置版本</button>
                          </form>
                        </div>
                      ) : (
                        <span className="stacked-text">当前角色无客户编辑权限</span>
                      )}
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
