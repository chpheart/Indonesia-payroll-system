import Link from "next/link";
import {
  type AgentGovernanceData,
  runStatusClass,
} from "@/app/(app)/agent-governance/agent-governance-data";

type AgentGovernanceProps = {
  data: AgentGovernanceData;
};

export function AgentRunTraceSection({ data }: AgentGovernanceProps) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Trace</p>
          <h2>AgentRun 列表</h2>
        </div>
        <span className="section-meta">AgentStep · ToolInvocation · GuardrailResult</span>
      </div>
      {data.agentRuns.length === 0 && !data.error ? (
        <div className="empty-state">还没有 AgentRun trace。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>运行</th>
                <th>客户 / Run</th>
                <th>状态</th>
                <th>版本</th>
                <th>Trace 完整性</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {data.agentRuns.map((run) => (
                <tr key={run.id}>
                  <td>
                    <Link className="text-link" href={`/agent-runs/${run.id}`}>
                      {run.nodeType ?? "MULTI_NODE"}
                    </Link>
                    <span>{run.id}</span>
                  </td>
                  <td>
                    {run.client ? `${run.client.code} · ${run.client.name}` : run.clientId ?? "-"}
                    <span>{run.runId ?? "未绑定 PayrollRun"}</span>
                  </td>
                  <td>
                    <span className={`status-pill ${runStatusClass(run.status)}`}>
                      {run.status}
                    </span>
                    <span>{run.humanReviewStatus}</span>
                  </td>
                  <td>
                    <span className="stacked-text">
                      Prompt {run.promptVersion.promptKey} v{run.promptVersion.versionNumber}
                    </span>
                    <span className="stacked-text">
                      Model {run.modelVersion.modelName} v{run.modelVersion.versionNumber}
                    </span>
                  </td>
                  <td>
                    {run.steps.length} steps · {run.toolInvocations.length} tools ·{" "}
                    {run.guardrailResults.length} guardrails
                  </td>
                  <td>{run.createdAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function GuardrailSection({ data }: AgentGovernanceProps) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Guardrails</p>
          <h2>命中记录</h2>
        </div>
        <span className="risk-badge r3">Fail closed</span>
      </div>
      {data.guardrails.length === 0 ? (
        <div className="empty-state">当前没有已命中的 guardrail。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Guardrail</th>
                <th>动作</th>
                <th>AgentRun</th>
                <th>摘要</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {data.guardrails.map((guardrail) => (
                <tr key={guardrail.id}>
                  <td>
                    <strong>{guardrail.guardrailName}</strong>
                    <span>{guardrail.guardrailType}</span>
                  </td>
                  <td>
                    <span className={`risk-badge ${guardrail.severity === "CRITICAL" ? "r3" : "r2"}`}>
                      {guardrail.action}
                    </span>
                  </td>
                  <td>
                    <Link className="text-link" href={`/agent-runs/${guardrail.agentRunId}`}>
                      {guardrail.agentRun.nodeType ?? "MULTI_NODE"}
                    </Link>
                  </td>
                  <td>{JSON.stringify(guardrail.resultSummary)}</td>
                  <td>{guardrail.createdAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
