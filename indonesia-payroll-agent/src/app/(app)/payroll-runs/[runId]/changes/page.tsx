import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { currentActor } from "@/app/(app)/server-actor";
import {
  approveChangeProposalAction,
  closeChangeProposalAction,
} from "@/app/(app)/payroll-runs/[runId]/phase8-actions";
import { assertClientActionAllowed, canPerformClientAction } from "@/domain/auth/permissions";
import { ApprovalDrawer } from "@/components/approval-drawer";
import { ChangeProposalRow } from "@/components/change-proposal-row";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

const STATUS_LABELS: Record<string, string> = {
  PENDING_REVIEW: "待审核",
  APPROVED: "已采纳",
  APPROVED_WITH_MODIFICATION: "修改后采纳",
  REJECTED: "已拒绝",
  RETURNED: "已退回",
  CONVERTED_TO_QUESTION: "转追问",
  NO_ACTION: "无需处理",
  MERGED: "已合并",
  SPLIT: "已拆分",
};

export default async function ChangeReviewPage({ params }: PageProps) {
  const actor = await currentActor();
  const { runId } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      client: { select: { id: true, code: true, name: true } },
      changeProposals: {
        include: {
          rawInputItem: { select: { id: true, redactedSummary: true, sourceChannel: true } },
          targetEmployee: { select: { id: true, employeeCode: true, fullName: true } },
          ledgerEntry: { select: { id: true, reviewedAt: true } },
        },
        orderBy: [{ status: "asc" }, { riskLevel: "desc" }, { createdAt: "desc" }],
      },
      changeLedgerEntries: {
        include: {
          proposal: { select: { id: true, source: true, reason: true } },
          targetEmployee: { select: { employeeCode: true, fullName: true } },
          reviewedBy: { select: { displayName: true, email: true } },
        },
        orderBy: { reviewedAt: "desc" },
      },
    },
  });

  if (!run) {
    return <div className="empty-state">Payroll Run 不存在。</div>;
  }
  assertClientActionAllowed(actor, "viewClient", run.clientId);

  const pendingCount = run.changeProposals.filter((proposal) => proposal.status === "PENDING_REVIEW").length;
  const canReview = canPerformClientAction(actor, "updatePayrollRun", run.clientId);
  const permissionGate = canReview
    ? `payrollRun.update 已授权（${actor.roleCodes.join(", ")}）`
    : `payrollRun.update 未授权（${actor.roleCodes.join(", ")}）`;
  const customerConfirmationGate =
    run.pendingCustomerConfirmationCount === 0
      ? "当前无缺口"
      : `${run.pendingCustomerConfirmationCount} 个待客户确认缺口`;

  return (
    <div className="page-stack">
      <header className="run-header">
        <Link className="back-button" href={`/payroll-runs/${run.id}`} aria-label="返回 Run">
          <ChevronLeft aria-hidden size={17} />
        </Link>
        <div>
          <h2>变更 Proposal Review</h2>
          <span>
            {run.client.code} · {run.client.name} · {run.payrollMonth}
          </span>
        </div>
        <span className={`risk-badge ${pendingCount > 0 ? "r2" : "r0"}`}>
          {pendingCount} 待审核
        </span>
      </header>

      <ApprovalDrawer
        title="ChangeProposal 采纳前确认"
        riskLabel={pendingCount > 0 ? "R2/R3 review gate" : "R0 clear"}
        requiredRole="具备 payrollRun.update 且授权当前客户"
        impactItems={[
          `${pendingCount} 条待审核 proposal`,
          `${run.pendingCustomerConfirmationCount} 个客户确认缺口`,
          "采纳后追加 ChangeLedgerEntry，原 proposal 不再可重复采纳",
        ]}
        reason="采纳、修改后采纳、转追问、合并和拆分都会写入审计；锁定 run 必须走 correction run。"
      />

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Candidate layer</p>
            <h2>ChangeProposal 候选队列</h2>
          </div>
          <span className="section-meta">未审核候选不会写入 ledger、员工主档或算薪结果</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>来源 / 对象</th>
                <th>变更字段</th>
                <th>差异预览</th>
                <th>风险 / 证据</th>
                <th>状态 / 审核</th>
              </tr>
            </thead>
            <tbody>
              {run.changeProposals.map((proposal) => (
                <ChangeProposalRow
                  key={proposal.id}
                  proposal={{ ...proposal, permissionGate, customerConfirmationGate }}
                  statusLabel={STATUS_LABELS[proposal.status] ?? proposal.status}
                  actions={
                    proposal.status === "PENDING_REVIEW" && canReview ? (
                      <div className="action-stack">
                        <form action={approveChangeProposalAction}>
                          <input type="hidden" name="runId" value={run.id} />
                          <input type="hidden" name="proposalId" value={proposal.id} />
                          <select name="confidence" defaultValue={proposal.confidence}>
                            <option value="HIGH">HIGH</option>
                            <option value="MEDIUM">MEDIUM</option>
                            <option value="LOW">LOW</option>
                            <option value="CONFLICT">CONFLICT</option>
                          </select>
                          <input name="evidenceRefs" placeholder="证据 refs，逗号分隔" defaultValue={proposal.evidenceRefs.join(", ")} />
                          <input name="proposedValue" placeholder='修改后采纳值 JSON，如 {"amount":12000000}' />
                          <input name="formalObjectType" placeholder="正式对象类型，默认取目标对象" />
                          <input name="formalObjectId" placeholder="正式对象 ID，可留空" />
                          <input name="formalObjectVersionRef" placeholder="正式对象版本引用，可留空" />
                          <input name="reviewNote" placeholder="采纳理由" required />
                          <button type="submit">采纳入账</button>
                        </form>
                        <form action={closeChangeProposalAction}>
                          <input type="hidden" name="runId" value={run.id} />
                          <input type="hidden" name="proposalId" value={proposal.id} />
                          <select name="action" defaultValue="reject">
                            <option value="reject">拒绝</option>
                            <option value="return">退回</option>
                            <option value="noAction">无需处理</option>
                            <option value="convertToQuestion">转追问</option>
                            <option value="merge">合并</option>
                            <option value="split">拆分</option>
                          </select>
                          <input name="relatedProposalIds" placeholder="合并/拆分关联 proposal IDs，逗号分隔" />
                          <input name="reviewNote" placeholder="处理理由" required />
                          <button type="submit">关闭候选</button>
                        </form>
                      </div>
                    ) : proposal.status === "PENDING_REVIEW" ? (
                      <span>{permissionGate}</span>
                    ) : (
                      <span>{proposal.reviewNote ?? proposal.ledgerEntry?.id ?? "已处理"}</span>
                    )
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Committed layer</p>
            <h2>ChangeLedgerEntry 正式账本</h2>
          </div>
          <span className="section-meta">只追加，不编辑；更正走 reversal / amendment / correction</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>入账时间</th>
                <th>对象</th>
                <th>字段</th>
                <th>正式值</th>
                <th>审核人</th>
              </tr>
            </thead>
            <tbody>
              {run.changeLedgerEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.reviewedAt.toLocaleString("zh-CN")}</td>
                  <td>
                    <strong>{entry.entryType}</strong>
                    <span>{entry.targetEmployee ? `${entry.targetEmployee.employeeCode} · ${entry.targetEmployee.fullName}` : entry.targetObjectType}</span>
                  </td>
                  <td>{entry.targetField}</td>
                  <td>{formatJson(entry.newValue)}</td>
                  <td>{entry.reviewedBy?.displayName ?? entry.reviewedBy?.email ?? "系统"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatJson(value: unknown) {
  return JSON.stringify(value).slice(0, 160);
}
