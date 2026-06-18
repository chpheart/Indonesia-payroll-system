import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export async function resolveFileBinding(input: {
  actor: Awaited<ReturnType<typeof actorFromHeadersWithDatabase>>;
  clientId?: string;
  payrollMonth?: string;
  runId?: string;
}) {
  if (!input.runId) {
    if (input.clientId) {
      assertClientActionAllowed(input.actor, "updatePayrollRun", input.clientId);
    }
    return {
      clientId: input.clientId ?? null,
      payrollMonth: input.payrollMonth ?? null,
      runId: null,
    };
  }

  const run = await prisma.payrollRun.findUnique({
    where: { id: input.runId },
    select: { id: true, clientId: true, payrollMonth: true },
  });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);

  if (input.clientId && input.clientId !== run.clientId) {
    throw new Error("FILE_BINDING_MISMATCH");
  }

  if (input.payrollMonth && input.payrollMonth !== run.payrollMonth) {
    throw new Error("FILE_BINDING_MISMATCH");
  }

  return { clientId: run.clientId, payrollMonth: run.payrollMonth, runId: run.id };
}
