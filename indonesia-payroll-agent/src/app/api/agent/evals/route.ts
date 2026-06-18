import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { actorHasPermission, PermissionDeniedError } from "@/domain/auth/permissions";
import {
  persistPhase7EvalRun,
  releaseGateMatrix,
  runPhase7EvalSuite,
} from "@/domain/evals/eval-service";
import { AGENT_WORKFLOW_ORDER } from "@/domain/agent/nodes/node-registry";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const evalRequestSchema = z.object({
  caseKeys: z.array(z.string().min(1)).optional(),
  nodeTypes: z.array(z.enum(AGENT_WORKFLOW_ORDER)).optional(),
});

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    assertCanViewEval(actor);
    const [latestRuns, latestDataset] = await Promise.all([
      prisma.evalRun.findMany({
        where: { evalBindingRef: "critical:phase7-golden-eval-guardrails:v1" },
        include: {
          results: {
            include: { evalCase: { select: { caseKey: true, caseType: true, riskLevel: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.evalDataset.findFirst({
        where: { datasetKey: "phase7-golden-eval-guardrails" },
        orderBy: { versionNumber: "desc" },
        include: { cases: { orderBy: { caseKey: "asc" } } },
      }),
    ]);

    return NextResponse.json({
      suite: runPhase7EvalSuite(),
      releaseGateMatrix: releaseGateMatrix(),
      latestDataset,
      latestRuns,
    });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    assertCanViewEval(actor);
    const body = evalRequestSchema.parse(await request.json());
    if (body.caseKeys?.length || body.nodeTypes?.length) {
      throw new Error("PARTIAL_EVAL_RUN_CANNOT_BE_RELEASE_GATE");
    }
    const evalRun = await persistPhase7EvalRun(prisma);
    return NextResponse.json({ evalRun }, { status: 201 });
  });
}

function assertCanViewEval(actor: Parameters<typeof actorHasPermission>[0]) {
  if (!actorHasPermission(actor, "audit.view")) {
    throw new PermissionDeniedError("ROLE_MISSING_PERMISSION");
  }
}
