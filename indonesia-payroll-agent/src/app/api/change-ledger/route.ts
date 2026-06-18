import { NextResponse, type NextRequest } from "next/server";
import { handleApi } from "@/app/api/_utils/errors";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed, isSystemAdmin } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const runId = searchParams.get("runId")?.trim() || undefined;
    const clientId = searchParams.get("clientId")?.trim() || undefined;

    if (!runId && !clientId && !isSystemAdmin(actor)) {
      throw new Error("CHANGE_LEDGER_SCOPE_REQUIRED");
    }
    if (runId) {
      const run = await prisma.payrollRun.findUnique({
        where: { id: runId },
        select: { clientId: true },
      });
      if (!run) {
        throw new Error("PAYROLL_RUN_NOT_FOUND");
      }
      assertClientActionAllowed(actor, "viewClient", run.clientId);
    }
    if (clientId) {
      assertClientActionAllowed(actor, "viewClient", clientId);
    }

    const ledgerEntries = await prisma.changeLedgerEntry.findMany({
      where: { runId, clientId },
      include: {
        proposal: { select: { id: true, source: true, reason: true, rawInputItemId: true } },
        targetEmployee: { select: { id: true, employeeCode: true, fullName: true } },
        reviewedBy: { select: { id: true, displayName: true, email: true } },
      },
      orderBy: { reviewedAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ ledgerEntries });
  });
}
