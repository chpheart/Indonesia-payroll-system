import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export async function loadPayrollCalculationSnapshot(runId: string, actor: ActorContext) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, clientId: true, payrollMonth: true },
  });
  if (!run) throw new Error("PAYROLL_RUN_NOT_FOUND");
  assertClientActionAllowed(actor, "viewSensitive", run.clientId);

  const results = await prisma.payrollResult.findMany({
    where: { runId, status: "FINAL" },
    orderBy: [{ calculatedAt: "desc" }, { employeeId: "asc" }],
    include: {
      employee: { select: { id: true, employeeCode: true, fullName: true } },
      lines: { orderBy: [{ lineType: "asc" }, { componentCode: "asc" }] },
      traces: { orderBy: [{ resultField: "asc" }, { createdAt: "asc" }] },
    },
  });
  const resultVersionRefs = [...new Set(results.map((result) => result.resultVersionRef))];
  const comparisons = resultVersionRefs.length > 0
    ? await prisma.customerComparisonValue.findMany({
        where: { runId, resultVersionRef: { in: resultVersionRefs } },
        orderBy: [{ employeeId: "asc" }, { targetField: "asc" }],
      })
    : [];
  const comparisonsByEmployee = new Map<string, typeof comparisons>();
  for (const comparison of comparisons) {
    const key = comparison.employeeId ?? "__run__";
    comparisonsByEmployee.set(key, [...(comparisonsByEmployee.get(key) ?? []), comparison]);
  }

  return {
    run: {
      id: run.id,
      clientId: run.clientId,
      payrollMonth: run.payrollMonth,
    },
    resultCount: results.length,
    traceCount: results.reduce((count, result) => count + result.traces.length, 0),
    resultVersionRefs,
    results: results.map((result) => ({
      id: result.id,
      employee: result.employee,
      resultVersionRef: result.resultVersionRef,
      calculatedAt: result.calculatedAt.toISOString(),
      status: result.status,
      totals: {
        grossPay: Number(result.grossPay),
        taxableIncome: Number(result.taxableIncome),
        pph21: Number(result.pph21),
        bpjsHealthEmployee: Number(result.bpjsHealthEmployee),
        bpjsEmploymentEmployee: Number(result.bpjsEmploymentEmployee),
        bpjsHealthEmployer: Number(result.bpjsHealthEmployer),
        bpjsEmploymentEmployer: Number(result.bpjsEmploymentEmployer),
        totalDeductions: Number(result.totalDeductions),
        netPay: Number(result.netPay),
        employerCost: Number(result.employerCost),
        currencyCode: result.currencyCode,
      },
      sourceVersionSnapshot: result.sourceVersionSnapshot,
      lines: result.lines.map((line) => ({
        id: line.id,
        lineType: line.lineType,
        componentCode: line.componentCode,
        label: line.label,
        amount: Number(line.amount),
        currencyCode: line.currencyCode,
        taxableCash: line.taxableCash,
        bpjsHealthBase: line.bpjsHealthBase,
        bpjsEmploymentBase: line.bpjsEmploymentBase,
        paidOut: line.paidOut,
        affectsNetPay: line.affectsNetPay,
        affectsEmployerCost: line.affectsEmployerCost,
        sourceInputIds: line.sourceInputIds,
        ruleVersionRefs: line.ruleVersionRefs,
      })),
      traces: result.traces.map((trace) => ({
        id: trace.id,
        resultField: trace.resultField,
        traceType: trace.traceType,
        inputRefs: trace.inputRefs,
        ruleVersionRefs: trace.ruleVersionRefs,
        formula: trace.formula,
        parameters: trace.parameters,
        intermediateValues: trace.intermediateValues,
        rounding: trace.rounding,
        outputValue: Number(trace.outputValue),
      })),
      comparisonValues: (comparisonsByEmployee.get(result.employeeId) ?? []).map((comparison) => ({
        id: comparison.id,
        sourceInputId: comparison.sourceInputId,
        targetField: comparison.targetField,
        customerValue: Number(comparison.customerValue),
        systemValue: comparison.systemValue === null ? null : Number(comparison.systemValue),
        delta: comparison.delta === null ? null : Number(comparison.delta),
        status: comparison.status,
        currencyCode: comparison.currencyCode,
        sourceLabel: comparison.sourceLabel,
        sourceCellId: comparison.sourceCellId,
      })),
    })),
  };
}
