import { type PayrollEngineInput, type PayrollEngineOutput } from "@/domain/payroll-engine/engine-types";
import { type HighRiskSignal } from "@/domain/risks/risk-service";
export type ReconciliationStatus = "PASSED" | "WARNING" | "BLOCKED" | "NOT_COVERED";
export type ReconciliationRiskLevel = "R1" | "R2" | "R3" | "R4";
export type ReconciliationCheckDraft = {
  checkType: string;
  status: ReconciliationStatus;
  riskLevel: ReconciliationRiskLevel;
  targetEmployeeId?: string;
  targetField?: string;
  expectedValue?: number;
  actualValue?: number;
  deltaValue?: number;
  message: string;
  detail: string;
  evidenceRefs: string[];
  sourceRefs: Record<string, unknown>[];
};
export type ReconciliationEvaluation = {
  status: "PASSED" | "BLOCKED";
  checks: ReconciliationCheckDraft[];
  highRiskSignals: HighRiskSignal[];
};
const CUSTOMER_DIFF_WARN_IDR = 1_000;
const CUSTOMER_DIFF_HIGH_RISK_IDR = 10_000;
const EMPLOYEE_NET_CHANGE_RATE = 0.2;
const EMPLOYEE_NET_CHANGE_IDR = 1_000_000;
const EMPLOYEE_PPH21_CHANGE_RATE = 0.3;
const TOTAL_CHANGE_RATE = 0.1;
export function evaluatePayrollReconciliation(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
): ReconciliationEvaluation {
  const checks: ReconciliationCheckDraft[] = [];
  const highRiskSignals: HighRiskSignal[] = [];
  checkHeadcount(input, output, checks);
  checkCustomerComparison(output, checks, highRiskSignals);
  checkHistoricalTotals(input, output, checks, highRiskSignals);
  checkHistoricalEmployees(input, output, checks, highRiskSignals);
  checkBpjsBillEmployees(input, output, checks, highRiskSignals);
  checkExportTemplate(input, output, checks);

  return {
    status: checks.some((check) => check.status === "BLOCKED") ? "BLOCKED" : "PASSED",
    checks,
    highRiskSignals,
  };
}
function checkHeadcount(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: ReconciliationCheckDraft[],
) {
  const expected = new Set(input.standardizedInputs.map((item) => item.employeeId)).size;
  const actual = output.results.length;
  checks.push(makeCheck({
    checkType: "HEADCOUNT",
    status: expected === actual ? "PASSED" : "BLOCKED",
    riskLevel: expected === actual ? "R1" : "R4",
    expectedValue: expected,
    actualValue: actual,
    deltaValue: actual - expected,
    message: "算薪人数核查",
    detail: "算薪人数必须等于已确认标准化输入覆盖人数。",
  }));
}
function checkCustomerComparison(
  output: PayrollEngineOutput,
  checks: ReconciliationCheckDraft[],
  highRiskSignals: HighRiskSignal[],
) {
  for (const result of output.results) {
    for (const comparison of result.comparisonValues) {
      const delta = Math.abs(comparison.delta ?? ((comparison.systemValue ?? 0) - comparison.customerValue));
      if (comparison.status !== "DIFF" || delta <= CUSTOMER_DIFF_WARN_IDR) continue;
      const highRisk = delta > CUSTOMER_DIFF_HIGH_RISK_IDR;
      checks.push(makeCheck({
        checkType: "CUSTOMER_COMPARISON",
        status: highRisk ? "WARNING" : "PASSED",
        riskLevel: highRisk ? "R3" : "R2",
        targetEmployeeId: comparison.employeeId,
        targetField: comparison.targetField,
        expectedValue: comparison.customerValue,
        actualValue: comparison.systemValue,
        deltaValue: delta,
        message: highRisk ? "客户计算值差异进入高风险" : "客户计算值差异提示",
        detail: "客户计算值不得覆盖系统确定性结果；差异需要进入确认包展示。",
        sourceRefs: [{ sourceInputId: comparison.sourceInputId ?? null, sourceLabel: comparison.sourceLabel }],
      }));
      if (highRisk) {
        highRiskSignals.push({
          type: "CUSTOMER_COMPARISON_DIFF",
          employeeId: comparison.employeeId,
          targetField: comparison.targetField,
          actualValue: comparison.systemValue,
          thresholdValue: CUSTOMER_DIFF_HIGH_RISK_IDR,
          deltaValue: delta,
          sourceRefs: [{ sourceInputId: comparison.sourceInputId ?? null }],
        });
      }
    }
  }
}
function checkHistoricalTotals(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: ReconciliationCheckDraft[],
  highRiskSignals: HighRiskSignal[],
) {
  const previous = input.postcheckContext?.previousTotals;
  if (!previous) {
    checks.push(notCovered("HISTORICAL_TOTALS", "没有上期 totals，本次总额环比未覆盖。"));
    return;
  }
  const current = totals(output);
  const fields = [
    ["netPay", current.netPay, previous.netPay],
    ["pph21", current.pph21, previous.pph21],
    ["bpjsEmployee", current.bpjsEmployee, previous.bpjsEmployee],
  ] as const;
  for (const [field, actual, expected] of fields) {
    const rate = changeRate(actual, expected);
    const highRisk = rate > TOTAL_CHANGE_RATE;
    checks.push(makeCheck({
      checkType: "HISTORICAL_TOTALS",
      status: highRisk ? "WARNING" : "PASSED",
      riskLevel: highRisk ? "R3" : "R1",
      targetField: field,
      expectedValue: expected,
      actualValue: actual,
      deltaValue: actual - expected,
      message: `${field} 总额环比核查`,
      detail: `默认阈值为 10%，当前环比 ${(rate * 100).toFixed(2)}%。`,
    }));
    if (highRisk) {
      highRiskSignals.push({
        type: "HISTORICAL_VARIANCE",
        targetField: field,
        actualValue: actual,
        thresholdValue: TOTAL_CHANGE_RATE,
        deltaValue: rate,
      });
    }
  }
}
function checkHistoricalEmployees(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: ReconciliationCheckDraft[],
  highRiskSignals: HighRiskSignal[],
) {
  const previousItems = input.postcheckContext?.previousEmployeeResults;
  if (!previousItems) {
    checks.push(notCovered("HISTORICAL_EMPLOYEE", "没有上期员工级结果，本次员工环比未覆盖。"));
    return;
  }
  const previousByEmployee = new Map(previousItems.map((item) => [item.employeeId, item]));
  for (const result of output.results) {
    const previous = previousByEmployee.get(result.employeeId);
    if (!previous) continue;
    const netChange = Math.abs(result.netPay - previous.netPay);
    const netRate = changeRate(result.netPay, previous.netPay);
    const taxRate = changeRate(result.pph21, previous.pph21);
    const highRisk = netRate > EMPLOYEE_NET_CHANGE_RATE || netChange > EMPLOYEE_NET_CHANGE_IDR || taxRate > EMPLOYEE_PPH21_CHANGE_RATE;
    checks.push(makeCheck({
      checkType: "HISTORICAL_EMPLOYEE",
      status: highRisk ? "WARNING" : "PASSED",
      riskLevel: highRisk ? "R3" : "R1",
      targetEmployeeId: result.employeeId,
      targetField: highRisk ? "netPay/pph21" : "netPay",
      expectedValue: previous.netPay,
      actualValue: result.netPay,
      deltaValue: netChange,
      message: "员工级环比核查",
      detail: "默认阈值：实发变化 >20% 或 > IDR 1,000,000；个税变化 >30%。",
    }));
    if (highRisk) {
      highRiskSignals.push({
        type: "HISTORICAL_VARIANCE",
        employeeId: result.employeeId,
        targetField: "netPay/pph21",
        actualValue: result.netPay,
        thresholdValue: EMPLOYEE_NET_CHANGE_IDR,
        deltaValue: Math.max(netChange, netRate, taxRate),
      });
    }
  }
}
function checkBpjsBillEmployees(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: ReconciliationCheckDraft[],
  highRiskSignals: HighRiskSignal[],
) {
  const billItems = input.postcheckContext?.bpjsBillEmployeeItems;
  if (!billItems) {
    checks.push(notCovered("BPJS_BILL_EMPLOYEE", "没有员工级社保账单，本次员工级 BPJS 侧面核验未覆盖。"));
    return;
  }
  const bills = new Map(billItems.map((item) => [item.employeeId, item]));
  for (const result of output.results) {
    const bill = bills.get(result.employeeId);
    if (!bill) {
      checks.push(makeCheck({
        checkType: "BPJS_BILL_EMPLOYEE",
        status: "NOT_COVERED",
        riskLevel: "R1",
        targetEmployeeId: result.employeeId,
        message: "社保账单未覆盖员工",
        detail: "社保账单只覆盖部分员工时，未覆盖员工只标记未覆盖，不直接阻断。",
      }));
      continue;
    }
    const delta =
      Math.abs((bill.healthEmployee ?? result.bpjsHealthEmployee) - result.bpjsHealthEmployee) +
      Math.abs((bill.employmentEmployee ?? result.bpjsEmploymentEmployee) - result.bpjsEmploymentEmployee) +
      Math.abs((bill.healthEmployer ?? result.bpjsHealthEmployer) - result.bpjsHealthEmployer) +
      Math.abs((bill.employmentEmployer ?? result.bpjsEmploymentEmployer) - result.bpjsEmploymentEmployer);
    const highRisk = delta > CUSTOMER_DIFF_HIGH_RISK_IDR;
    checks.push(makeCheck({
      checkType: "BPJS_BILL_EMPLOYEE",
      status: highRisk ? "WARNING" : "PASSED",
      riskLevel: highRisk ? "R3" : "R1",
      targetEmployeeId: result.employeeId,
      targetField: "bpjs",
      actualValue: result.bpjsHealthEmployee + result.bpjsEmploymentEmployee + result.bpjsHealthEmployer + result.bpjsEmploymentEmployer,
      deltaValue: delta,
      message: "员工级社保账单侧面核验",
      detail: "匹配到社保账单的员工必须逐人核验 BPJS 员工/雇主承担差异。",
      evidenceRefs: bill.evidenceRefs ?? [],
    }));
    if (highRisk) {
      highRiskSignals.push({
        type: "BPJS_BILL_DIFF",
        employeeId: result.employeeId,
        targetField: "bpjs",
        thresholdValue: CUSTOMER_DIFF_HIGH_RISK_IDR,
        deltaValue: delta,
        evidenceRefs: bill.evidenceRefs,
      });
    }
  }
}
function checkExportTemplate(
  input: PayrollEngineInput,
  output: PayrollEngineOutput,
  checks: ReconciliationCheckDraft[],
) {
  const expected = input.postcheckContext?.exportPreviewEmployeeCount;
  if (expected === undefined) {
    checks.push(makeCheck({
      checkType: "EXPORT_TEMPLATE_STRUCTURE",
      status: "BLOCKED",
      riskLevel: "R4",
      message: "导出模板结构核查缺失",
      detail: "没有导出预览人数，无法证明输出模板人数与算薪结果一致，锁定前必须 fail closed。",
    }));
    return;
  }
  checks.push(makeCheck({
    checkType: "EXPORT_TEMPLATE_STRUCTURE",
    status: expected === output.results.length ? "PASSED" : "BLOCKED",
    riskLevel: expected === output.results.length ? "R1" : "R4",
    expectedValue: expected,
    actualValue: output.results.length,
    deltaValue: output.results.length - expected,
    message: "导出人数与算薪人数一致性核查",
    detail: "导出人数与算薪人数不一致时不得正式导出。",
  }));
}
function makeCheck(input: Partial<ReconciliationCheckDraft> & Pick<ReconciliationCheckDraft, "checkType" | "status" | "riskLevel" | "message" | "detail">): ReconciliationCheckDraft {
  return {
    evidenceRefs: [],
    sourceRefs: [],
    ...input,
  };
}
function notCovered(checkType: string, detail: string): ReconciliationCheckDraft {
  return makeCheck({
    checkType,
    status: "NOT_COVERED",
    riskLevel: "R1",
    message: "核查未覆盖",
    detail,
  });
}
function totals(output: PayrollEngineOutput) {
  return {
    netPay: sum(output.results.map((result) => result.netPay)),
    pph21: sum(output.results.map((result) => result.pph21)),
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
