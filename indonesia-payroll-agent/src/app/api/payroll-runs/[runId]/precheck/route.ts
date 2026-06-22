import { NextResponse, type NextRequest } from "next/server";
import { handleApi } from "@/app/api/_utils/errors";
import {
  loadPayrollPrecheck,
  persistPayrollPrecheck,
} from "@/app/api/payroll-runs/[runId]/precheck/precheck-data";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { runId } = await context.params;
    const loaded = await loadPayrollPrecheck(runId, actor);
    assertClientActionAllowed(actor, "executeCalculation", loaded.run.clientId);
    const precheck = await prisma.$transaction((tx) =>
      persistPayrollPrecheck(tx, loaded, auditFields),
    );

    return NextResponse.json({
      precheck,
      status: loaded.evaluation.status,
      gates: loaded.evaluation.gates,
      issues: loaded.evaluation.issues,
    }, { status: loaded.evaluation.status === "PASSED" ? 200 : 409 });
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { runId } = await context.params;
    const run = await prisma.payrollRun.findUnique({
      where: { id: runId },
      select: { clientId: true },
    });
    if (!run) throw new Error("PAYROLL_RUN_NOT_FOUND");
    assertClientActionAllowed(actor, "viewClient", run.clientId);
    const [prechecks, blockingIssues] = await Promise.all([
      prisma.precheckRun.findMany({
        where: { runId },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.blockingIssue.findMany({
        where: { runId, status: "OPEN" },
        orderBy: [{ riskLevel: "desc" }, { createdAt: "desc" }],
      }),
    ]);
    return NextResponse.json({ prechecks, blockingIssues });
  });
}
