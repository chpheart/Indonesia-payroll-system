import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RUN_CHANGE_SOURCE_TYPES } from "@/domain/payroll-runs/run-state-machine";
import {
  impactRollbackPayrollRunAction,
  transitionPayrollRunAction,
} from "@/app/(app)/payroll-runs/actions";
import { formatShortDate, STATUS_LABELS, statusClass } from "@/app/(app)/payroll-runs/dashboard-data";
import { loadRunDetail } from "@/app/(app)/payroll-runs/[runId]/detail-data";
import { ENTRY_POINTS } from "@/app/(app)/payroll-runs/[runId]/run-entry-points";
import { currentActor } from "@/app/(app)/server-actor";
import { ApprovalDrawer } from "@/components/approval-drawer";
import { AuditTimeline } from "@/components/audit-timeline";
import { CalculationTracePanel } from "@/components/calculation-trace-panel";
import { EvidenceChip } from "@/components/evidence-chip";
import { IssueRow } from "@/components/issue-row";
import { RiskGateBanner } from "@/components/risk-gate-banner";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

function canAdvanceToNext({
  nextStatus,
  blockingIssueCount,
  highRiskIssueCount,
  pendingCustomerConfirmationCount,
}: {
  nextStatus: string | null;
  blockingIssueCount: number;
  highRiskIssueCount: number;
  pendingCustomerConfirmationCount: number;
}) {
  if (!nextStatus) {
    return false;
  }

  if (nextStatus === "LOCKED") {
    return (
      blockingIssueCount === 0 &&
      highRiskIssueCount === 0 &&
      pendingCustomerConfirmationCount === 0
    );
  }

  if (nextStatus === "PENDING_CALCULATION") {
    return blockingIssueCount === 0;
  }

  if (nextStatus === "PENDING_PRECHECK") {
    return pendingCustomerConfirmationCount === 0;
  }

  if (nextStatus === "PENDING_PAYROLL_CONFIRMATION") {
    return highRiskIssueCount === 0;
  }

  return true;
}

