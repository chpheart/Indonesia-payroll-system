import { NextResponse, type NextRequest } from "next/server";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export async function listCustomerConfirmationPacks(request: NextRequest, runId: string) {
  const actor = await actorFromHeadersWithDatabase(request.headers);
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { clientId: true },
  });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  assertClientActionAllowed(actor, "viewClient", run.clientId);

  const packs = await prisma.customerConfirmationPack.findMany({
    where: { runId },
    include: {
      items: {
        include: { targetEmployee: { select: { employeeCode: true, fullName: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
      confirmations: {
        include: { evidence: { select: { id: true, redactedSummary: true, kind: true, sourceLabel: true } } },
        orderBy: { backfilledAt: "desc" },
      },
      generatedBy: { select: { displayName: true, email: true } },
    },
    orderBy: { versionNumber: "desc" },
    take: 10,
  });

  return NextResponse.json({ packs });
}
