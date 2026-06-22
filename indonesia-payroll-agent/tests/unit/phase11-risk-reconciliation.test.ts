import { describe, expect, it } from "vitest";
import { calculatePayroll } from "@/domain/payroll-engine/engine";
import { buildPayrollConfirmationPackage } from "@/domain/confirmation-package/package-service";
import { evaluatePayrollReconciliation } from "@/domain/reconciliation/reconciliation-service";
import { buildHighRiskIssues, evaluateRiskApprovalGate } from "@/domain/risks/risk-service";
import { basePayrollInput } from "./phase10-test-fixtures";

describe("phase 11 high risk and reconciliation", () => {
  it("marks partial BPJS bill coverage as not covered without blocking the run", () => {
    const input = basePayrollInput({
      postcheckContext: { bpjsBillEmployeeItems: [], exportPreviewEmployeeCount: 1 },
    });
    const output = calculatePayroll(input);

    const evaluation = evaluatePayrollReconciliation(input, output);

    expect(evaluation.status).toBe("PASSED");
    expect(evaluation.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkType: "BPJS_BILL_EMPLOYEE",
          status: "NOT_COVERED",
          targetEmployeeId: "employee-a",
        }),
      ]),
    );
  });

  it("creates high risk signals for customer comparison deltas above IDR 10,000", () => {
    const input = basePayrollInput({
      postcheckContext: { exportPreviewEmployeeCount: 1 },
    });
    const output = calculatePayroll(input);
    output.results[0].comparisonValues.push({
      employeeId: "employee-a",
      sourceInputId: "input-customer-net",
      targetField: "netPay",
      customerValue: output.results[0].netPay + 20_000,
      systemValue: output.results[0].netPay,
      delta: 20_000,
      status: "DIFF",
      currencyCode: "IDR",
      sourceLabel: "Customer payroll sheet",
    });

    const evaluation = evaluatePayrollReconciliation(input, output);
    const highRiskIssues = buildHighRiskIssues(evaluation.highRiskSignals);

    expect(evaluation.status).toBe("PASSED");
    expect(highRiskIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          issueType: "CUSTOMER_COMPARISON_DIFF",
          riskLevel: "R3",
          targetEmployeeId: "employee-a",
        }),
      ]),
    );
  });

  it("blocks lock when export template preview coverage is missing", () => {
    const input = basePayrollInput();
    const output = calculatePayroll(input);

    const evaluation = evaluatePayrollReconciliation(input, output);

    expect(evaluation.status).toBe("BLOCKED");
    expect(evaluation.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkType: "EXPORT_TEMPLATE_STRUCTURE",
          status: "BLOCKED",
          riskLevel: "R4",
        }),
      ]),
    );
  });

  it("rejects system administrator business release even with broad access", () => {
    const gate = evaluateRiskApprovalGate(
      {
        id: "user-a",
        email: "admin@example.com",
        roleCodes: ["SYSTEM_ADMIN"],
        authorizedClientIds: [],
      },
      "client-a",
    );

    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe("SYSTEM_ADMIN_CANNOT_RELEASE");
  });

  it("rejects high risk release when the same actor maintained key payroll data", () => {
    const gate = evaluateRiskApprovalGate(
      {
        id: "user-a",
        email: "payroll-lead@example.com",
        roleCodes: ["PAYROLL_LEAD"],
        authorizedClientIds: ["client-a"],
      },
      "client-a",
      { actorMaintainedKeyDataCount: 1 },
    );

    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe("SEGREGATION_OF_DUTY_RELEASE_DENIED");
  });

  it("fails confirmation package gate when high risk or audit trail is missing", () => {
    const packageDraft = buildPayrollConfirmationPackage({
      run: {
        id: "run-a",
        clientId: "client-a",
        clientCode: "ACME",
        clientName: "Acme Indonesia",
        payrollMonth: "2026-06",
        blockingIssueCount: 0,
        highRiskIssueCount: 1,
        pendingCustomerConfirmationCount: 0,
        status: "PENDING_PAYROLL_CONFIRMATION",
      },
      resultVersionRef: "result-v1",
      results: [
        {
          employeeId: "employee-a",
          grossPay: 12_000_000,
          netPay: 10_000_000,
          pph21: 600_000,
          bpjsHealthEmployee: 120_000,
          bpjsEmploymentEmployee: 360_000,
          bpjsHealthEmployer: 480_000,
          bpjsEmploymentEmployer: 748_800,
          employerCost: 13_228_800,
          traceCount: 5,
          lineCount: 4,
          comparisonDiffCount: 0,
          employeeStatus: "TERMINATED",
          isGrossUpEmployee: true,
          hasForeignCurrencyInput: true,
        },
      ],
      highRiskIssues: [
        {
          issueType: "GROSS_UP",
          status: "OPEN",
          riskLevel: "R3",
          title: "Gross Up",
          detail: "Needs release",
          evidenceRefs: [],
        },
      ],
      reconciliationChecks: [],
      customerConfirmationSummary: {
        latestPackId: "pack-a",
        latestPackStatus: "CONFIRMED",
        openCriticalItemCount: 0,
        validConfirmationCount: 1,
      },
      traceability: {
        changeLedgerEntries: [],
        fieldMappings: [],
        standardizedInputs: [],
        rawInputItems: [],
        uploadedFiles: [],
        ruleVersionSnapshot: [],
        correctionDeltas: [],
      },
      auditEntryRefs: [],
    });

    expect(packageDraft.status).toBe("DRAFT");
    expect(packageDraft.summary).toMatchObject({
      totals: {
        bpjsKsTotal: 600_000,
        bpjsTkTotal: 1_108_800,
        grossUpCount: 1,
        foreignCurrencyCount: 1,
        terminatedEmployeeCount: 1,
      },
    });
    expect(packageDraft.gateSnapshot).toMatchObject({
      canConfirmLock: false,
      failures: expect.arrayContaining(["高风险项未放行", "缺少审计记录入口", "规则版本快照缺失"]),
    });
  });
});
