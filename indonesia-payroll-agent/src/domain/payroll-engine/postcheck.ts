import { type PayrollEngineInput, type PayrollEngineOutput } from "@/domain/payroll-engine/engine-types";
import {
  incompleteTraceFields,
  missingTraceFields,
} from "@/domain/payroll-engine/trace-completeness";

export type PostCalculationCheckStatus = "PASSED" | "BLOCKED" | "NOT_COVERED";

export type PostCalculationCheck = {
  code: string;
  status: PostCalculationCheckStatus;
  message: string;
  evidence: Record<string, string | number | boolean | null>;
};

export type PostCalculationIssue = {
  issueType: string;
  riskLevel: "R1" | "R2" | "R3" | "R4";
  targetEmployeeId?: string;
  targetField?: string;
  title: string;
  detail: string;
};

export type PostCalculationEvaluation = {
  status: "PASSED" | "BLOCKED";
  checks: PostCalculationCheck[];
  issues: PostCalculationIssue[];
};

export function evaluatePostCalculation(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
): PostCalculationEvaluation {
  const checks: PostCalculationCheck[] = [];
  const issues: PostCalculationIssue[] = [];
  checkHeadcount(input, output, checks, issues);
  checkEmployeeResults(output, checks, issues);
  checkCustomerComparison(output, checks);
  checkHistoricalComparison(input, output, checks);
  checkBpjsBill(input, output, checks);
  checkExportPreview(input, output, checks, issues);

  return { status: issues.length === 0 ? "PASSED" : "BLOCKED", checks, issues };
}

function checkHeadcount(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: PostCalculationCheck[],
  issues: PostCalculationIssue[],
) {
  const expected = new Set(input.standardizedInputs.map((item) => item.employeeId)).size;
  const actual = output.results.length;
  checks.push(check("headcount", expected === actual, "算薪人数必须等于已确认标准化输入覆盖人数。", {
    expectedEmployeeCount: expected,
    actualEmployeeCount: actual,
  }));
  if (expected !== actual) {
    issues.push(issue("POSTCHECK_HEADCOUNT_MISMATCH", "R4", "算薪人数不一致", "算薪人数与已确认标准化输入覆盖人数不一致。"));
  }
}

function checkEmployeeResults(
  output: PayrollEngineOutput,
  checks: PostCalculationCheck[],
  issues: PostCalculationIssue[],
) {
  for (const result of output.results) {
    const employeeChecks = [
      finiteNonNegative(result.grossPay),
      finiteNonNegative(result.taxableIncome),
      finiteNonNegative(result.pph21),
      finiteNonNegative(result.bpjsHealthEmployee),
      finiteNonNegative(result.bpjsEmploymentEmployee),
      finiteNonNegative(result.bpjsHealthEmployer),
      finiteNonNegative(result.bpjsEmploymentEmployer),
      finiteNonNegative(result.employerCost),
    ];
    const expectedNet = result.grossPay - result.totalDeductions;
    const hasBalance = Math.abs(expectedNet - result.netPay) <= 1;
    const hasCalculableLine = result.lines.some(isCalculablePayrollLine);
    const missingFields = missingTraceFields(result.traces);
    const incompleteFields = incompleteTraceFields(result.traces);
    const ok = employeeChecks.every(Boolean) && hasBalance && hasCalculableLine && missingFields.length === 0 && incompleteFields.length === 0;
    checks.push(check("employee_amount_trace", ok, "员工金额、BPJS/PPh21 和 trace 完整性核查。", {
      employeeId: result.employeeId,
      hasBalance,
      hasCalculableLine,
      missingTraceFieldCount: missingFields.length,
      incompleteTraceFieldCount: incompleteFields.length,
    }));
    if (!ok) {
      issues.push(issue("POSTCHECK_EMPLOYEE_RESULT_INVALID", "R4", "员工算薪结果核查失败", "金额平衡、非负金额或 trace 完整性未通过。", {
        targetEmployeeId: result.employeeId,
        targetField: missingFields[0] ?? incompleteFields[0],
      }));
    }
  }
}

function isCalculablePayrollLine(line: PayrollEngineOutput["results"][number]["lines"][number]) {
  return ["EARNING", "TAX_ALLOWANCE", "THR"].includes(line.lineType) &&
    (line.paidOut || line.taxableCash || line.bpjsHealthBase || line.bpjsEmploymentBase);
}

function checkCustomerComparison(
  output: PayrollEngineOutput,
  checks: PostCalculationCheck[],
) {
  const comparisons = output.results.flatMap((result) => result.comparisonValues);
  const diffs = comparisons.filter((item) => item.status === "DIFF");
  checks.push(check("customer_comparison", true, "客户计算值差异交给 Phase 11 核查/高风险分层，不能覆盖系统结果。", {
    comparisonValueCount: comparisons.length,
    diffCount: diffs.length,
  }));
}

