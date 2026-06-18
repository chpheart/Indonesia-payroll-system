import Link from "next/link";
import { isSystemAdmin, type ActorContext } from "@/domain/auth/permissions";
import {
  RAW_INPUT_SOURCE_CHANNELS,
  RAW_INPUT_TYPES,
  RAW_INPUT_STATUSES,
} from "@/domain/intake/intake-service";
import { createTextRawInputAction } from "@/app/(app)/intake/actions";
import { currentActor } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const RAW_INPUT_STATUS_LABELS: Record<(typeof RAW_INPUT_STATUSES)[number], string> = {
  PENDING_ASSIGNMENT: "待归属",
  PENDING_EXTRACTION: "待抽取",
  EXTRACTED_PENDING_REVIEW: "已抽取待审核",
  PROPOSAL_GENERATED: "已生成 Proposal",
  NEEDS_QUESTION: "需追问",
  ARCHIVED: "已归档",
  REJECTED: "已拒绝",
  VOIDED: "已作废",
};

const SOURCE_LABELS: Record<(typeof RAW_INPUT_SOURCE_CHANNELS)[number], string> = {
  WECHAT_TEXT: "企业微信文本",
  WECHAT_SCREENSHOT: "截图/图片",
  CUSTOMER_EXCEL: "客户 Excel",
  CONTRACT: "合同",
  CUSTOMER_CONFIRMATION: "客户确认",
  INTERNAL_NOTE: "内部备注",
  OTHER: "其他",
};

const TYPE_LABELS: Record<(typeof RAW_INPUT_TYPES)[number], string> = {
  TEXT: "文本",
  IMAGE: "图片",
  EXCEL: "Excel",
  PDF: "PDF",
  DOCUMENT: "文档",
  NOTE: "备注",
  OTHER: "其他",
};

