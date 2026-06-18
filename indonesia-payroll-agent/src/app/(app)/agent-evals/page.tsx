import { currentActor } from "@/app/(app)/server-actor";
import {
  loadAgentEvalPageData,
  type AgentEvalPageData,
} from "@/app/(app)/agent-evals/agent-evals-data";
import { versionStatusClass } from "@/app/(app)/agent-governance/agent-governance-data";

export const dynamic = "force-dynamic";

export default async function AgentEvalsPage() {
  const actor = await currentActor();
  const data = await loadAgentEvalPageData(actor);

  return (
    <div className="page-stack">
      <EvalMetrics data={data} />
      {data.error ? <div className="alert error">Eval 数据不可用：{data.error}</div> : null}
      <ReleaseGateMatrix data={data} />
      <EvalCaseSection data={data} />
      <EvalRunHistory data={data} />
    </div>
  );
}

function EvalMetrics({ data }: { data: AgentEvalPageData }) {
  return (
    <div className="metric-grid run-metrics" aria-label="Golden Eval 指标">
      <MetricCard label="Suite" value={data.suite.totalCaseCount} hint={data.suite.targetRef} />
      <MetricCard label="Passed" value={data.suite.passedCaseCount} hint="当前静态门禁" />
      <MetricCard label="Failed" value={data.suite.failedCaseCount} hint="失败即阻断发布" />
      <MetricCard label="Guardrail" value={guardrailCount(data)} hint="红队 / 权限 / 敏感字段" />
    </div>
  );
}

function ReleaseGateMatrix({ data }: { data: AgentEvalPageData }) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Release Gate</p>
          <h2>Workflow Node 门禁</h2>
        </div>
        <span className={`status-pill ${versionStatusClass(data.suite.status)}`}>
          {data.suite.releaseGatePassed ? "PASSED" : "FAILED"}
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Node</th>
              <th>Release</th>
              <th>Cases</th>
              <th>Guardrail</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {data.matrix.map((node) => (
              <tr key={node.nodeType}>
                <td>
                  <strong>{node.nodeType}</strong>
                </td>
                <td>
                  <span className={`status-pill ${node.releaseAllowed ? "active" : "terminated"}`}>
                    {node.releaseAllowed ? "ALLOWED" : "BLOCKED"}
                  </span>
                </td>
                <td>{node.total}</td>
                <td>{node.guardrail}</td>
                <td>{node.failed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EvalCaseSection({ data }: { data: AgentEvalPageData }) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Golden Cases</p>
          <h2>Phase 7 用例结果</h2>
        </div>
        <span className="risk-badge r2">蓝色光标 / 三福 / Red Team</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Node</th>
              <th>类型</th>
              <th>风险</th>
              <th>状态</th>
              <th>失败原因</th>
            </tr>
          </thead>
          <tbody>
            {data.suite.results.map((result) => (
              <tr key={result.caseKey}>
                <td>
                  <strong>{result.caseKey}</strong>
                </td>
                <td>{result.nodeType}</td>
                <td>{result.caseType}</td>
                <td>
                  <span className={`risk-badge ${result.riskLevel.toLowerCase()}`}>
                    {result.riskLevel}
                  </span>
                </td>
                <td>
                  <span className={`status-pill ${versionStatusClass(result.status)}`}>
                    {result.status}
                  </span>
                </td>
                <td>{result.failureReason ?? "无"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EvalRunHistory({ data }: { data: AgentEvalPageData }) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">EvalRun</p>
          <h2>落库运行记录</h2>
        </div>
        <span className="risk-badge r1">
          Dataset {data.latestDataset ? `v${data.latestDataset.versionNumber}` : "未落库"}
        </span>
      </div>
      {data.latestRuns.length === 0 ? (
        <div className="empty-state">还没有 Phase 7 EvalRun 落库记录。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Run</th>
                <th>状态</th>
                <th>通过</th>
                <th>失败 / 阻断</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {data.latestRuns.map((run) => (
                <tr key={run.id}>
                  <td>
                    <strong>{run.evalBindingRef}</strong>
                    <span>{run.id}</span>
                  </td>
                  <td>
                    <span className={`status-pill ${versionStatusClass(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td>
                    {run.passedCaseCount}/{run.totalCaseCount}
                  </td>
                  <td>{failedRunResults(run)}</td>
                  <td>{(run.completedAt ?? run.createdAt).toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{hint}</p>
    </div>
  );
}

function guardrailCount(data: AgentEvalPageData) {
  return data.suite.results.filter((result) =>
    ["GUARDRAIL", "PERMISSION"].includes(result.caseType),
  ).length;
}

function failedRunResults(run: AgentEvalPageData["latestRuns"][number]) {
  const failed = run.results.filter((result) => result.status !== "PASSED");
  if (failed.length === 0) {
    return "无";
  }
  return failed
    .map((result) => `${result.evalCase.caseKey}: ${result.failureReason ?? result.status}`)
    .join(" · ");
}
