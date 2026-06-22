import { NextResponse, type NextRequest } from "next/server";
import { handleApi } from "@/app/api/_utils/errors";
import {
  assertCalculationGate,
  loadCalculationInput,
} from "@/app/api/payroll-runs/[runId]/calculate/calculation-data";
import {
  persistCalculationErrorBlocker,
  persistPayrollCalculation,
  persistPostCalculationBlockers,
} from "@/app/api/payroll-runs/[runId]/calculate/calculation-persistence";
import { loadPayrollCalculationSnapshot } from "@/app/api/payroll-runs/[runId]/calculate/calculation-read";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { calculatePayroll } from "@/domain/payroll-engine/engine";
import { evaluatePostCalculation } from "@/domain/payroll-engine/postcheck";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { runId } = await context.params;
    const snapshot = await loadPayrollCalculationSnapshot(runId, actor);
    return NextResponse.json(snapshot);
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { runId } = await context.params;
    const gate = await assertCalculationGate(runId, actor);
    assertClientActionAllowed(actor, "executeCalculation", gate.loadedPrecheck.run.clientId);
    const calculation = await runCalculationFailClosed(gate, auditFields);
    const { engineInput, output } = calculation;
    const postcheck = evaluatePostCalculation(engineInput, output);

    if (postcheck.status === "BLOCKED") {
      await prisma.$transaction((tx) =>
        persistPostCalculationBlockers(tx, gate.loadedPrecheck.run, postcheck, auditFields),
      );
      return NextResponse.json({
        errorCode: "PAYROLL_POSTCHECK_BLOCKED",
        checks: postcheck.checks,
        issues: postcheck.issues,
      }, { status: 409 });
    }

    await prisma.$transaction((tx) =>
      persistPayrollCalculation(tx, gate.loadedPrecheck.run, output, auditFields),
    );

    return NextResponse.json({
      resultVersionRef: output.resultVersionRef,
      resultCount: output.results.length,
      traceCount: output.results.reduce((count, result) => count + result.traces.length, 0),
      comparisonValueCount: output.results.reduce(
        (count, result) => count + result.comparisonValues.length,
        0,
      ),
      postcheck: postcheck.checks,
    }, { status: 201 });
  });
}

async function runCalculationFailClosed(
  gate: Awaited<ReturnType<typeof assertCalculationGate>>,
  auditFields: Awaited<ReturnType<typeof requestAuditFields>>,
) {
  try {
    const engineInput = await loadCalculationInput(gate);
    const output = calculatePayroll(engineInput);
    return { engineInput, output };
  } catch (error) {
    const errorCode = error instanceof Error && isPublicErrorCode(error.message)
      ? error.message
      : "PAYROLL_CALCULATION_FAILED";
    await prisma.$transaction((tx) =>
      persistCalculationErrorBlocker(tx, gate.loadedPrecheck.run, errorCode, auditFields),
    );
    throw new Error(errorCode);
  }
}

function isPublicErrorCode(message: string) {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(message);
}
