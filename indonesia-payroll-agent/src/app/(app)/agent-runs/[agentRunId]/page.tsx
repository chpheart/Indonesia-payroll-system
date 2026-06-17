import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import {
  assertClientActionAllowed,
  type ActorContext,
} from "@/domain/auth/permissions";
import { currentActor } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ agentRunId: string }>;
};

async function loadAgentRun(actor: ActorContext, agentRunId: string) {
  try {
    const agentRun = await prisma.agentRun.findUnique({
      where: { id: agentRunId },
      include: {
        client: { select: { code: true, name: true } },
        promptVersion: true,
        modelVersion: true,
        retrievalIndexVersion: true,
        toolSchemaVersion: true,
        steps: { orderBy: { sequence: "asc" }, include: { guardrailResults: true } },
        toolInvocations: { orderBy: { createdAt: "asc" }, include: { guardrailResults: true } },
        guardrailResults: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!agentRun) {
      return { agentRun: null, error: null };
    }

    assertClientActionAllowed(actor, "viewAudit", agentRun.clientId);

    return { agentRun, error: null };
  } catch (error) {
    return {
      agentRun: null,
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}

export default async function AgentRunDetailPage({ params }: PageProps) {
  const actor = await currentActor();
  const { agentRunId } = await params;
  const { agentRun, error } = await loadAgentRun(actor, agentRunId);

  if (error) {
    return <div className="alert error">AgentRun 不可用：{error}</div>;
  }

  if (!agentRun) {
    return <div className="empty-state">AgentRun 不存在，或当前用户无权访问。</div>;
  }

  return (
    <div className="page-stack">
      <header className="run-header">
        <Link className="back-button" href="/agent-governance" aria-label="返回 Agent 治理">
          <ChevronLeft aria-hidden size={17} />
        </Link>
        <div>
          <h2>{agentRun.nodeType ?? "Multi-node AgentRun"}</h2>
          <span>
            {agentRun.client ? `${agentRun.client.code} · ${agentRun.client.name}` : agentRun.clientId} ·{" "}
            {agentRun.runId}
          </span>
        </div>
        <span className={`status-pill ${agentRun.status === "SUCCEEDED" ? "active" : "draft"}`}>
          {agentRun.status}
        </span>
      </header>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Version Anchor</p>
            <h2>版本锚点</h2>
          </div>
          <span className="risk-badge r1">{agentRun.humanReviewStatus}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Prompt</th>
                <th>Model</th>
                <th>RAG</th>
                <th>Tool Schema</th>
                <th>Memory</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {agentRun.promptVersion.promptKey} v{agentRun.promptVersion.versionNumber}
                </td>
                <td>
                  {agentRun.modelVersion.modelName} v{agentRun.modelVersion.versionNumber}
                </td>
                <td>
                  {agentRun.retrievalIndexVersion
                    ? `${agentRun.retrievalIndexVersion.indexKey} v${agentRun.retrievalIndexVersion.versionNumber}`
                    : "-"}
                </td>
                <td>
                  {agentRun.toolSchemaVersion
                    ? `${agentRun.toolSchemaVersion.toolName} ${agentRun.toolSchemaVersion.schemaVersion}`
                    : "见 ToolInvocation"}
                </td>
                <td>{agentRun.memorySnapshotRef ?? "-"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">AgentStep</p>
            <h2>节点 trace</h2>
          </div>
          <span className="section-meta">{agentRun.steps.length} steps</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>节点</th>
                <th>状态</th>
                <th>风险 / 置信</th>
                <th>输入摘要</th>
                <th>输出摘要</th>
                <th>Guardrail</th>
              </tr>
            </thead>
            <tbody>
              {agentRun.steps.map((step) => (
                <tr key={step.id}>
                  <td>
                    <strong>{step.nodeType}</strong>
                    <span>#{step.sequence}</span>
                  </td>
                  <td>{step.status}</td>
                  <td>
                    <span className={`risk-badge ${step.riskLevel.toLowerCase()}`}>
                      {step.riskLevel}
                    </span>
                    <span>{step.confidence ?? "-"}</span>
                  </td>
                  <td>{JSON.stringify(step.inputSummary)}</td>
                  <td>{JSON.stringify(step.outputSummary)}</td>
                  <td>{step.guardrailResults.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">ToolInvocation</p>
            <h2>工具调用</h2>
          </div>
          <span className="risk-badge r2">R2+ preview only</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>工具</th>
                <th>状态</th>
                <th>权限 / 风险</th>
                <th>审批</th>
                <th>参数摘要</th>
                <th>输出摘要</th>
              </tr>
            </thead>
            <tbody>
              {agentRun.toolInvocations.map((tool) => (
                <tr key={tool.id}>
                  <td>
                    <strong>{tool.toolName}</strong>
                    <span>{tool.toolVersion}</span>
                  </td>
                  <td>{tool.status}</td>
                  <td>
                    {tool.permissionLevel}
                    <span className={`risk-badge ${tool.riskLevel.toLowerCase()}`}>
                      {tool.riskLevel}
                    </span>
                  </td>
                  <td>{tool.approvalStatus}</td>
                  <td>{JSON.stringify(tool.parameterSummary)}</td>
                  <td>{JSON.stringify(tool.outputSummary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">GuardrailResult</p>
            <h2>护栏结果</h2>
          </div>
          <span className="section-meta">{agentRun.guardrailResults.length} records</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>严重级别</th>
                <th>动作</th>
                <th>命中</th>
                <th>摘要</th>
              </tr>
            </thead>
            <tbody>
              {agentRun.guardrailResults.map((guardrail) => (
                <tr key={guardrail.id}>
                  <td>{guardrail.guardrailName}</td>
                  <td>{guardrail.severity}</td>
                  <td>{guardrail.action}</td>
                  <td>{guardrail.triggered ? "Yes" : "No"}</td>
                  <td>{JSON.stringify(guardrail.resultSummary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
