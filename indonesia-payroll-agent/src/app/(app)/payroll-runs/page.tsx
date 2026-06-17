import Link from "next/link";
import { actorHasPermission } from "@/domain/auth/permissions";
import { PAYROLL_RUN_STATUSES } from "@/domain/payroll-runs/run-state-machine";
import { createPayrollRunAction } from "@/app/(app)/payroll-runs/actions";
import {
  formatShortDate,
  loadRunDashboard,
  normalizeRunSearchParams,
  statusClass,
  STATUS_LABELS,
  type PayrollRunsSearchParams,
} from "@/app/(app)/payroll-runs/dashboard-data";
import { currentActor } from "@/app/(app)/server-actor";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: PayrollRunsSearchParams;
};

function reminderAnchor(type: string) {
  switch (type) {
    case "INTAKE_ASSIGNMENT":
      return "intake-assignment";
    case "PROPOSAL_REVIEW":
      return "proposal-review";
    case "BLOCKING_ISSUE":
      return "precheck";
    case "HIGH_RISK_REVIEW":
      return "payroll-confirmation";
    case "CUSTOMER_CONFIRMATION":
      return "customer-confirmation";
    default:
      return "run-entrypoints";
  }
}

export default async function PayrollRunsPage({ searchParams }: PageProps) {
  const actor = await currentActor();
  const filters = await normalizeRunSearchParams(searchParams);
  const canCreateRun = actorHasPermission(actor, "payrollRun.create");
  const { clients, users, runs, aggregate, overdue, error } = await loadRunDashboard(actor, filters);
  const metricValues = [
    ["待处理 Run", aggregate?._count._all ?? 0, "需要推进"],
    ["待 intake 归属", aggregate?._sum.pendingIntakeAssignmentCount ?? 0, "未绑定客户/月度"],
    ["待 proposal 审核", aggregate?._sum.pendingProposalReviewCount ?? 0, "不能自动生效"],
    ["阻断项", aggregate?._sum.blockingIssueCount ?? 0, "跨 run 影响"],
    ["高风险项", aggregate?._sum.highRiskIssueCount ?? 0, "需人工复核"],
    ["待客户确认", aggregate?._sum.pendingCustomerConfirmationCount ?? 0, "确认包缺口"],
    ["逾期任务", overdue, "已过截止日"],
  ];

  return (
    <div className="dashboard-grid">
      <section className="dashboard-main">
        <div className="metric-grid run-metrics" aria-label="任务台指标">
          {metricValues.map(([label, value, note]) => (
            <div className="metric-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
              <p>{note}</p>
            </div>
          ))}
        </div>
        <section className="content-section">
          <div className="section-header">
            <div>
              <p className="eyebrow">SCREEN-001</p>
              <h2>Payroll Runs</h2>
            </div>
            <span className="section-meta">排序：阻断 ↓ · 高风险 ↓ · 截止日 ↑</span>
          </div>
          <form className="filter-bar run-filter" action="/payroll-runs">
            <select name="clientId" aria-label="客户筛选" defaultValue={filters.clientId ?? ""}>
              <option value="">全部客户</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} · {client.name}
                </option>
              ))}
            </select>
            <input
              name="payrollMonth"
              aria-label="薪资月份筛选"
              placeholder="YYYY-MM"
              defaultValue={filters.payrollMonth ?? ""}
            />
            <select name="status" aria-label="状态筛选" defaultValue={filters.status ?? ""}>
              <option value="">全部状态</option>
              {PAYROLL_RUN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <select name="ownerId" aria-label="负责人筛选" defaultValue={filters.ownerId ?? ""}>
              <option value="">全部负责人</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName}
                </option>
              ))}
            </select>
            <select name="risk" aria-label="风险筛选" defaultValue={filters.risk ?? ""}>
              <option value="">全部风险</option>
              <option value="blocking">仅阻断</option>
              <option value="high">仅高风险</option>
            </select>
            <button type="submit">筛选</button>
          </form>
          {error ? <div className="alert error">数据库不可用：{error}</div> : null}
          {runs.length === 0 && !error ? (
            <div className="empty-state">当前没有匹配的 Payroll Run。</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table run-table">
                <thead>
                  <tr>
                    <th>客户</th>
                    <th>薪资月份</th>
                    <th>状态</th>
                    <th>阻断</th>
                    <th>高风险</th>
                    <th>负责人</th>
                    <th>截止日</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <strong>{run.client.code}</strong>
                        <span>{run.client.name}</span>
                      </td>
                      <td>{run.payrollMonth}</td>
                      <td>
                        <span className={`status-pill ${statusClass(run.status)}`}>
                          {STATUS_LABELS[run.status]}
                        </span>
                      </td>
                      <td className={run.blockingIssueCount > 0 ? "danger-text" : ""}>
                        {run.blockingIssueCount}
                      </td>
                      <td className={run.highRiskIssueCount > 0 ? "warning-text" : ""}>
                        {run.highRiskIssueCount}
                      </td>
                      <td>
                        {run.assignments.length > 0
                          ? run.assignments.map((assignment) => (
                              <span className="stacked-text" key={assignment.id}>
                                {assignment.user.displayName} · {assignment.role}
                              </span>
                            ))
                          : "未分配"}
                      </td>
                      <td>{formatShortDate(run.targetCompletionDate)}</td>
                      <td>
                        <Link className="text-link" href={`/payroll-runs/${run.id}`}>
                          查看 →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
      <aside className="task-panel">
        <section className="content-section">
          <div className="section-header compact">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>我的待办</h2>
            </div>
          </div>
          <div className="task-list">
            {runs.flatMap((run) =>
              run.reminders.map((reminder) => (
                <Link
                  className="task-item"
                  href={`/payroll-runs/${run.id}#${reminderAnchor(reminder.type)}`}
                  key={reminder.id}
                >
                  <strong>{reminder.title}</strong>
                  <span>
                    {run.client.code} · {run.payrollMonth} · {formatShortDate(reminder.dueAt)}
                  </span>
                </Link>
              )),
            )}
            {runs.flatMap((run) => run.reminders).length === 0 ? (
              <div className="empty-state">没有 open reminder。</div>
            ) : null}
          </div>
        </section>
        {canCreateRun ? (
          <section className="content-section">
            <div className="section-header compact">
              <div>
                <p className="eyebrow">Controlled create</p>
                <h2>新建 Run</h2>
              </div>
            </div>
            <form className="create-run-form" action={createPayrollRunAction}>
              <select name="clientId" aria-label="新建 Run 客户" required>
                <option value="">选择授权客户</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.code} · {client.name}
                  </option>
                ))}
              </select>
              <input name="payrollMonth" aria-label="新建 Run 薪资月份" placeholder="YYYY-MM" required />
              <input name="targetCompletionDate" aria-label="目标完成日期" type="date" />
              <input name="payDate" aria-label="发薪日" type="date" />
              <select name="deliveryOwnerId" aria-label="交付负责人">
                <option value="">交付负责人，可选</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
              <select name="payrollOwnerId" aria-label="算薪负责人">
                <option value="">算薪负责人，可选</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
              <button type="submit">新建 Run</button>
            </form>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