async function loadIntakeData(actor: ActorContext) {
  try {
    const clientWhere = isSystemAdmin(actor) ? undefined : { id: { in: actor.authorizedClientIds } };
    const rawInputWhere = isSystemAdmin(actor)
      ? undefined
      : {
          OR: [
            { clientId: { in: actor.authorizedClientIds } },
            { clientId: null, createdById: actor.id },
          ],
        };
    const caseWhere = isSystemAdmin(actor)
      ? { status: "OPEN" as const }
      : {
          status: "OPEN" as const,
          OR: [
            { clientId: { in: actor.authorizedClientIds } },
            { clientId: null, rawInputItem: { createdById: actor.id } },
            { clientId: null, fileVersion: { uploadedById: actor.id } },
          ],
        };
    const [clients, runs, rawInputs, caseCount] = await Promise.all([
      prisma.client.findMany({
        where: clientWhere,
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.payrollRun.findMany({
        where: isSystemAdmin(actor)
          ? undefined
          : { clientId: { in: actor.authorizedClientIds } },
        orderBy: [{ payrollMonth: "desc" }, { createdAt: "desc" }],
        take: 80,
        select: {
          id: true,
          payrollMonth: true,
          status: true,
          client: { select: { code: true, name: true } },
        },
      }),
      prisma.rawInputItem.findMany({
        where: rawInputWhere,
        include: {
          client: { select: { code: true, name: true } },
          payrollRun: { select: { id: true, payrollMonth: true, status: true } },
          uploadedFiles: {
            orderBy: { createdAt: "desc" },
            take: 2,
            select: { id: true, fileName: true, parseStatus: true, purpose: true },
          },
          caseItems: {
            where: { status: "OPEN" },
            orderBy: { createdAt: "desc" },
            select: { id: true, type: true, riskLevel: true, title: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
      prisma.caseItem.count({ where: caseWhere }),
    ]);

    return { clients, runs, rawInputs, caseCount, error: null };
  } catch (error) {
    return {
      clients: [],
      runs: [],
      rawInputs: [],
      caseCount: 0,
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}

export default async function IntakePage() {
  const actor = await currentActor();
  const { clients, runs, rawInputs, caseCount, error } = await loadIntakeData(actor);
  const metrics = [
    ["RawInputItem", rawInputs.length, "队列"],
    [
      "待归属",
      rawInputs.filter((item) => item.status === "PENDING_ASSIGNMENT").length,
      "不能下游抽取",
    ],
    ["Open Case", caseCount, "待处理"],
    [
      "安全核查",
      rawInputs.filter((item) => item.securityFlags.length > 0).length,
      "指令类内容",
    ],
  ];

  return (
    <div className="dashboard-grid intake-dashboard">
      <section className="dashboard-main">
        <div className="metric-grid run-metrics" aria-label="AI Intake 指标">
          {metrics.map(([label, value, note]) => (
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
              <p className="eyebrow">SCREEN-015</p>
              <h2>AI Intake Inbox</h2>
            </div>
            <span className="section-meta">RawInputItem · Evidence 候选 · Case 队列</span>
          </div>
          {error ? <div className="alert error">数据库不可用：{error}</div> : null}
          {rawInputs.length === 0 && !error ? (
            <div className="empty-state">当前没有 RawInputItem。</div>
          ) : (
            <div className="table-wrap">
              <table className="data-table intake-table">
                <thead>
                  <tr>
                    <th>脱敏摘要</th>
                    <th>来源</th>
                    <th>归属</th>
                    <th>状态</th>
                    <th>Case</th>
                    <th>文件</th>
                    <th>入口</th>
                  </tr>
                </thead>
                <tbody>
                  {rawInputs.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <strong>{item.redactedSummary}</strong>
                        <span>{item.evidenceCandidateRefs.join(" · ") || "evidence 待生成"}</span>
                      </td>
                      <td>
                        {SOURCE_LABELS[item.sourceChannel]}
                        <span>{TYPE_LABELS[item.inputType]}</span>
                      </td>
                      <td>
                        {item.client ? `${item.client.code} · ${item.client.name}` : "未归属"}
                        <span>
                          {item.payrollMonth ?? "-"} {item.payrollRun ? `· Run ${item.payrollRun.id}` : ""}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill ${item.status === "PENDING_ASSIGNMENT" ? "terminated" : "draft"}`}>
                          {RAW_INPUT_STATUS_LABELS[item.status]}
                        </span>
                        {item.duplicateRiskScore > 0 ? (
                          <span className="risk-badge r1">重复</span>
                        ) : null}
                      </td>
                      <td>
                        {item.caseItems.length > 0
                          ? item.caseItems.map((caseItem) => (
                              <span className="stacked-text" key={caseItem.id}>
                                {caseItem.riskLevel} · {caseItem.title}
                              </span>
                            ))
                          : "无 open case"}
                      </td>
                      <td>
                        {item.uploadedFiles.length > 0
                          ? item.uploadedFiles.map((file) => (
                              <span className="stacked-text" key={file.id}>
                                {file.fileName} · {file.parseStatus}
                              </span>
                            ))
                          : "-"}
                      </td>
                      <td>
                        {item.runId ? (
                          <Link className="text-link" href={`/payroll-runs/${item.runId}/intake`}>
                            Run Intake →
                          </Link>
                        ) : (
                          <span className="section-meta">待绑定</span>
                        )}
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
              <p className="eyebrow">Capture</p>
              <h2>新增输入</h2>
            </div>
          </div>
          <form className="create-run-form intake-create-form" action={createTextRawInputAction}>
            <select name="sourceChannel" aria-label="来源渠道" defaultValue="WECHAT_TEXT">
              {RAW_INPUT_SOURCE_CHANNELS.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
            <select name="inputType" aria-label="输入类型" defaultValue="TEXT">
              {RAW_INPUT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <select name="runId" aria-label="绑定 Run">
              <option value="">不绑定 Run</option>
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.client.code} · {run.payrollMonth} · {run.status}
                </option>
              ))}
            </select>
            <select name="clientId" aria-label="绑定客户">
              <option value="">客户，可选</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} · {client.name}
                </option>
              ))}
            </select>
            <input name="payrollMonth" aria-label="薪资月份" placeholder="YYYY-MM" />
            <textarea name="originalText" aria-label="原始文本" required />
            <button type="submit">保存 RawInput</button>
          </form>
        </section>
      </aside>
    </div>
  );
}
