import { currentActor } from "@/app/(app)/server-actor";
import { loadAgentGovernanceData } from "@/app/(app)/agent-governance/agent-governance-data";
import {
  AgentGovernanceMetrics,
  AgentVersionGateSection,
  EvalRunSection,
} from "@/app/(app)/agent-governance/agent-governance-summary";
import {
  AgentRunTraceSection,
  GuardrailSection,
} from "@/app/(app)/agent-governance/agent-governance-trace-sections";

export const dynamic = "force-dynamic";

export default async function AgentGovernancePage() {
  const actor = await currentActor();
  const data = await loadAgentGovernanceData(actor);

  return (
    <div className="page-stack">
      <AgentGovernanceMetrics data={data} />
      {data.error ? <div className="alert error">Agent 治理不可用：{data.error}</div> : null}
      <AgentVersionGateSection data={data} />
      <EvalRunSection data={data} />
      <AgentRunTraceSection data={data} />
      <GuardrailSection data={data} />
    </div>
  );
}
