import { actorHasPermission, isSystemAdmin, type ActorContext } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export async function loadAgentGovernanceData(actor: ActorContext) {
  try {
    if (!actorHasPermission(actor, "audit.view")) {
      return emptyData("ROLE_MISSING_PERMISSION");
    }

    const agentRunWhere = readableAgentRunWhere(actor);
    const [
      agentRuns,
      promptVersions,
      modelVersions,
      retrievalVersions,
      toolVersions,
      guardrails,
      evalRuns,
    ] = await Promise.all([
        prisma.agentRun.findMany({
          where: agentRunWhere,
          include: {
            client: { select: { code: true, name: true } },
            promptVersion: { select: { promptKey: true, versionNumber: true, status: true } },
            modelVersion: { select: { modelName: true, versionNumber: true, status: true } },
            toolSchemaVersion: { select: { toolName: true, schemaVersion: true, status: true } },
            steps: { orderBy: { sequence: "asc" }, take: 4 },
            toolInvocations: { orderBy: { createdAt: "asc" }, take: 4 },
            guardrailResults: { orderBy: { createdAt: "asc" }, take: 4 },
          },
          orderBy: { createdAt: "desc" },
          take: 60,
        }),
        prisma.promptVersion.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
        prisma.modelVersion.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
        prisma.retrievalIndexVersion.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
        prisma.toolSchemaVersion.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
        prisma.guardrailResult.findMany({
          where: { triggered: true, agentRun: agentRunWhere },
          include: { agentRun: { select: { id: true, nodeType: true, clientId: true } } },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
        prisma.evalRun.findMany({
          include: {
            results: {
              include: { evalCase: { select: { caseKey: true, caseType: true, riskLevel: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 30,
        }),
      ]);

    return {
      agentRuns,
      promptVersions,
      modelVersions,
      retrievalVersions,
      toolVersions,
      guardrails,
      evalRuns,
      error: null,
    };
  } catch (error) {
    return emptyData(error instanceof Error ? error.message : "数据库连接失败");
  }
}

export type AgentGovernanceData = Awaited<ReturnType<typeof loadAgentGovernanceData>>;

export function versionStatusClass(status: string) {
  if (status === "RELEASED" || status === "PASSED") {
    return "active";
  }
  if (status === "REVOKED") {
    return "revoked";
  }
  if (status === "DEPRECATED") {
    return "deprecated";
  }
  if (["FAILED", "BLOCKED"].includes(status)) {
    return "terminated";
  }
  return "draft";
}

export function runStatusClass(status: string) {
  if (status === "SUCCEEDED") {
    return "active";
  }
  if (status === "FAILED" || status === "CANCELLED") {
    return "terminated";
  }
  return "draft";
}

function readableAgentRunWhere(actor: ActorContext) {
  if (isSystemAdmin(actor)) {
    return undefined;
  }
  if (actor.authorizedClientIds.length > 0) {
    return { clientId: { in: actor.authorizedClientIds } };
  }
  return { id: "__no_readable_agent_runs__" };
}

function emptyData(error: string) {
  return {
    agentRuns: [],
    promptVersions: [],
    modelVersions: [],
    retrievalVersions: [],
    toolVersions: [],
    guardrails: [],
    evalRuns: [],
    error,
  };
}
