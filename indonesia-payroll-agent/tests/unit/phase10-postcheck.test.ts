import { describe, expect, it } from "vitest";
import { evaluatePostCalculation } from "@/domain/payroll-engine/postcheck";
import { calculatePayroll } from "@/domain/payroll-engine/engine";
import { basePayrollInput } from "./phase10-test-fixtures";

describe("phase 10 post calculation checks", () => {
  it("passes amount and trace checks while marking unavailable external checks as not covered", () => {
    const input = basePayrollInput();
    const output = calculatePayroll(input);

    const result = evaluatePostCalculation(input, output);

    expect(result.status).toBe("PASSED");
    expect(result.checks.map((check) => check.code)).toEqual(
      expect.arrayContaining(["headcount", "employee_amount_trace", "customer_comparison"]),
    );
    expect(result.checks.filter((check) => check.status === "NOT_COVERED").map((check) => check.code)).toEqual(
      expect.arrayContaining(["historical_comparison", "bpjs_bill_cross_check", "export_template_structure"]),
    );
  });

  it("blocks when required trace fields are missing", () => {
    const input = basePayrollInput();
    const output = calculatePayroll(input);
    output.results[0].traces = output.results[0].traces.filter(
      (trace) => trace.resultField !== "bpjsEmploymentEmployer",
    );

    const result = evaluatePostCalculation(input, output);

    expect(result.status).toBe("BLOCKED");
    expect(result.issues.map((issue) => issue.issueType)).toContain(
      "POSTCHECK_EMPLOYEE_RESULT_INVALID",
    );
  });

  it("blocks when required trace fields omit parameters or rounding detail", () => {
    const input = basePayrollInput();
    const output = calculatePayroll(input);
    const bpjsTrace = output.results[0].traces.find(
      (trace) => trace.resultField === "bpjsEmploymentEmployer",
    );
    if (!bpjsTrace) throw new Error("missing bpjs trace fixture");
    bpjsTrace.parameters = {};
    bpjsTrace.rounding = { mode: "HALF_UP" };

    const result = evaluatePostCalculation(input, output);

    expect(result.status).toBe("BLOCKED");
    expect(result.issues.map((issue) => issue.issueType)).toContain(
      "POSTCHECK_EMPLOYEE_RESULT_INVALID",
    );
  });

  it("keeps customer comparison values out of hard postcheck blockers", () => {
    const input = basePayrollInput();
    const output = calculatePayroll(input);
    output.results[0].comparisonValues.push({
      employeeId: "employee-a",
      sourceInputId: "input-customer-net",
      targetField: "netPay",
      customerValue: output.results[0].netPay + 10_000,
      systemValue: output.results[0].netPay,
      delta: 10_000,
      status: "DIFF",
      currencyCode: "IDR",
      sourceLabel: "Customer payroll sheet",
    });

    const result = evaluatePostCalculation(input, output);

    expect(result.status).toBe("PASSED");
    expect(result.issues.map((issue) => issue.issueType)).not.toContain(
      "POSTCHECK_CUSTOMER_COMPARISON_DIFF",
    );
    expect(result.checks.find((check) => check.code === "customer_comparison")).toMatchObject({
      status: "PASSED",
      evidence: { diffCount: 1 },
    });
  });

  it("blocks zero payroll results that have no payable or taxable line evidence", () => {
    const input = basePayrollInput();
    const output = calculatePayroll(input);
    output.results[0].grossPay = 0;
    output.results[0].taxableIncome = 0;
    output.results[0].netPay = 0;
    output.results[0].employerCost = 0;
    output.results[0].lines = [];

    const result = evaluatePostCalculation(input, output);

    expect(result.status).toBe("BLOCKED");
    expect(result.issues.map((issue) => issue.issueType)).toContain(
      "POSTCHECK_EMPLOYEE_RESULT_INVALID",
    );
  });
});
