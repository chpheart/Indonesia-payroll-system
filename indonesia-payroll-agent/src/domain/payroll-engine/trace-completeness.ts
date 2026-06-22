export type TraceForCompleteness = {
  resultField: string;
  parameters: Record<string, unknown>;
  rounding: Record<string, unknown>;
};

export const REQUIRED_TRACE_FIELDS = [
  "grossPay",
  "taxableIncome",
  "pph21",
  "bpjsHealthEmployee",
  "bpjsEmploymentEmployee",
  "bpjsHealthEmployer",
  "bpjsEmploymentEmployer",
  "netPay",
  "employerCost",
];

const REQUIRED_PARAMETER_FIELDS = new Map([
  ["pph21", ["method", "npwpPenaltyMultiplier"]],
  ["bpjsHealthEmployee", ["healthEmployeeRate", "healthWageCap"]],
  ["bpjsEmploymentEmployee", ["jhtEmployeeRate", "jpEmployeeRate", "employmentWageCap", "jpWageCap", "jpExempt"]],
  ["bpjsHealthEmployer", ["healthEmployerRate", "healthWageCap"]],
  ["bpjsEmploymentEmployer", ["jhtEmployerRate", "jpEmployerRate", "jkkEmployerRate", "jkmEmployerRate", "employmentWageCap", "jpWageCap", "jpExempt"]],
]);

export function missingTraceFields(traces: TraceForCompleteness[]) {
  const fields = new Set(traces.map((trace) => trace.resultField));
  return REQUIRED_TRACE_FIELDS.filter((field) => !fields.has(field));
}

export function incompleteTraceFields(traces: TraceForCompleteness[]) {
  const tracesByField = new Map(traces.map((trace) => [trace.resultField, trace]));
  return REQUIRED_TRACE_FIELDS.filter((field) => {
    const trace = tracesByField.get(field);
    return trace ? !isTraceDetailed(trace) : false;
  });
}

export function assertTraceSetComplete(traces: TraceForCompleteness[]) {
  if (missingTraceFields(traces).length > 0 || incompleteTraceFields(traces).length > 0) {
    throw new Error("CALCULATION_TRACE_INCOMPLETE");
  }
}

export function isTraceDetailed(trace: TraceForCompleteness) {
  if (
    typeof trace.rounding.before !== "number" ||
    typeof trace.rounding.after !== "number" ||
    typeof trace.rounding.mode !== "string"
  ) {
    return false;
  }
  const requiredParameters = REQUIRED_PARAMETER_FIELDS.get(trace.resultField);
  if (!requiredParameters) return true;
  return requiredParameters.every((key) => Object.prototype.hasOwnProperty.call(trace.parameters, key));
}
