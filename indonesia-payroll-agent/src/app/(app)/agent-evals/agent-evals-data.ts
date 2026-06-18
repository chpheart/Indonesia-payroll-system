import { actorHasPermission, type ActorContext } from "@/domain/auth/permissions";
import { releaseGateMatrix, runPhase7EvalSuite } from "@/domain/evals/eval-service";
import { prisma } from "@/lib/db/prisma";

export async function loadAgentEvalPageData(actor: ActorContext) {
  const suite = runPhase7EvalSuite();
  const matrix = releaseGateMatrix();

  if (!actorHasPermission(actor, "audit.view")) {
    return {
      suite,
      matrix,
      latestRuns: [],
      latestDataset: null,
      error: "ROLE_MISSING_PERMISSION",
    };
  }

  try {
    const [latestRuns, latestDataset] = await Promise.all([
      prisma.evalRun.findMany({
        where: { evalBindingRef: suite.evalBindingRef },
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

    return { suite, matrix, latestRuns, latestDataset, error: null };
  } catch (error) {
    return {
      suite,
      matrix,
      latestRuns: [],
      latestDataset: null,
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}

export type AgentEvalPageData = Awaited<ReturnType<typeof loadAgentEvalPageData>>;
