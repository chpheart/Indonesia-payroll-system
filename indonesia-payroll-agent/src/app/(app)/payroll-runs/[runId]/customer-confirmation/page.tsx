import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { currentActor } from "@/app/(app)/server-actor";
import {
  generateCustomerConfirmationPackAction,
  updateCustomerConfirmationPackMessageAction,
  updateConfirmationPackItemAction,
} from "@/app/(app)/payroll-runs/[runId]/phase9-actions";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { ApprovalDrawer } from "@/components/approval-drawer";
import { EvidenceChip } from "@/components/evidence-chip";
import { prisma } from "@/lib/db/prisma";
import { CustomerConfirmationBackfillForm } from "./customer-confirmation-backfill-form";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

const CATEGORY_LABELS: Record<string, string> = {
  MONTHLY_CHANGE: "本月变更",
  MISSING_INFORMATION: "缺失信息",
  EXCEPTION: "异常项",
  CONFIRMATION_REQUIRED: "需客户确认",
  SUGGESTED_MESSAGE: "建议话术",
  EVIDENCE_ATTACHMENT: "附件/证据",
};

const PACK_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿/核对材料",
  READY_FOR_CUSTOMER: "待发客户",
  PARTIALLY_CONFIRMED: "部分确认",
  CONFIRMED: "已确认",
  INVALIDATED: "已失效",
  SUPERSEDED: "已被新版本替代",
};

