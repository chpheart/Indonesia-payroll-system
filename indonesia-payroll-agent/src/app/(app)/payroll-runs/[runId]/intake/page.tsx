import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  RAW_INPUT_SOURCE_CHANNELS,
  RAW_INPUT_TYPES,
} from "@/domain/intake/intake-service";
import { createTextRawInputAction } from "@/app/(app)/intake/actions";
import { currentActor } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

const SOURCE_LABELS = {
  WECHAT_TEXT: "企业微信文本",
  WECHAT_SCREENSHOT: "截图/图片",
  CUSTOMER_EXCEL: "客户 Excel",
  CONTRACT: "合同",
  CUSTOMER_CONFIRMATION: "客户确认",
  INTERNAL_NOTE: "内部备注",
  OTHER: "其他",
} as const;

const TYPE_LABELS = {
  TEXT: "文本",
  IMAGE: "图片",
  EXCEL: "Excel",
  PDF: "PDF",
  DOCUMENT: "文档",
  NOTE: "备注",
  OTHER: "其他",
} as const;

export default async function RunIntakePage({ params }: PageProps) {
  const actor = await currentActor();
  const { runId } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      client: { select: { code: true, name: true } },
      rawInputItems: {
        include: {
          uploadedFiles: {
            orderBy: { createdAt: "desc" },
            select: { id: true, fileName: true, parseStatus: true },
          },
          caseItems: {
            where: { status: "OPEN" },
            select: { id: true, riskLevel: true, title: true },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!run) {
    return <div className="empty-state">Payroll Run 不存在。</div>;
  }
  assertClientActionAllowed(actor, "viewClient", run.clientId);

  return (
    <div className="page-stack">
      <header className="run-header">
        <Link className="back-button" href={`/payroll-runs/${run.id}`} aria-label="返回 Run">
          <ChevronLeft aria-hidden size={17} />
        </Link>
        <div>
          <h2>Run Intake</h2>
          <span>
            {run.client.code} · {run.client.name} · {run.payrollMonth}
          </span>
        </div>
        <span className="risk-badge r1">RawInputItem</span>
      </header>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Phase 4</p>
            <h2>原始输入队列</h2>
          </div>
          <Link className="text-link" href={`/payroll-runs/${run.id}/files`}>
            文件上传 →
          </Link>
        </div>
        {run.rawInputItems.length === 0 ? (
          <div className="empty-state">当前 run 没有 RawInputItem。</div>
        ) : (
          <div className="table-wrap">
            <table className="data-table intake-table">
              <thead>
                <tr>
                  <th>脱敏摘要</th>
                  <th>来源</th>
                  <th>状态</th>
                  <th>Evidence</th>
                  <th>Case</th>
                  <th>文件</th>
                </tr>
              </thead>
              <tbody>
                {run.rawInputItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.redactedSummary}</strong>
                      <span>{item.id}</span>
                    </td>
                    <td>
                      {SOURCE_LABELS[item.sourceChannel]}
                      <span>{TYPE_LABELS[item.inputType]}</span>
                    </td>
                    <td>
                      <span className="status-pill draft">{item.status}</span>
                      {item.securityFlags.length > 0 ? (
                        <span className="risk-badge r2">安全核查</span>
                      ) : null}
                    </td>
                    <td>{item.evidenceCandidateRefs.join(" · ") || "-"}</td>
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
                            <Link
                              className="stacked-text text-link"
                              href={`/api/files/${file.id}/preview`}
                              key={file.id}
                            >
                              {file.fileName} · {file.parseStatus}
                            </Link>
                          ))
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="content-section">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Capture</p>
            <h2>新增文本输入</h2>
          </div>
        </div>
        <form className="inline-form intake-inline-form" action={createTextRawInputAction}>
          <input type="hidden" name="runId" value={run.id} />
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
          <textarea name="originalText" aria-label="原始文本" required />
          <button type="submit">保存 RawInput</button>
        </form>
      </section>
    </div>
  );
}