export default async function PayrollRunDetailPage({ params }: PageProps) {
  const actor = await currentActor();
  const { runId } = await params;
  const { run, stages, nextStatus, timeline, error } = await loadRunDetail(actor, runId);

  if (error) {
    return <div className="alert error">数据库不可用：{error}</div>;
  }

  if (!run) {
    return <div className="empty-state">Payroll Run 不存在，或当前用户无权访问。</div>;
  }

  const canAdvance = canAdvanceToNext({
    nextStatus,
    blockingIssueCount: run.blockingIssueCount,
    highRiskIssueCount: run.highRiskIssueCount,
    pendingCustomerConfirmationCount: run.pendingCustomerConfirmationCount,
  });

  return (
    <div className="run-workbench">
      <header className="run-header">
        <Link className="back-button" href="/payroll-runs" aria-label="返回任务台">
          <ChevronLeft aria-hidden size={17} />
        </Link>
        <div>
          <h2>{run.client.name}</h2>
          <span>
            {run.client.code} · {run.payrollMonth} · 发薪日 {formatShortDate(run.payDate)}
          </span>
        </div>
        <span className={`status-pill ${statusClass(run.status)}`}>{STATUS_LABELS[run.status]}</span>
        {run.highRiskIssueCount > 0 ? <span className="risk-badge r2">高风险</span> : null}
      </header>

      <div className="run-layout">
        <aside className="stage-rail" aria-label="阶段进度">
          <p className="eyebrow">阶段进度</p>
          {stages.map((stage) => (
            <div className={`stage-step ${stage.state}`} key={stage.name}>
              <span>{stage.state === "done" ? "✓" : stage.index}</span>
              <div>
                <strong>{stage.name}</strong>
                <small>
                  {stage.state === "done"
                    ? "已完成"
                    : stage.state === "blocked"
                      ? "当前 · 阻断"
                      : stage.state === "current"
                        ? "当前"
                        : "未开始"}
                </small>
              </div>
            </div>
          ))}
        </aside>

        <section className="run-main">
          <RiskGateBanner
            blockingIssueCount={run.blockingIssueCount}
            highRiskIssueCount={run.highRiskIssueCount}
            pendingCustomerConfirmationCount={run.pendingCustomerConfirmationCount}
          />

          <section className="content-section run-entry-section" id="run-entrypoints">
            <div className="section-header compact">
              <div>
                <p className="eyebrow">Run context</p>
                <h2>详情入口</h2>
              </div>
            </div>
            <div className="run-entry-grid">
              {ENTRY_POINTS.map(([anchor, label, phase, note]) => (
                <Link
                  className="entry-button"
                  href={
                    anchor === "intake-assignment"
                      ? `/payroll-runs/${run.id}/intake`
                      : anchor === "files"
                        ? `/payroll-runs/${run.id}/files`
                        : anchor === "proposal-review"
                          ? `/payroll-runs/${run.id}/changes`
                          : anchor === "mapping-confirmation" || anchor === "standardization"
                            ? `/payroll-runs/${run.id}/mappings`
                            : anchor === "evidence-questions"
                              ? `/payroll-runs/${run.id}/evidence`
                              : anchor === "customer-confirmation"
                                ? `/payroll-runs/${run.id}/customer-confirmation`
                                : `#${anchor}`
                  }
                  key={anchor}
                >
                  <strong>{label}</strong>
                  <span>
                    {phase} · {note}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="run-stage-sections" aria-label="Run 阶段入口">
            {ENTRY_POINTS.map(([anchor, label, phase, note]) => (
              <article className="stage-anchor-panel" id={anchor} key={anchor}>
                <div>
                  <p className="eyebrow">{phase}</p>
                  <h3>{label}</h3>
                  <p>{note}</p>
                </div>
                <span className="risk-badge neutral">Run 内锚点</span>
              </article>
            ))}
          </section>

          <section className="risk-overview">
            <div>
              <p className="eyebrow">风险总览</p>
              <div className="risk-count-grid">
                <span className="risk-count danger">
                  <strong>{run.blockingIssueCount}</strong>阻断
                </span>
                <span className="risk-count warning">
                  <strong>{run.highRiskIssueCount}</strong>高风险
                </span>
                <span className="risk-count info">
                  <strong>{run.pendingCustomerConfirmationCount}</strong>待确认
                </span>
              </div>
            </div>
            <div className="issue-list">
              {run.blockingIssueCount > 0 ? (
                <IssueRow
                  tone="blocking"
                  title="仍有阻断项未清零"
                  detail="算薪、锁定和导出会 fail closed，必须先处理阻断来源。"
                  owner={run.assignments[0]?.user.displayName}
                />
              ) : null}
              {run.highRiskIssueCount > 0 ? (
                <IssueRow
                  tone="high"
                  title="高风险项等待放行"
                  detail="需要展示影响范围、证据和业务理由，由算薪负责人或交付主管确认。"
                  owner={run.assignments[0]?.user.displayName}
                />
              ) : null}
              {run.blockingIssueCount === 0 && run.highRiskIssueCount === 0 ? (
                <IssueRow
                  tone="check"
                  title="当前无阻断或高风险计数"
                  detail="后续阶段仍需通过预检查、确认包和审计事件证明。"
                />
              ) : null}
            </div>
          </section>

          <CalculationTracePanel
            status={STATUS_LABELS[run.status]}
            lines={[
              `状态事件 ${run.statusEvents.length} 条`,
              `Open reminder ${run.reminders.length} 条`,
              "算薪结果 trace 将在 Phase 10 接入确定性引擎。",
            ]}
          />
          <AuditTimeline items={timeline} />
        </section>

        <ApprovalDrawer
          title="确认映射版本 / 锁定 Run"
          riskLabel="R3 高影响"
          requiredRole="算薪负责人 / 交付主管"
          impactItems={[
            `${run.client.code} · ${run.payrollMonth}`,
            `阻断 ${run.blockingIssueCount} · 高风险 ${run.highRiskIssueCount}`,
            "锁定后只能通过 Correction Run 修正历史结果",
          ]}
          reason="高影响动作必须展示预览、差异和业务理由；当前抽屉只显示门禁，不静默执行。"
        />
      </div>

      <form className="bottom-action-bar" action={transitionPayrollRunAction}>
        <input type="hidden" name="runId" value={run.id} />
        <input type="hidden" name="toStatus" value={nextStatus ?? ""} />
        <input
          name="reason"
          aria-label="阶段推进理由"
          placeholder="阶段推进理由，必填"
          defaultValue={nextStatus ? `推进至 ${STATUS_LABELS[nextStatus]}` : ""}
          required
        />
        <span>
          {canAdvance
            ? nextStatus
              ? `下一状态：${STATUS_LABELS[nextStatus]}`
              : "当前状态无下一步"
            : "需先清理门禁"}
        </span>
        <button type="submit" disabled={!canAdvance}>
          {nextStatus === "LOCKED" ? "确认锁定 Run" : "推进阶段"}
        </button>
      </form>

      <form className="impact-form" action={impactRollbackPayrollRunAction}>
        <input type="hidden" name="runId" value={run.id} />
        <select name="sourceType" aria-label="影响来源类型" required>
          {RUN_CHANGE_SOURCE_TYPES.map((sourceType) => (
            <option key={sourceType} value={sourceType}>
              {sourceType}
            </option>
          ))}
        </select>
        <input name="impactedObjectType" aria-label="影响对象类型" placeholder="对象类型，可选" />
        <input name="impactedObjectId" aria-label="影响对象 ID" placeholder="对象 ID，可选" />
        <input
          name="reason"
          aria-label="回退理由"
          placeholder="变更影响说明，必填"
          required
        />
        <input
          name="invalidatedResultScope"
          aria-label="失效结果范围"
          placeholder="失效结果范围，如：预检查结果 / 算薪结果 / 客户确认包"
          required
        />
        <button type="submit">记录影响并回退</button>
      </form>

      <div className="evidence-strip" aria-label="证据状态">
        <EvidenceChip label="状态机事件已落库" />
        <EvidenceChip label="审计 runId 绑定" />
        <EvidenceChip label="后续 Phase 接入证据索引" status="stale" />
      </div>
    </div>
  );
}
