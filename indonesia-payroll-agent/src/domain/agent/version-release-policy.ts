import { type AgentVersionStatus } from "@/domain/agent/agent-types";

export class AgentVersionReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentVersionReleaseError";
  }
}

export function assertAgentVersionReusable(status: AgentVersionStatus, targetRef: string): void {
  if (status === "REVOKED" || status === "DEPRECATED") {
    throw new AgentVersionReleaseError(`AGENT_VERSION_NOT_REUSABLE:${targetRef}:${status}`);
  }
}
