import {
  type AgentGovernanceData,
  versionStatusClass,
} from "@/app/(app)/agent-governance/agent-governance-data";

type AgentGovernanceProps = {
  data: AgentGovernanceData;
};

export function AgentGovernanceMetrics({ data }: AgentGovernanceProps) {
  const releasedVersionCount = [
    ...data.promptVersions,
    ...data.modelVersions,
    ...data.retrievalVersions,
    ...data.toolVersions,
  ].filter((version) => version.status === "RELEASED").length;
  const revokedVersionCount = [
    ...data.promptVersions,
    ...data.modelVersions,
    ...data.retrievalVersions,
    ...data.toolVersions,
  ].filter((version) => ["REVOKED", "DEPRECATED"].includes(version.status)).length;

  return (
    <div className="metric-grid run-metrics" aria-label="Agent 治理指标">
      <MetricCard label="AgentRun" value={data.agentRuns.length} hint="近 60 条 trace" />
      <MetricCard
        label="Released"
        value={releasedVersionCount}
        hint="prompt / model / RAG / tool schema"
      />
      <MetricCard label="Revoked" value={revokedVersionCount} hint="停用或废弃版本" />
      <MetricCard label="Guardrail" value={data.guardrails.length} hint="已命中需处理" />
      <MetricCard label="EvalRun" value={data.evalRuns.length} hint="发布门禁记录" />
    </div>
  );
}

export function AgentVersionGateSection({ data }: AgentGovernanceProps) {
  const versions = [
    ...data.promptVersions.map((version) => ({
      type: "Prompt",
      name: version.promptKey,
      version: version.versionNumber,
      status: version.status,
      refs: [version.evalBindingRef, version.guardrailBindingRef].filter(Boolean).join(" · "),
      revocationReason: version.revocationReason,
      revocationImpactScope: version.revocationImpactScope,
      updatedAt: version.updatedAt,
    })),
    ...data.modelVersions.map((version) => ({
      type: "Model",
      name: version.modelName,
      version: version.versionNumber,
      status: version.status,
      refs: version.evalBindingRef ?? "-",
      revocationReason: version.revocationReason,
      revocationImpactScope: version.revocationImpactScope,
      updatedAt: version.updatedAt,
    })),
    ...data.retrievalVersions.map((version) => ({
      type: "RAG",
      name: version.indexKey,
      version: version.versionNumber,
      status: version.status,
      refs: version.evalBindingRef ?? "-",
      revocationReason: version.revocationReason,
      revocationImpactScope: version.revocationImpactScope,
      updatedAt: version.updatedAt,
    })),
    ...data.toolVersions.map((version) => ({
      type: "Tool",
      name: version.toolName,
      version: version.schemaVersion,
      status: version.status,
      refs: [version.evalBindingRef, version.guardrailBindingRef].filter(Boolean).join(" · "),
      revocationReason: version.revocationReason,
      revocationImpactScope: version.revocationImpactScope,
      updatedAt: version.updatedAt,
    })),
  ];

  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">SCREEN-012</p>
          <h2>Agent 版本门禁</h2>
        </div>
        <span className="risk-badge r2">候选层 / Eval / Guardrail</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>对象</th>
              <th>版本</th>
              <th>状态</th>
              <th>Eval / Guardrail</th>
              <th>停用原因 / 影响</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={`${version.type}-${version.name}-${version.version}`}>
                <td>
                  <strong>{version.type}</strong>
                  <span>{version.name}</span>
                </td>
                <td>{version.version}</td>
                <td>
                  <span className={`status-pill ${versionStatusClass(version.status)}`}>
                    {version.status}
                  </span>
                </td>
                <td>{version.refs || "-"}</td>
                <td>
                  {["REVOKED", "DEPRECATED"].includes(version.status) ? (
                    <>
                      <span className="risk-badge r3">
                        {version.revocationReason ?? "停用原因未记录"}
                      </span>
                      <span>{formatRevocationImpact(version.revocationImpactScope)}</span>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
                <td>{version.updatedAt.toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EvalRunSection({ data }: AgentGovernanceProps) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Release Gate</p>
          <h2>EvalRun 结果</h2>
        </div>
        <span className="risk-badge r2">Golden / Guardrail / Permission</span>
      </div>
      {data.evalRuns.length === 0 ? (
        <div className="empty-state">还没有发布门禁 EvalRun。</div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Binding</th>
                <th>目标</th>
                <th>状态</th>
                <th>用例</th>
                <th>失败 / 阻断原因</th>
                <th>时间</th>
              </tr>
            </thead>
            <tbody>
              {data.evalRuns.map((evalRun) => (
                <EvalRunRow key={evalRun.id} evalRun={evalRun} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EvalRunRow({ evalRun }: { evalRun: AgentGovernanceData["evalRuns"][number] }) {
  const failedResults = evalRun.results.filter((result) => result.status !== "PASSED");
  return (
    <tr>
      <td>
        <strong>{evalRun.evalBindingRef}</strong>
        <span>{evalRun.id}</span>
      </td>
      <td>
        {evalRun.targetType}
        <span>{evalRun.targetRef}</span>
      </td>
      <td>
        <span className={`status-pill ${versionStatusClass(evalRun.status)}`}>
          {evalRun.status}
        </span>
      </td>
      <td>
        {evalRun.passedCaseCount}/{evalRun.totalCaseCount} passed
        <span>
          {evalRun.results.map((result) => `${result.evalCase.caseKey}:${result.status}`).join(" · ")}
        </span>
      </td>
      <td>
        {failedResults.length === 0
          ? "无"
          : failedResults
              .map((result) => `${result.evalCase.caseKey}: ${result.failureReason ?? "EVAL_CASE_FAILED"}`)
              .join(" · ")}
      </td>
      <td>{(evalRun.completedAt ?? evalRun.createdAt).toISOString()}</td>
    </tr>
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

function formatRevocationImpact(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) {
      return entries.map(([key, child]) => `${key}: ${String(child)}`).join(" · ");
    }
  }
  return "影响范围未记录";
}