export default async function CustomerConfirmationPage({ params }: PageProps) {
  const actor = await currentActor();
  const { runId } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      clientId: true,
      payrollMonth: true,
      client: { select: { code: true, name: true } },
      customerConfirmationPacks: {
        select: {
          id: true,
          versionNumber: true,
          status: true,
          dataVersionRef: true,
          invalidationReason: true,
          editableMessage: true,
          generatedMessage: true,
          items: {
            select: {
              id: true,
              category: true,
              status: true,
              sourceObjectType: true,
              title: true,
              detail: true,
              targetField: true,
              riskLevel: true,
              evidenceRefs: true,
              isCritical: true,
              isSystemRequired: true,
              targetEmployee: { select: { employeeCode: true, fullName: true } },
            },
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          },
          confirmations: {
            select: {
              id: true,
              confirmedByName: true,
              backfilledAt: true,
              status: true,
              dataVersionRef: true,
              coverageScope: true,
              evidence: { select: { sourceLabel: true, kind: true } },
            },
            orderBy: { backfilledAt: "desc" },
          },
        },
        orderBy: { versionNumber: "desc" },
      },
      evidences: {
        where: { status: "VALID" },
        select: { id: true, sourceLabel: true, redactedSummary: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!run) {
    return <div className="empty-state">Payroll Run 不存在。</div>;
  }
  assertClientActionAllowed(actor, "viewClient", run.clientId);
  const latestPack = run.customerConfirmationPacks[0];
  const criticalOpenItems = latestPack?.items.filter((item) => item.status === "OPEN" && (item.isCritical || item.isSystemRequired)).length ?? 0;

  return (
    <div className="page-stack">
      <header className="run-header">
        <Link className="back-button" href={`/payroll-runs/${run.id}`} aria-label="返回 Run">
          <ChevronLeft aria-hidden size={17} />
        </Link>
        <div>
          <h2>客户确认包</h2>
          <span>
            {run.client.code} · {run.client.name} · {run.payrollMonth}
          </span>
        </div>
        <span className={`risk-badge ${criticalOpenItems > 0 ? "r3" : "r0"}`}>
          关键待确认 {criticalOpenItems}
        </span>
      </header>

      <div className="run-layout phase9-layout">
        <section className="run-main">
          <section className="content-section">
            <div className="section-header">
              <div>
                <p className="eyebrow">Pack version</p>
                <h2>生成客户确认包</h2>
              </div>
              <span className="section-meta">未锁定 run 的确认包只能作为草稿/核对材料</span>
            </div>
            <form className="phase9-form compact" action={generateCustomerConfirmationPackAction}>
              <input type="hidden" name="runId" value={run.id} />
              <button type="submit">生成新确认包版本</button>
              <span className="form-status idle">
                当前版本：{latestPack ? `v${latestPack.versionNumber} · ${PACK_STATUS_LABELS[latestPack.status]}` : "尚未生成"}
              </span>
            </form>
          </section>

          {latestPack ? (
            <>
              <section className="content-section">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Overview</p>
                    <h2>
                      v{latestPack.versionNumber} · {PACK_STATUS_LABELS[latestPack.status]}
                    </h2>
                  </div>
                  <span className="section-meta">{latestPack.dataVersionRef}</span>
                </div>
                {latestPack.status === "INVALIDATED" || latestPack.status === "SUPERSEDED" ? (
                  <div className="alert error">{latestPack.invalidationReason ?? "该确认包不再适用。"}</div>
                ) : null}
                <div className="pack-message">
                  <pre>{latestPack.editableMessage ?? latestPack.generatedMessage}</pre>
                </div>
                <form className="phase9-form" action={updateCustomerConfirmationPackMessageAction}>
                  <input type="hidden" name="runId" value={run.id} />
                  <input type="hidden" name="packId" value={latestPack.id} />
                  <textarea
                    name="editableMessage"
                    aria-label="对客话术"
                    defaultValue={latestPack.editableMessage ?? latestPack.generatedMessage}
                    required
                  />
                  <button type="submit">保存对客话术</button>
                </form>
              </section>

              <section className="content-section">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Required items</p>
                    <h2>分组内容与关键项</h2>
                  </div>
                  <span className="section-meta">阻断、高风险、失效确认不可被普通隐藏</span>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>分组 / 对象</th>
                        <th>内容</th>
                        <th>风险 / 证据</th>
                        <th>处理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestPack.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{CATEGORY_LABELS[item.category]}</strong>
                            <span>{item.targetEmployee ? `${item.targetEmployee.employeeCode} · ${item.targetEmployee.fullName}` : item.sourceObjectType ?? "Run"}</span>
                          </td>
                          <td>
                            <strong>{item.title}</strong>
                            <span className="stacked-text">{item.detail}</span>
                            {item.targetField ? <span className="stacked-text">字段：{item.targetField}</span> : null}
                          </td>
                          <td>
                            <span className={`risk-badge ${item.riskLevel.toLowerCase()}`}>{item.riskLevel}</span>
                            <span className="status-pill">{item.status}</span>
                            {item.isCritical || item.isSystemRequired ? <EvidenceChip label="系统必保留" status="missing" /> : null}
                            <div className="evidence-strip inline">
                              {item.evidenceRefs.length > 0 ? (
                                item.evidenceRefs.slice(0, 3).map((ref) => <EvidenceChip key={ref} label={ref} />)
                              ) : (
                                <EvidenceChip label="待客户确认" status="stale" />
                              )}
                            </div>
                          </td>
                          <td>
                            <form className="mini-version-form" action={updateConfirmationPackItemAction}>
                              <input type="hidden" name="runId" value={run.id} />
                              <input type="hidden" name="itemId" value={item.id} />
                              <select name="status" defaultValue={item.status}>
                                <option value="OPEN">保持待确认</option>
                                {item.isCritical || item.isSystemRequired ? null : (
                                  <>
                                    <option value="INTERNAL_HANDLING">内部处理</option>
                                    <option value="NOT_CUSTOMER_FACING">无需客户确认</option>
                                  </>
                                )}
                                {item.isCritical || item.isSystemRequired ? null : (
                                  <>
                                    <option value="CONFIRMED">已确认</option>
                                    <option value="INVALIDATED">标记失效</option>
                                  </>
                                )}
                              </select>
                              <textarea name="handlingReason" placeholder="处理原因；关键项必填" />
                              <button type="submit">更新项状态</button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="content-section">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Backfill</p>
                    <h2>客户回复回填</h2>
                  </div>
                  <span className="section-meta">“确认无误”也必须选择覆盖范围</span>
                </div>
                <CustomerConfirmationBackfillForm evidences={run.evidences} packId={latestPack.id} runId={run.id} />
              </section>

              <section className="content-section">
                <div className="section-header">
                  <div>
                    <p className="eyebrow">Confirmation records</p>
                    <h2>客户确认记录</h2>
                  </div>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>时间 / 确认人</th>
                        <th>状态 / 版本</th>
                        <th>回复证据</th>
                        <th>覆盖范围</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestPack.confirmations.map((confirmation) => (
                        <tr key={confirmation.id}>
                          <td>
                            <strong>{confirmation.confirmedByName ?? "未填客户确认人"}</strong>
                            <span>{confirmation.backfilledAt.toLocaleString("zh-CN")}</span>
                          </td>
                          <td>
                            <span className={`status-pill ${confirmation.status.toLowerCase()}`}>{confirmation.status}</span>
                            <span className="stacked-text">{confirmation.dataVersionRef}</span>
                          </td>
                          <td>
                            {confirmation.evidence ? (
                              <EvidenceChip label={`${confirmation.evidence.sourceLabel} · ${confirmation.evidence.kind}`} />
                            ) : (
                              <EvidenceChip label="缺回复证据" status="missing" />
                            )}
                          </td>
                          <td>
                            <span className="stacked-text">{JSON.stringify(confirmation.coverageScope).slice(0, 180)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <div className="empty-state">还没有客户确认包。先生成草稿，再回填客户回复。</div>
          )}
        </section>

        <ApprovalDrawer
          title="客户确认发送 / 回填"
          riskLabel="R2/R3 confirmation gate"
          requiredRole="具备 payrollRun.update 且授权当前客户"
          impactItems={[
            `${run.client.code} · ${run.payrollMonth}`,
            `关键待确认 ${criticalOpenItems}`,
            "客户回复必须绑定 Evidence、pack 版本和覆盖范围",
          ]}
          reason="V1 不自动发送企业微信；复制给客户和回填回复都由人工完成并记录审计。"
        />
      </div>
    </div>
  );
}
