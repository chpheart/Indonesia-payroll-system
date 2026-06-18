import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { FILE_PURPOSES } from "@/domain/files/upload-service";
import { FileUploadForm } from "@/app/(app)/payroll-runs/[runId]/files/file-upload-form";
import { currentActor } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

const PURPOSE_LABELS: Record<(typeof FILE_PURPOSES)[number], string> = {
  EMPLOYEE_MASTER: "员工档案",
  MOVEMENT: "入离转调",
  PAYROLL_INPUT: "工资输入",
  ATTENDANCE: "考勤",
  CONTRACT: "合同",
  CUSTOMER_CONFIRMATION: "客户确认",
  INTERNAL_NOTE: "内部备注",
  OTHER: "其他",
};

export default async function RunFilesPage({ params }: PageProps) {
  const actor = await currentActor();
  const { runId } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      client: { select: { code: true, name: true } },
      uploadedFileVersions: {
        orderBy: { createdAt: "desc" },
        include: {
          rawInputItem: { select: { id: true, redactedSummary: true, status: true } },
          workbookParses: {
            orderBy: { startedAt: "desc" },
            take: 1,
            include: {
              sheets: { orderBy: { sheetIndex: "asc" } },
              cells: {
                where: { formulaText: { not: null } },
                orderBy: [{ sheetName: "asc" }, { rowIndex: "asc" }, { columnIndex: "asc" }],
                take: 20,
              },
            },
          },
        },
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
          <h2>文件上传与解析预览</h2>
          <span>
            {run.client.code} · {run.client.name} · {run.payrollMonth}
          </span>
        </div>
        <span className="risk-badge r1">只读解析</span>
      </header>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Phase 4</p>
            <h2>上传文件</h2>
          </div>
          <Link className="text-link" href={`/payroll-runs/${run.id}/intake`}>
            Intake 队列 →
          </Link>
        </div>
        <FileUploadForm runId={run.id} existingFiles={run.uploadedFileVersions} />
      </section>

      <section className="content-section">
        <div className="section-header compact">
          <div>
            <p className="eyebrow">Workbook Preview</p>
            <h2>文件版本</h2>
          </div>
        </div>
        {run.uploadedFileVersions.length === 0 ? (
          <div className="empty-state">当前 run 没有上传文件。</div>
        ) : (
          <div className="file-preview-list">
            {run.uploadedFileVersions.map((file) => {
              const latestParse = file.workbookParses[0];
              return (
                <article className="file-preview-card" key={file.id}>
                  <header>
                    <div>
                      <strong>{file.fileName}</strong>
                      <span>
                        v{file.versionNumber} · {PURPOSE_LABELS[file.purpose]} · {file.parseStatus}
                      </span>
                    </div>
                    <Link className="text-link" href={`/api/files/${file.id}/preview`}>
                      JSON 预览 →
                    </Link>
                  </header>
                  <div className="file-meta-grid">
                    <span>sha256 {file.sha256.slice(0, 12)}</span>
                    <span>{file.sizeBytes} bytes</span>
                    <span>{file.rawInputItem?.status ?? "RawInput 待查"}</span>
                    <span>{file.riskFlags.length > 0 ? file.riskFlags.join(" · ") : "无风险标记"}</span>
                  </div>
                  {latestParse ? (
                    <>
                      {latestParse.status === "BLOCKED" ? (
                        <div className="alert error">
                          {latestParse.errorCode ?? "PARSE_BLOCKED"} ·{" "}
                          {latestParse.errorMessage ?? "解析阻断"}
                        </div>
                      ) : null}
                      <div className="sheet-preview-grid">
                        {latestParse.sheets.map((sheet) => (
                          <div className="sheet-preview" key={sheet.id}>
                            <div className="sheet-title">
                              <strong>{sheet.sheetName}</strong>
                              <span>{sheet.effectiveRange ?? "无有效区域"}</span>
                            </div>
                            <div className="header-strip">
                              {Array.isArray(sheet.headerValues) &&
                              sheet.headerValues.length > 0
                                ? sheet.headerValues.slice(0, 8).map((value, index) => (
                                    <span key={`${sheet.id}-${index}`}>{String(value)}</span>
                                  ))
                                : <span>未识别表头</span>}
                            </div>
                            <div className="sample-row-list">
                              {Array.isArray(sheet.sampleRows) && sheet.sampleRows.length > 0
                                ? sheet.sampleRows.slice(0, 3).map((row, rowIndex) => (
                                    <p key={`${sheet.id}-sample-${rowIndex}`}>
                                      {(Array.isArray(row) ? row : []).slice(0, 6).join(" · ")}
                                    </p>
                                  ))
                                : <p>无样例值</p>}
                            </div>
                            {Array.isArray(sheet.mergedRanges) && sheet.mergedRanges.length > 0 ? (
                              <p className="section-meta">
                                合并单元格 {sheet.mergedRanges.slice(0, 6).join(" · ")}
                              </p>
                            ) : null}
                            {latestParse.cells.some((cell) => cell.sheetId === sheet.id) ? (
                              <div className="formula-list">
                                {latestParse.cells
                                  .filter((cell) => cell.sheetId === sheet.id)
                                  .slice(0, 4)
                                  .map((cell) => (
                                    <span key={cell.id}>
                                      {cell.address}: {cell.formulaText} = {cell.displayValue ?? "-"}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="empty-state inline-note">未生成 workbook 解析记录。</div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
