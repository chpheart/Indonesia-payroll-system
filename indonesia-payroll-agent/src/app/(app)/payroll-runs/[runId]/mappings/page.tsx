import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { currentActor } from "@/app/(app)/server-actor";
import {
  confirmMappingCandidateAction,
  confirmStandardizedInputAction,
} from "@/app/(app)/payroll-runs/[runId]/phase8-actions";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { EvidenceChip } from "@/components/evidence-chip";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ runId: string }>;
};

export default async function MappingStandardizationPage({ params }: PageProps) {
  const actor = await currentActor();
  const { runId } = await params;
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      client: { select: { code: true, name: true } },
      fieldMappingCandidates: {
        orderBy: [{ status: "asc" }, { confidence: "asc" }, { createdAt: "desc" }],
      },
      fieldMappingVersions: {
        include: { confirmedBy: { select: { displayName: true, email: true } } },
        orderBy: [{ confirmedAt: "desc" }],
      },
      standardizedInputs: {
        include: {
          employee: { select: { employeeCode: true, fullName: true } },
          employeeMatchCandidate: { select: { matchMethod: true, confidence: true, status: true } },
          fieldMappingVersion: { select: { sourceColumnLabel: true, targetField: true } },
        },
        orderBy: [{ status: "asc" }, { sourceSheetName: "asc" }, { sourceRowIndex: "asc" }],
      },
    },
  });
  if (!run) {
    return <div className="empty-state">Payroll Run 不存在。</div>;
  }
  assertClientActionAllowed(actor, "viewClient", run.clientId);

  const blockingInputs = run.standardizedInputs.filter((input) => input.status === "BLOCKED").length;
  const lowConfidenceMappings = run.fieldMappingCandidates.filter((item) =>
    ["LOW", "CONFLICT"].includes(item.confidence),
  ).length;

  return (
    <div className="page-stack">
      <header className="run-header">
        <Link className="back-button" href={`/payroll-runs/${run.id}`} aria-label="返回 Run">
          <ChevronLeft aria-hidden size={17} />
        </Link>
        <div>
          <h2>字段映射与标准化确认</h2>
          <span>
            {run.client.code} · {run.client.name} · {run.payrollMonth}
          </span>
        </div>
        <span className={`risk-badge ${blockingInputs + lowConfidenceMappings > 0 ? "r3" : "r0"}`}>
          阻断 {blockingInputs} · 低置信 {lowConfidenceMappings}
        </span>
      </header>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Candidate layer</p>
            <h2>字段映射候选</h2>
          </div>
          <span className="section-meta">Agent 和历史模板只预填；人工确认后才生成版本</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>源列</th>
                <th>建议目标</th>
                <th>样例 / 理由</th>
                <th>置信 / 证据</th>
                <th>确认</th>
              </tr>
            </thead>
            <tbody>
              {run.fieldMappingCandidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    <strong>{candidate.sourceSheetName}</strong>
                    <span>{candidate.sourceColumnLabel}</span>
                  </td>
                  <td>
                    <strong>{candidate.targetField}</strong>
                    <span>{candidate.fieldCategory} · {candidate.source}</span>
                  </td>
                  <td>
                    <span className="stacked-text">{formatJson(candidate.sampleValues)}</span>
                    <span className="stacked-text">{candidate.rationale}</span>
                  </td>
                  <td>
                    <span className={`risk-badge ${candidate.confidence === "HIGH" ? "r1" : "r2"}`}>
                      {candidate.confidence}
                    </span>
                    <span className="status-pill">{candidate.status}</span>
                    <div className="evidence-strip">
                      {candidate.evidenceRefs.length > 0 ? (
                        candidate.evidenceRefs.slice(0, 2).map((ref) => <EvidenceChip key={ref} label={ref} />)
                      ) : (
                        <EvidenceChip label="候选无证据" status="missing" />
                      )}
                    </div>
                  </td>
                  <td>
                    {candidate.status === "CANDIDATE" ? (
                      <form className="mini-version-form" action={confirmMappingCandidateAction}>
                        <input type="hidden" name="runId" value={run.id} />
                        <input type="hidden" name="candidateId" value={candidate.id} />
                        <input name="targetField" defaultValue={candidate.targetField} aria-label="目标字段" />
                        <select name="confidence" defaultValue={candidate.confidence === "HIGH" ? "HIGH" : "MEDIUM"}>
                          <option value="HIGH">HIGH</option>
                          <option value="MEDIUM">MEDIUM</option>
                        </select>
                        <textarea name="rationale" defaultValue={candidate.rationale} aria-label="确认理由" />
                        <button type="submit">确认映射版本</button>
                      </form>
                    ) : (
                      <span>{candidate.status}</span>
                    )}
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
            <p className="eyebrow">Effective mapping</p>
            <h2>FieldMappingVersion</h2>
          </div>
          <span className="section-meta">标准化输入只能引用已确认映射版本</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>版本</th>
                <th>源字段</th>
                <th>目标字段</th>
                <th>确认人</th>
              </tr>
            </thead>
            <tbody>
              {run.fieldMappingVersions.map((version) => (
                <tr key={version.id}>
                  <td>v{version.versionNumber}</td>
                  <td>{version.sourceSheetName} · {version.sourceColumnLabel}</td>
                  <td>{version.targetField} · {version.confidence}</td>
                  <td>{version.confirmedBy?.displayName ?? version.confirmedBy?.email ?? "系统"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Standardization</p>
            <h2>标准化数据预览</h2>
          </div>
          <span className="section-meta">关键算薪字段缺证据、员工未确认或映射低置信时不可确认</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>员工 / 门店</th>
                <th>标准字段</th>
                <th>值</th>
                <th>证据 / 问题</th>
                <th>确认</th>
              </tr>
            </thead>
            <tbody>
              {run.standardizedInputs.map((input) => (
                <tr key={input.id}>
                  <td>
                    <strong>{input.employee ? `${input.employee.employeeCode} · ${input.employee.fullName}` : "未匹配员工"}</strong>
                    <span>{input.storeCode ?? input.storeName ?? input.sourceSheetName ?? "无门店维度"}</span>
                  </td>
                  <td>
                    <strong>{input.standardField}</strong>
                    <span>{input.fieldMappingVersion?.sourceColumnLabel ?? "无映射版本"}</span>
                  </td>
                  <td>
                    <span>{input.amount?.toString() ?? formatJson(input.value)}</span>
                    <span>{input.currencyCode}</span>
                  </td>
                  <td>
                    <EvidenceChip label={input.evidenceStatus} status={input.evidenceStatus.toLowerCase() as "valid" | "missing" | "stale"} />
                    <span className="stacked-text">{formatJson(input.validationIssues)}</span>
                  </td>
                  <td>
                    {input.status === "PREVIEW" ? (
                      <form className="mini-version-form" action={confirmStandardizedInputAction}>
                        <input type="hidden" name="runId" value={run.id} />
                        <input type="hidden" name="inputId" value={input.id} />
                        <input type="hidden" name="expectedLockVersion" value={input.optimisticLockVersion} />
                        <input name="evidenceRefs" placeholder="证据 refs，逗号分隔" defaultValue={input.evidenceRefs.join(", ")} />
                        <button type="submit">确认标准化数据</button>
                      </form>
                    ) : (
                      <span className="status-pill">{input.status}</span>
                    )}
                  </td>
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
  return JSON.stringify(value).slice(0, 140);
}
