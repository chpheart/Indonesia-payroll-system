import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import {
  ensureAgentVersions,
  loadContextSource,
  loadPayrollRun,
  normalizeNodeTypes,
  readableAgentRunWhere,
} from "@/app/api/agent/runs/agent-run-api-support";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { AgentOrchestrator } from "@/domain/agent/agent-orchestrator";
import { AgentTraceService } from "@/domain/agent/agent-trace-service";
import { PrismaAgentTraceStore } from "@/domain/agent/prisma-agent-trace-store";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const runRequestSchema = z.object({
  runId: z.string().min(1),
  nodeType: z.string().min(1).optional(),
  nodeTypes: z.array(z.string().min(1)).optional(),
  contextSnapshotId: z.string().min(1).optional(),
  sourceObjectRefs: z.array(z.string()).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  userPrompt: z.string().max(2000).optional(),
  formalRun: z.boolean().default(false),
  modelName: z.string().min(1).default("gpt-5.4-mini"),
});

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const clientId = request.nextUrl.searchParams.get("clientId")?.trim() || undefined;
    if (clientId) {
      assertClientActionAllowed(actor, "viewAudit", clientId);
    }

    const agentRuns = await prisma.agentRun.findMany({
      where: readableAgentRunWhere(actor, clientId),
      include: {
        client: { select: { code: true, name: true } },
        promptVersion: { select: { promptKey: true, versionNumber: true, status: true } },
        modelVersion: { select: { modelName: true, versionNumber: true, status: true } },
        retrievalIndexVersion: { select: { indexKey: true, versionNumber: true, status: true } },
        toolSchemaVersion: { select: { toolName: true, schemaVersion: true, status: true } },
        steps: { orderBy: { sequence: "asc" }, take: 20 },
        toolInvocations: { orderBy: { createdAt: "asc" }, take: 20 },
        guardrailResults: { orderBy: { createdAt: "asc" }, take: 20 },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
    });

    return NextResponse.json({ agentRuns });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = runRequestSchema.parse(await request.json());
    const nodeTypes = normalizeNodeTypes(body.nodeType, body.nodeTypes);
    const run = await loadPayrollRun(body.runId);
    const clientId = run.clientId;

    assertClientActionAllowed(actor, "updatePayrollRun", clientId);

    const versions = await ensureAgentVersions(nodeTypes, body.modelName);
    const contextSource = await loadContextSource({
      runId: body.runId,
      clientId,
      payrollMonth: run.payrollMonth,
      userPrompt: body.userPrompt,
    });
    const traceService = new AgentTraceService(new PrismaAgentTraceStore(prisma));
    const orchestrator = new AgentOrchestrator(traceService);
    const result = await orchestrator.runWorkflow({
      actor,
      runId: body.runId,
      clientId,
      payrollMonth: run.payrollMonth,
      triggerSource: "API",
      nodeTypes,
      contextSnapshotId:
        body.contextSnapshotId ?? `${body.runId}:${Date.now()}`,
      promptVersionId: versions.promptVersionId,
      modelVersionId: versions.modelVersionId,
      retrievalIndexVersionId: versions.retrievalIndexVersionId,
      toolSchemaVersionId: versions.primaryToolSchemaVersionId,
      toolSchemaVersionIds: versions.toolSchemaVersionIds,
      releaseEvalRunIds: versions.releaseEvalRunIds,
      requiredEvalBindingRefs: versions.requiredEvalBindingRefs,
      memorySnapshotRef: versions.memorySnapshotRef,
      modelName: body.modelName,
      formalRun: body.formalRun,
      contextSource,
      sourceObjectRefs: body.sourceObjectRefs,
      evidenceRefs: body.evidenceRefs,
      userPrompt: body.userPrompt,
    });

    await prisma.auditLog.create({
      data: {
        action: "AGENT_RUN_CREATED",
        objectType: "AGENT_RUN",
        objectId: result.agentRunId,
        riskLevel: nodeTypes.some((nodeType) =>
          ["CHANGE_EXTRACTION", "FIELD_MAPPING", "EMPLOYEE_MATCHING", "EVIDENCE_LINKING", "CUSTOMER_CONFIRMATION_PACK"].includes(nodeType),
        )
          ? "R2"
          : "R1",
        ...auditFields,
        clientId,
        runId: body.runId,
        metadata: {
          nodeTypes,
          formalRun: body.formalRun,
          inputSummary: "Agent workflow triggered through controlled API",
          outputSummary: "Agent outputs are candidates only and require human/system gates",
        },
      },
    });

    return NextResponse.json(result, { status: 201 });
  });
}