function checkHistoricalComparison(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: PostCalculationCheck[],
) {
  const previous = input.postcheckContext?.previousTotals;
  if (!previous) {
    checks.push(notCovered("historical_comparison", "没有上期已确认算薪结果，本次未做环比核查。"));
    return;
  }
  const current = totals(output);
  const maxChangeRate = Math.max(
    changeRate(current.netPay, previous.netPay),
    changeRate(current.pph21, previous.pph21),
    changeRate(current.bpjsEmployee, previous.bpjsEmployee),
  );
  const ok = maxChangeRate <= 0.1 && current.employeeCount === previous.employeeCount;
  checks.push(check("historical_comparison", ok, "人数、实发、PPh21、BPJS 对上期环比核查；异常交给 Phase 11 高风险放行。", {
    previousEmployeeCount: previous.employeeCount,
    currentEmployeeCount: current.employeeCount,
    maxChangeRate,
  }));
}

function checkBpjsBill(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: PostCalculationCheck[],
) {
  const bill = input.postcheckContext?.bpjsBillTotals;
  if (!bill) {
    checks.push(notCovered("bpjs_bill_cross_check", "没有传入社保账单合计，本次未做社保账单侧面核验。"));
    return;
  }
  const current = totals(output);
  const delta =
    Math.abs((bill.healthEmployee ?? current.bpjsHealthEmployee) - current.bpjsHealthEmployee) +
    Math.abs((bill.employmentEmployee ?? current.bpjsEmploymentEmployee) - current.bpjsEmploymentEmployee) +
    Math.abs((bill.healthEmployer ?? current.bpjsHealthEmployer) - current.bpjsHealthEmployer) +
    Math.abs((bill.employmentEmployer ?? current.bpjsEmploymentEmployer) - current.bpjsEmploymentEmployer);
  const ok = delta <= 1;
  checks.push(check("bpjs_bill_cross_check", ok, "社保账单差异交给 Phase 11 核查/高风险分层。", { delta }));
}

function checkExportPreview(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: PostCalculationCheck[],
  issues: PostCalculationIssue[],
) {
  const expected = input.postcheckContext?.exportPreviewEmployeeCount;
  if (expected === undefined) {
    checks.push(notCovered("export_template_structure", "没有传入导出预览人数，本次未做模板结构核查。"));
    return;
  }
  const actual = output.results.length;
  const ok = expected === actual;
  checks.push(check("export_template_structure", ok, "导出预览人数与算薪人数一致性核查。", { expected, actual }));
  if (!ok) {
    issues.push(issue("POSTCHECK_EXPORT_PREVIEW_HEADCOUNT_DIFF", "R4", "导出预览人数不一致", "导出预览人数与算薪结果人数不一致，不得进入确认。"));
  }
}

function check(
  code: string,
  ok: boolean,
  message: string,
  evidence: PostCalculationCheck["evidence"],
): PostCalculationCheck {
  return { code, status: ok ? "PASSED" : "BLOCKED", message, evidence };
}

function notCovered(code: string, message: string): PostCalculationCheck {
  return { code, status: "NOT_COVERED", message, evidence: {} };
}

function issue(
  issueType: string,
  riskLevel: PostCalculationIssue["riskLevel"],
  title: string,
  detail: string,
  extra: Partial<PostCalculationIssue> = {},
): PostCalculationIssue {
  return { issueType, riskLevel, title, detail, ...extra };
}

function finiteNonNegative(value: number) {
  return Number.isFinite(value) && value >= 0;
}

function totals(output: PayrollEngineOutput) {
  return {
    employeeCount: output.results.length,
    netPay: sum(output.results.map((result) => result.netPay)),
    pph21: sum(output.results.map((result) => result.pph21)),
    bpjsHealthEmployee: sum(output.results.map((result) => result.bpjsHealthEmployee)),
    bpjsEmploymentEmployee: sum(output.results.map((result) => result.bpjsEmploymentEmployee)),
    bpjsHealthEmployer: sum(output.results.map((result) => result.bpjsHealthEmployer)),
    bpjsEmploymentEmployer: sum(output.results.map((result) => result.bpjsEmploymentEmployer)),
    bpjsEmployee: sum(output.results.map((result) => result.bpjsHealthEmployee + result.bpjsEmploymentEmployee)),
  };
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function changeRate(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : 1;
  return Math.abs(current - previous) / Math.abs(previous);
}
