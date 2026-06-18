import { type ActorContext, isSystemAdmin } from "@/domain/auth/permissions";
import { type AgentNodeType } from "@/domain/agent/agent-types";
import { assertKnownNodeType } from "@/domain/agent/tool-registry";
import { prisma } from "@/lib/db/prisma";

export { ensureAgentVersions } from "@/app/api/agent/runs/agent-version-release-support";

export function readableAgentRunWhere(actor: ActorContext, clientId?: string) {
  if (clientId) {
    return { clientId };
  }
  if (isSystemAdmin(actor)) {
    return undefined;
  }
  if (actor.authorizedClientIds.length > 0) {
    return { clientId: { in: actor.authorizedClientIds } };
  }
  return { id: "__no_readable_agent_runs__" };
}

export function normalizeNodeTypes(nodeType?: string, nodeTypes?: string[]): AgentNodeType[] {
  const raw = nodeTypes && nodeTypes.length > 0 ? nodeTypes : [nodeType ?? "INTAKE_CLASSIFICATION"];
  return raw.map((value) => {
    assertKnownNodeType(value);
    return value;
  });
}

export async function loadPayrollRun(runId: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, clientId: true, payrollMonth: true, status: true },
  });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  return run;
}

export async function loadContextSource(input: {
  runId: string;
  clientId: string;
  payrollMonth: string;
  userPrompt?: string;
}) {
  const [run, rawInputs, workbookCells] = await Promise.all([
    loadContextRun(input),
    prisma.rawInputItem.findMany({
      where: { runId: input.runId, clientId: input.clientId, payrollMonth: input.payrollMonth },
      select: {
        id: true,
        sourceChannel: true,
        inputType: true,
        status: true,
        redactedSummary: true,
        contentHash: true,
        evidenceCandidateRefs: true,
        securityFlags: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.workbookCell.findMany({
      where: { workbookParse: { fileVersion: { runId: input.runId, clientId: input.clientId } } },
      select: {
        sheetName: true,
        address: true,
        displayValue: true,
        formulaText: true,
        isHeader: true,
      },
      take: 50,
    }),
  ]);

  return {
    run: run ?? undefined,
    rawInputs,
    workbookCells,
    evidenceRefs: rawInputs.flatMap((item) => item.evidenceCandidateRefs),
    userPrompt: input.userPrompt,
  };
}

async function loadContextRun(input: { runId: string }) {
  return prisma.payrollRun.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      clientId: true,
      payrollMonth: true,
      status: true,
      blockingIssueCount: true,
      highRiskIssueCount: true,
      pendingCustomerConfirmationCount: true,
    },
  });
}
