import Link from "next/link";
import Image from "next/image";
import { ChevronLeft } from "lucide-react";
import { currentActor } from "@/app/(app)/server-actor";
import {
  createEvidenceAction,
  createQuestionAction,
  transitionQuestionAction,
} from "@/app/(app)/payroll-runs/[runId]/phase9-actions";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { EvidenceChip } from "@/components/evidence-chip";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

const QUESTION_STATUS_LABELS: Record<string, string> = {
  PENDING: "待处理",
  SENT_TO_CUSTOMER: "已发送客户",
  WAITING_CUSTOMER_REPLY: "待客户回复",
  EVIDENCE_BACKFILLED: "已回填证据",
  RESOLVED: "已解决",
  CLOSED: "已关闭",
};

export default async function EvidenceQuestionPage({ params }: PageProps) {
  const actor = await currentActor();
  const { runId } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      clientId: true,
      payrollMonth: true,
      client: { select: { code: true, name: true } },
      evidences: {
        select: {
          id: true,
          kind: true,
          status: true,
          sourceLabel: true,
          redactedSummary: true,
          attachmentMimeType: true,
          createdAt: true,
          links: {
            select: { id: true, objectType: true, objectId: true },
            orderBy: { linkedAt: "desc" },
          },
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      },
      questionItems: {
        select: {
          id: true,
          title: true,
          impactSummary: true,
          reason: true,
          riskLevel: true,
          status: true,
          blockingIssueRef: true,
          evidenceRefs: true,
          statusEvents: {
            select: { toStatus: true, reason: true },
            orderBy: { createdAt: "desc" },
            take: 3,
          },
        },
        orderBy: [{ status: "asc" }, { riskLevel: "desc" }, { createdAt: "desc" }],
      },
      customerConfirmations: {
        where: { status: "STALE" },
        select: {
          id: true,
          invalidationReason: true,
          evidence: { select: { sourceLabel: true } },
        },
        orderBy: { invalidatedAt: "desc" },
      },
    },
  });

  if (!run) {
    return <div className="empty-state">Payroll Run 不存在。</div>;
  }
  assertClientActionAllowed(actor, "viewClient", run.clientId);

  const openQuestions = run.questionItems.filter((question) =>
    ["PENDING", "SENT_TO_CUSTOMER", "WAITING_CUSTOMER_REPLY", "EVIDENCE_BACKFILLED"].includes(question.status),
  ).length;

  return (
    <div className="page-stack">
      <header className="run-header">
        <Link className="back-button" href={`/payroll-runs/${run.id}`} aria-label="返回 Run">
          <ChevronLeft aria-hidden size={17} />
        </Link>
        <div>
          <h2>追问与证据中心</h2>
          <span>
            {run.client.code} · {run.client.name} · {run.payrollMonth}
          </span>
        </div>
        <span className={`risk-badge ${openQuestions + run.customerConfirmations.length > 0 ? "r2" : "r0"}`}>
          追问 {openQuestions} · 失效确认 {run.customerConfirmations.length}
        </span>
      </header>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Evidence intake</p>
            <h2>上传 / 粘贴证据</h2>
          </div>
          <span className="section-meta">只生成 Evidence 和关联，不自动改写工资结果</span>
        </div>
        <form className="phase9-form" action={createEvidenceAction}>
          <input type="hidden" name="runId" value={run.id} />
          <select name="kind" aria-label="证据类型" defaultValue="WECHAT_TEXT">
            <option value="WECHAT_TEXT">企业微信文本</option>
            <option value="WECHAT_SCREENSHOT">企业微信截图</option>
            <option value="CUSTOMER_FILE">客户文件</option>
            <option value="CUSTOMER_CONFIRMATION">客户确认</option>
            <option value="INTERNAL_NOTE">内部备注</option>
          </select>
          <select name="sourceChannel" aria-label="来源渠道" defaultValue="WECHAT_TEXT">
            <option value="WECHAT_TEXT">WECHAT_TEXT</option>
            <option value="WECHAT_SCREENSHOT">WECHAT_SCREENSHOT</option>
            <option value="CUSTOMER_CONFIRMATION">CUSTOMER_CONFIRMATION</option>
            <option value="INTERNAL_NOTE">INTERNAL_NOTE</option>
            <option value="OTHER">OTHER</option>
          </select>
          <input name="sourceLabel" aria-label="来源说明" placeholder="来源说明，如 企业微信 6/18 截图" required />
          <input name="file" aria-label="截图或文件" type="file" />
          <textarea name="contentText" aria-label="证据文本" placeholder="粘贴客户回复或备注文本" />
          <select name="objectType" aria-label="关联对象" defaultValue="PAYROLL_RUN">
            <option value="PAYROLL_RUN">Run</option>
            <option value="EMPLOYEE">员工</option>
            <option value="EMPLOYEE_MASTER_VERSION">员工主档版本</option>
            <option value="CHANGE_PROPOSAL">ChangeProposal</option>
            <option value="CHANGE_LEDGER_ENTRY">ChangeLedgerEntry</option>
            <option value="QUESTION_ITEM">追问项</option>
            <option value="CUSTOMER_CONFIRMATION_PACK">客户确认包</option>
            <option value="CUSTOMER_CONFIRMATION_PACK_ITEM">确认包条目</option>
            <option value="CLIENT_SCOPE">客户口径</option>
          </select>
          <input name="objectId" aria-label="对象 ID" placeholder="对象 ID，默认当前 run" />
          <input name="targetField" aria-label="字段范围" placeholder="字段，如 bankAccountNumber" />
          <select name="coverageScopeType" aria-label="覆盖范围类型" defaultValue="MIXED">
            <option value="FULL_RUN">全 run</option>
            <option value="EMPLOYEES">员工范围</option>
            <option value="FIELDS">字段范围</option>
            <option value="CLIENT_SCOPE">客户口径</option>
            <option value="MIXED">混合范围</option>
          </select>
          <input name="employeeIds" aria-label="员工 ID 范围" placeholder="员工 IDs，逗号分隔" />
          <input name="fields" aria-label="字段范围列表" placeholder="字段列表，逗号分隔" />
          <input name="clientScopeKeys" aria-label="客户口径范围" placeholder="客户口径 keys，逗号分隔" />
          <button type="submit">保存证据</button>
        </form>
      </section>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Question loop</p>
            <h2>追问清单</h2>
          </div>
          <span className="section-meta">关联阻断项的追问必须有真实 Evidence 和已解决 CaseItem</span>
        </div>
        <form className="phase9-form compact" action={createQuestionAction}>
          <input type="hidden" name="runId" value={run.id} />
          <input name="title" aria-label="追问标题" placeholder="缺什么" required />
          <input name="impactSummary" aria-label="影响范围" placeholder="影响对象 / 后果" required />
          <select name="riskLevel" aria-label="风险等级" defaultValue="R2">
            <option value="R1">R1</option>
            <option value="R2">R2</option>
            <option value="R3">R3</option>
          </select>
          <input name="targetField" aria-label="目标字段" placeholder="字段，可选" />
          <textarea name="detail" aria-label="追问详情" placeholder="要问客户的具体内容" required />
          <textarea name="reason" aria-label="追问理由" placeholder="为什么需要问，缺失会阻断什么" required />
          <input name="blockingIssueRef" aria-label="阻断引用" placeholder="CaseItem ID 或 CASE_ITEM:id，可选" />
          <input name="requiredEvidenceTypes" aria-label="证据要求" placeholder="截图,文本,确认文件" />
          <button type="submit">新增追问</button>
        </form>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>追问 / 影响</th>
                <th>状态 / 风险</th>
                <th>证据 / 事件</th>
                <th>推进状态</th>
              </tr>
            </thead>
            <tbody>
              {run.questionItems.map((question) => (
                <tr key={question.id}>
                  <td>
                    <strong>{question.title}</strong>
                    <span className="stacked-text">{question.impactSummary}</span>
                    <span className="stacked-text">{question.reason}</span>
                  </td>
                  <td>
                    <span className={`risk-badge ${question.riskLevel.toLowerCase()}`}>{question.riskLevel}</span>
                    <span className="status-pill">{QUESTION_STATUS_LABELS[question.status]}</span>
                    {question.blockingIssueRef ? <EvidenceChip label="关联阻断" status="missing" /> : null}
                  </td>
                  <td>
                    <div className="evidence-strip inline">
                      {question.evidenceRefs.length > 0 ? (
                        question.evidenceRefs.map((ref) => <EvidenceChip key={ref} label={ref} />)
                      ) : (
                        <EvidenceChip label="待证据" status="missing" />
                      )}
                    </div>
                    <span className="stacked-text">
                      {question.statusEvents[0]
                        ? `${QUESTION_STATUS_LABELS[question.statusEvents[0].toStatus]} · ${question.statusEvents[0].reason}`
                        : "暂无事件"}
                    </span>
                  </td>
                  <td>
                    <form className="mini-version-form" action={transitionQuestionAction}>
                      <input type="hidden" name="questionId" value={question.id} />
                      <select name="toStatus" defaultValue="WAITING_CUSTOMER_REPLY">
                        <option value="SENT_TO_CUSTOMER">已发送客户</option>
                        <option value="WAITING_CUSTOMER_REPLY">待客户回复</option>
                        <option value="EVIDENCE_BACKFILLED">已回填证据</option>
                        <option value="RESOLVED">已解决</option>
                        <option value="CLOSED">已关闭</option>
                      </select>
                      <select name="evidenceId" aria-label="解决证据" defaultValue="">
                        <option value="">不绑定新证据</option>
                        {run.evidences
                          .filter((evidence) => evidence.status === "VALID")
                          .map((evidence) => (
                            <option key={evidence.id} value={evidence.id}>
                              {evidence.sourceLabel}
                            </option>
                          ))}
                      </select>
                      <input name="reason" placeholder="状态变化原因" required />
                      <textarea name="resolutionNote" placeholder="解决说明，解决时必填" />
                      <button type="submit">更新追问</button>
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
            <p className="eyebrow">Evidence library</p>
            <h2>证据库</h2>
          </div>
          <span className="section-meta">证据 chip 必须能追到来源和覆盖范围</span>
        </div>
        <div className="evidence-card-grid">
          {run.evidences.map((evidence) => (
            <article className="evidence-card" key={evidence.id}>
              <header>
                <EvidenceChip label={evidence.kind} status={evidence.status.toLowerCase() as "valid" | "stale"} />
                <span>{evidence.createdAt.toLocaleString("zh-CN")}</span>
              </header>
              {evidence.attachmentMimeType?.startsWith("image/") ? (
                <Image
                  src={`/api/evidence/${evidence.id}/file`}
                  alt={evidence.redactedSummary}
                  width={320}
                  height={180}
                  unoptimized
                />
              ) : null}
              <strong>{evidence.sourceLabel}</strong>
              <p>{evidence.redactedSummary}</p>
              <div className="evidence-strip inline">
                {evidence.links.map((link) => (
                  <EvidenceChip key={link.id} label={`${link.objectType}:${link.objectId}`} />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {run.customerConfirmations.length > 0 ? (
        <section className="content-section">
          <div className="section-header">
            <div>
              <p className="eyebrow">Invalidation</p>
              <h2>确认失效</h2>
            </div>
          </div>
          <div className="issue-list padded">
            {run.customerConfirmations.map((confirmation) => (
              <div className="issue-row blocking" key={confirmation.id}>
                <span>!</span>
                <div>
                  <strong>{confirmation.evidence?.sourceLabel ?? "客户确认"}</strong>
                  <p>{confirmation.invalidationReason ?? "确认已失效，需要重新确认覆盖范围。"}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
