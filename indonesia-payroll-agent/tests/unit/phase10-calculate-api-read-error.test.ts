import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/payroll-runs/[runId]/calculate/route";

const actorFromHeadersMock = vi.hoisted(() => vi.fn());
const requestAuditFieldsMock = vi.hoisted(() => vi.fn());
const assertCalculationGateMock = vi.hoisted(() => vi.fn());
const loadCalculationInputMock = vi.hoisted(() => vi.fn());
const calculatePayrollMock = vi.hoisted(() => vi.fn());
const payrollRunFindUniqueMock = vi.hoisted(() => vi.fn());
const payrollResultFindManyMock = vi.hoisted(() => vi.fn());
const customerComparisonValueFindManyMock = vi.hoisted(() => vi.fn());
const transactionMock = vi.hoisted(() => vi.fn());

const txMock = vi.hoisted(() => ({
  blockingIssue: { create: vi.fn(), count: vi.fn() },
  payrollRun: { update: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock("@/domain/auth/request-context", () => ({
  actorFromHeadersWithDatabase: actorFromHeadersMock,
}));

vi.mock("@/lib/audit/request-audit-fields", () => ({
  requestAuditFields: requestAuditFieldsMock,
}));

vi.mock("@/app/api/payroll-runs/[runId]/calculate/calculation-data", () => ({
  assertCalculationGate: assertCalculationGateMock,
  loadCalculationInput: loadCalculationInputMock,
}));

vi.mock("@/domain/payroll-engine/engine", () => ({
  calculatePayroll: calculatePayrollMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    payrollRun: { findUnique: payrollRunFindUniqueMock },
    payrollResult: { findMany: payrollResultFindManyMock },
    customerComparisonValue: { findMany: customerComparisonValueFindManyMock },
    $transaction: transactionMock,
  },
}));

beforeEach(() => {
  actorFromHeadersMock.mockReset();
  requestAuditFieldsMock.mockReset();
  assertCalculationGateMock.mockReset();
  loadCalculationInputMock.mockReset();
  calculatePayrollMock.mockReset();
  payrollRunFindUniqueMock.mockReset();
  payrollResultFindManyMock.mockReset();
  customerComparisonValueFindManyMock.mockReset();
  transactionMock.mockReset();
  txMock.blockingIssue.create.mockReset();
  txMock.blockingIssue.count.mockReset();
  txMock.payrollRun.update.mockReset();
  txMock.auditLog.create.mockReset();

  actorFromHeadersMock.mockResolvedValue(payrollActor());
  requestAuditFieldsMock.mockResolvedValue({
    actorUserId: "payroll-user",
    actorEmail: "payroll@example.local",
    actorRoleCodes: ["PAYROLL_SPECIALIST"],
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  });
  assertCalculationGateMock.mockResolvedValue(calculationGate());
  loadCalculationInputMock.mockResolvedValue({ runId: "run-a" });
  payrollRunFindUniqueMock.mockResolvedValue({
    id: "run-a",
    clientId: "client-a",
    payrollMonth: "2026-06",
  });
  txMock.blockingIssue.count.mockResolvedValue(1);
  transactionMock.mockImplementation(
    async (callback: (tx: typeof txMock) => Promise<unknown>) => callback(txMock),
  );
});

describe("phase 10 calculate API read and fail-closed errors", () => {
  it("requires viewSensitive before returning calculation traces", async () => {
    actorFromHeadersMock.mockResolvedValue({
      id: "rule-admin",
      email: "rule@example.local",
      roleCodes: ["RULE_ADMIN"],
      authorizedClientIds: ["client-a"],
    });

    const response = await GET(getRequest(), routeContext());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ errorCode: "ROLE_MISSING_PERMISSION" });
    expect(payrollResultFindManyMock).not.toHaveBeenCalled();
  });

  it("returns finalized payroll results with lines, traces, and customer comparison values", async () => {
    payrollResultFindManyMock.mockResolvedValue([
      {
        id: "result-a",
        employeeId: "employee-a",
        employee: { id: "employee-a", employeeCode: "E001", fullName: "Ayu" },
        resultVersionRef: "run:run-a:calc:2026-06-22T00:00:00.000Z",
        calculatedAt: new Date("2026-06-22T00:00:00.000Z"),
        status: "FINAL",
        grossPay: 10_000_000,
        taxableIncome: 9_500_000,
        pph21: 450_000,
        bpjsHealthEmployee: 120_000,
        bpjsEmploymentEmployee: 240_000,
        bpjsHealthEmployer: 400_000,
        bpjsEmploymentEmployer: 510_000,
        totalDeductions: 810_000,
        netPay: 9_190_000,
        employerCost: 10_910_000,
        currencyCode: "IDR",
        sourceVersionSnapshot: { inputVersion: 3 },
        lines: [
          {
            id: "line-a",
            lineType: "BASE_GROSS",
            componentCode: "BASIC",
            label: "Basic salary",
            amount: 10_000_000,
            currencyCode: "IDR",
            taxableCash: true,
            bpjsHealthBase: true,
            bpjsEmploymentBase: true,
            paidOut: true,
            affectsNetPay: true,
            affectsEmployerCost: true,
            sourceInputIds: ["input-a"],
            ruleVersionRefs: ["rule:bpjs:1"],
          },
        ],
        traces: [
          {
            id: "trace-a",
            resultField: "pph21",
            traceType: "TAX",
            inputRefs: [{ inputId: "input-a" }],
            ruleVersionRefs: ["rule:pph21:1"],
            formula: "TER monthly",
            parameters: { terRate: 0.045 },
            intermediateValues: { taxableIncome: 9_500_000 },
            rounding: { mode: "ROUND_HALF_UP", before: 450_000.4, after: 450_000 },
            outputValue: 450_000,
          },
        ],
      },
    ]);
    customerComparisonValueFindManyMock.mockResolvedValue([
      {
        id: "comparison-a",
        employeeId: "employee-a",
        sourceInputId: "input-customer-pph21",
        targetField: "pph21",
        customerValue: 450_000,
        systemValue: 450_000,
        delta: 0,
        status: "MATCHED",
        currencyCode: "IDR",
        sourceLabel: "Customer PPh21",
        sourceCellId: "Sheet1!G2",
      },
    ]);

    const response = await GET(getRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(payrollResultFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { runId: "run-a", status: "FINAL" },
      }),
    );
    expect(body).toMatchObject({
      resultCount: 1,
      traceCount: 1,
      resultVersionRefs: ["run:run-a:calc:2026-06-22T00:00:00.000Z"],
      results: [
        {
          employee: { employeeCode: "E001", fullName: "Ayu" },
          totals: {
            grossPay: 10_000_000,
            pph21: 450_000,
            netPay: 9_190_000,
          },
          lines: [{ componentCode: "BASIC", amount: 10_000_000, paidOut: true }],
          traces: [
            {
              resultField: "pph21",
              parameters: { terRate: 0.045 },
              rounding: { mode: "ROUND_HALF_UP", before: 450_000.4, after: 450_000 },
            },
          ],
          comparisonValues: [
            {
              targetField: "pph21",
              customerValue: 450_000,
              systemValue: 450_000,
              delta: 0,
              status: "MATCHED",
            },
          ],
        },
      ],
    });
  });

  it("persists a calculation blocking issue and audit when input loading fails", async () => {
    loadCalculationInputMock.mockRejectedValue(new Error("CLIENT_CONFIG_MISSING"));

    const response = await POST(postRequest(), routeContext());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errorCode: "CLIENT_CONFIG_MISSING" });
    expect(calculatePayrollMock).not.toHaveBeenCalled();
    expect(txMock.blockingIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        runId: "run-a",
        source: "CALCULATION",
        issueType: "CLIENT_CONFIG_MISSING",
        status: "OPEN",
        riskLevel: "R4",
      }),
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "BLOCKING_ISSUE_CREATED",
        objectType: "PAYROLL_RUN",
        runId: "run-a",
        metadata: { source: "CALCULATION", errorCode: "CLIENT_CONFIG_MISSING" },
      }),
    });
  });

  it("sanitizes internal engine errors while persisting a fail-closed blocker", async () => {
    calculatePayrollMock.mockImplementation(() => {
      throw new Error("database password leaked in stack");
    });

    const response = await POST(postRequest(), routeContext());
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ errorCode: "PAYROLL_CALCULATION_FAILED" });
    expect(JSON.stringify(body)).not.toContain("database password");
    expect(txMock.blockingIssue.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issueType: "PAYROLL_CALCULATION_FAILED",
        detail: expect.stringContaining("PAYROLL_CALCULATION_FAILED"),
      }),
    });
    expect(txMock.payrollRun.update).toHaveBeenCalledWith({
      where: { id: "run-a" },
      data: expect.objectContaining({
        blockingIssueCount: 1,
        statusReason: "Phase 10 calculation engine failed closed",
      }),
    });
    expect(txMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { source: "CALCULATION", errorCode: "PAYROLL_CALCULATION_FAILED" },
      }),
    });
  });
});

function payrollActor() {
  return {
    id: "payroll-user",
    email: "payroll@example.local",
    roleCodes: ["PAYROLL_SPECIALIST"],
    authorizedClientIds: ["client-a"],
  };
}

function calculationGate() {
  return {
    loadedPrecheck: {
      run: {
        id: "run-a",
        clientId: "client-a",
        status: "READY_FOR_CALCULATION",
      },
    },
    resultVersionRef: "run:run-a:calc:2026-06-22T00:00:00.000Z",
  };
}

function routeContext() {
  return { params: Promise.resolve({ runId: "run-a" }) };
}

function getRequest() {
  return new NextRequest("http://test.local/api/payroll-runs/run-a/calculate", {
    method: "GET",
    headers: { "user-agent": "vitest" },
  });
}

function postRequest() {
  return new NextRequest("http://test.local/api/payroll-runs/run-a/calculate", {
    method: "POST",
    headers: { "user-agent": "vitest" },
  });
}
