import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { currentActor } from "@/app/(app)/server-actor";
import {
  approveHighRiskIssueAction,
  generatePayrollConfirmationPackageAction,
} from "@/app/(app)/payroll-runs/[runId]/phase11-actions";
import { loadPayrollConfirmationData } from "@/app/(app)/payroll-runs/[runId]/phase11-confirmation-data";
import { ApprovalDrawer } from "@/components/approval-drawer";
import { EvidenceChip } from "@/components/evidence-chip";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

const CHECK_STATUS_LABELS: Record<string, string> = {
  PASSED: "通过",
  WARNING: "需复核",
  BLOCKED: "阻断",
  NOT_COVERED: "未覆盖",
};

const PACKAGE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  READY_FOR_REVIEW: "待复核",
  CONFIRMED: "已确认",
  LOCKED_SNAPSHOT: "锁定快照",
  INVALIDATED: "已失效",
};

export default async function PayrollConfirmationPage({ params }: PageProps) {
  const actor = await currentActor();
  const { runId } = await params;
  const data = await loadPayrollConfirmationData(actor, runId);
  if (!data) {
    return <div className="empty-state">Payroll Run 不存在，或当前用户无权访问。</div>;
  }

  const { run, latestPackageDraft } = data;
  const gateSnapshot = latestPackageDraft.gateSnapshot as {
    canConfirmLock?: boolean;
    failures?: string[];
  };
  const summary = latestPackageDraft.summary as {
    employeeCount?: number;
    totals?: Record<string, number>;
    riskSummary?: Record<string, number>;
    traceabilitySummary?: Record<string, number>;
  };
  const latestStoredPackage = run.payrollConfirmationPackages[0];

  return (
    <div className="page-stack">
      <header className="run-header">
        <Link className="back-button" href={`/payroll-runs/${run.id}`} aria-label="返回 Run">
          <ChevronLeft aria-hidden size={17} />
        </Link>
        <div>
          <h2>算薪确认包</h2>
          <span>
            {run.client.code} · {run.client.name} · {run.payrollMonth}
          </span>
        </div>
        <span className={`risk-badge ${gateSnapshot.canConfirmLock ? "r0" : "r3"}`}>
          {gateSnapshot.canConfirmLock ? "可复核锁定" : "Fail closed"}
        </span>
      </header>

      <div className="run-layout phase9-layout">
        <section className="run-main">
          <section className="content-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">Confirmation gate</p>
                <h2>锁定前确认</h2>
              </div>
              <span className="section-meta">
                结果版本 {data.packageInput.resultVersionRef}
              </span>
            </div>
            <div className="risk-count-grid">
              <span className="risk-count info">
                <strong>{summary.employeeCount ?? 0}</strong>员工
              </span>
              <span className="risk-count danger">
                <strong>{run.blockingIssueCount}</strong>阻断
              </span>
              <span className="risk-count warning">
                <strong>{summary.riskSummary?.openHighRiskCount ?? 0}</strong>未放行高风险
              </span>
              <span className="risk-count info">
                <strong>{summary.riskSummary?.blockedReconciliationCount ?? 0}</strong>核查阻断
              </span>
            </div>
            {gateSnapshot.failures && gateSnapshot.failures.length > 0 ? (
              <div className="alert error">
                {gateSnapshot.failures.map((failure) => (
                  <span className="stacked-text" key={failure}>{failure}</span>
                ))}
              </div>
            ) : (
              <div className="alert success">确认包 gate 已满足；仍需人工确认锁定动作。</div>
            )}
            <form className="phase9-form compact" action={generatePayrollConfirmationPackageAction}>
              <input type="hidden" name="runId" value={run.id} />
              <button type="submit">生成确认包快照</button>
              <span className="form-status idle">
                最新快照：{latestStoredPackage
                  ? `v${latestStoredPackage.versionNumber} · ${PACKAGE_STATUS_LABELS[latestStoredPackage.status]}`
                  : "尚未生成"}
              </span>
            </form>
          </section>

          <section className="content-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">Traceability</p>
                <h2>下钻与证据链</h2>
              </div>
              <span className="section-meta">字段、证据、规则、原始文件和审计入口</span>
            </div>
            <div className="risk-count-grid">
              <span className="risk-count info">
                <strong>{summary.traceabilitySummary?.changeLedgerEntryCount ?? 0}</strong>ChangeLedger
              </span>
              <span className="risk-count info">
                <strong>{summary.traceabilitySummary?.fieldMappingCount ?? 0}</strong>字段映射
              </span>
              <span className="risk-count info">
                <strong>{summary.traceabilitySummary?.standardizedInputCount ?? 0}</strong>标准化输入
              </span>
              <span className="risk-count info">
                <strong>{summary.traceabilitySummary?.rawInputItemCount ?? 0}</strong>原始输入
              </span>
              <span className="risk-count info">
                <strong>{summary.traceabilitySummary?.uploadedFileCount ?? 0}</strong>原始文件
              </span>
              <span className="risk-count info">
                <strong>{latestPackageDraft.auditEntryRefs.length}</strong>审计入口
              </span>
            </div>
            <div className="alert neutral">
              规则快照、原始 Excel 位置、客户确认包和 correction 差额写入确认包 drilldown；Phase 12 前 correction 差额为空时必须保持空值，不得伪造。
            </div>
          </section>

          <section className="content-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">Payroll summary</p>
                <h2>金额摘要</h2>
              </div>
              <span className="section-meta">客户值只做对照，不覆盖系统结果</span>
            </div>
            <div className="risk-count-grid">
              <span className="risk-count info">
                <strong>{formatIdr(summary.totals?.grossPay)}</strong>应发
              </span>
              <span className="risk-count info">
                <strong>{formatIdr(summary.totals?.netPay)}</strong>实发
              </span>
              <span className="risk-count info">
                <strong>{formatIdr(summary.totals?.pph21)}</strong>PPh21
              </span>
              <span className="risk-count info">
                <strong>{formatIdr(summary.totals?.bpjsKsTotal)}</strong>BPJS KS
              </span>
              <span className="risk-count info">
                <strong>{formatIdr(summary.totals?.bpjsTkTotal)}</strong>BPJS TK
              </span>
              <span className="risk-count info">
                <strong>{formatIdr(summary.totals?.employerCost)}</strong>雇主成本
              </span>
              <span className="risk-count warning">
                <strong>{summary.totals?.grossUpCount ?? 0}</strong>Gross Up
              </span>
              <span className="risk-count warning">
                <strong>{summary.totals?.foreignCurrencyCount ?? 0}</strong>外币
              </span>
              <span className="risk-count warning">
                <strong>{summary.totals?.terminatedEmployeeCount ?? 0}</strong>离职
              </span>
            </div>
          </section>

          <section className="content-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">High risk</p>
                <h2>高风险放行</h2>
              </div>
              <span className="section-meta">系统管理员不能放行业务风险</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>风险</th>
                    <th>影响对象</th>
                    <th>证据 / 状态</th>
                    <th>业务放行</th>
                  </tr>
                </thead>
                <tbody>
                  {run.highRiskIssues.map((issue) => (
                    <tr key={issue.id}>
                      <td>
                        <strong>{issue.title}</strong>
                        <span className="stacked-text">{issue.detail}</span>
                      </td>
                      <td>
                        <strong>{issue.targetEmployeeId ?? "Run"}</strong>
                        <span>{issue.targetField ?? issue.issueType}</span>
                      </td>
                      <td>
                        <span className={`risk-badge ${issue.riskLevel.toLowerCase()}`}>{issue.riskLevel}</span>
                        <span className="status-pill">{issue.status}</span>
                        <div className="evidence-strip inline">
                          {issue.evidenceRefs.length > 0 ? (
                            issue.evidenceRefs.slice(0, 3).map((ref) => <EvidenceChip key={ref} label={ref} />)
                          ) : (
                            <EvidenceChip label="待补证据" status="stale" />
                          )}
                        </div>
                      </td>
                      <td>
                        {issue.status === "OPEN" ? (
                          <form className="mini-version-form" action={approveHighRiskIssueAction}>
                            <input type="hidden" name="runId" value={run.id} />
                            <input type="hidden" name="issueId" value={issue.id} />
                            <textarea name="reason" placeholder="放行理由和复核依据，至少 10 字" required />
                            <button type="submit">放行</button>
                          </form>
                        ) : (
                          <span className="stacked-text">{issue.approvals[0]?.reason ?? issue.approvalReason ?? "已处理"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {run.highRiskIssues.length === 0 ? (
                    <tr><td colSpan={4}>暂无高风险项。</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="content-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">Reconciliation</p>
                <h2>算薪后核查</h2>
              </div>
              <span className="section-meta">人数、金额、客户值、环比、社保账单、模板结构</span>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>核查项</th>
                    <th>状态</th>
                    <th>对象</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {run.reconciliationChecks.map((check) => (
                    <tr key={check.id}>
                      <td>
                        <strong>{check.checkType}</strong>
                        <span>{check.targetField ?? "Run"}</span>
                      </td>
                      <td>
                        <span className={`risk-badge ${check.riskLevel.toLowerCase()}`}>{check.riskLevel}</span>
                        <span className="status-pill">{CHECK_STATUS_LABELS[check.status]}</span>
                      </td>
                      <td>{check.targetEmployeeId ?? "全 run"}</td>
                      <td>
                        <strong>{check.message}</strong>
                        <span className="stacked-text">{check.detail}</span>
                      </td>
                    </tr>
                  ))}
                  {run.reconciliationChecks.length === 0 ? (
                    <tr><td colSpan={4}>尚无持久化核查项；生成算薪结果后应写入 reconciliation checks。</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <ApprovalDrawer
          title="确认包 / 锁定前复核"
          riskLabel="R3 payroll confirmation"
          requiredRole="算薪负责人 / 交付主管"
          impactItems={[
            `${run.client.code} · ${run.payrollMonth}`,
            `阻断 ${run.blockingIssueCount} · 未放行高风险 ${summary.riskSummary?.openHighRiskCount ?? 0}`,
            "锁定后只能通过 Correction Run 修正历史结果",
          ]}
          reason="确认包必须展示预览、差异、风险等级、放行理由、权限校验和审计入口；缺任一项就 fail closed。"
        />
      </div>
    </div>
  );
}

function formatIdr(value: number | undefined) {
  return `IDR ${Math.round(value ?? 0).toLocaleString("id-ID")}`;
}
