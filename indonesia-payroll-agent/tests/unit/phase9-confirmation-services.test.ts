import { describe, expect, it, vi } from "vitest";
import { recalculatePendingCustomerConfirmationCount } from "@/app/(app)/payroll-runs/[runId]/phase9-counts";
import {
  buildCustomerConfirmationPackDraft,
  assertPackHasNoCriticalOmissions,
  assertPackItemCanChangeVisibility,
  type PackSourceSnapshot,
} from "@/domain/confirmation-packs/customer-confirmation-pack-service";
import {
  assertConfirmationReplyHasCoverage,
  assertCoverageScopeCovers,
  normalizeCoverageScope,
} from "@/domain/confirmation-packs/pack-coverage-service";
import { shouldInvalidateConfirmation } from "@/domain/confirmations/confirmation-service";
import {
  assertQuestionResolutionAllowed,
  assertQuestionTransitionAllowed,
} from "@/domain/questions/question-service";

describe("phase 9 evidence, customer confirmation pack, and question loop", () => {
  it("builds a pack that preserves changes, missing info, high risk, and stale confirmation items", () => {
    const snapshot = packSnapshot();
    const draft = buildCustomerConfirmationPackDraft(snapshot);

    expect(draft.status).toBe("DRAFT");
    expect(draft.items.map((item) => item.category)).toEqual(
      expect.arrayContaining([
        "MONTHLY_CHANGE",
        "MISSING_INFORMATION",
        "CONFIRMATION_REQUIRED",
        "SUGGESTED_MESSAGE",
      ]),
    );
    expect(draft.items.filter((item) => item.isCritical || item.isSystemRequired)).toHaveLength(4);
    expect(() => assertPackHasNoCriticalOmissions({ items: draft.items, source: snapshot })).not.toThrow();
    expect(draft.generatedMessage).toContain("确认无误");
  });

  it("rejects hiding critical confirmation pack items without a safe handling path", () => {
    const criticalItem = buildCustomerConfirmationPackDraft(packSnapshot()).items.find((item) => item.isCritical);
    expect(criticalItem).toBeTruthy();

    expect(() =>
      assertPackItemCanChangeVisibility({
        item: criticalItem!,
        nextStatus: "CONFIRMED",
      }),
    ).toThrow("CUSTOMER_CONFIRMATION_PACK_CRITICAL_ITEM_REQUIRES_CUSTOMER_CONFIRMATION");
    expect(() =>
      assertPackItemCanChangeVisibility({
        item: criticalItem!,
        nextStatus: "INTERNAL_HANDLING",
      }),
    ).toThrow("CUSTOMER_CONFIRMATION_PACK_HANDLING_REASON_REQUIRED");
    expect(() =>
      assertPackItemCanChangeVisibility({
        item: criticalItem!,
        nextStatus: "INTERNAL_HANDLING",
        handlingReason: "主管确认改走内部处理并保留审计",
      }),
    ).toThrow("CUSTOMER_CONFIRMATION_PACK_CRITICAL_ITEM_CANNOT_BE_HIDDEN");
    expect(() =>
      assertPackItemCanChangeVisibility({
        item: criticalItem!,
        nextStatus: "INVALIDATED",
        handlingReason: "人工跳过客户确认",
      }),
    ).toThrow("CUSTOMER_CONFIRMATION_PACK_CRITICAL_ITEM_CANNOT_BE_INVALIDATED_MANUALLY");
    expect(() =>
      assertPackItemCanChangeVisibility({
        item: { ...criticalItem!, isCritical: false, isSystemRequired: false },
        nextStatus: "INTERNAL_HANDLING",
        handlingReason: "低风险附件由内部归档",
      }),
    ).not.toThrow();
  });

  it("prevents using evidence to confirm a broader or unrelated coverage scope", () => {
    const evidenceScope = normalizeCoverageScope({
      type: "MIXED",
      runId: "run-a",
      employeeIds: ["employee-a"],
      fields: ["bankAccountNumber"],
    });
    expect(() =>
      assertCoverageScopeCovers({
        evidenceScope,
        requestedScope: normalizeCoverageScope({
          type: "MIXED",
          runId: "run-a",
          employeeIds: ["employee-a"],
          fields: ["salaryAmount"],
        }),
      }),
    ).toThrow("COVERAGE_SCOPE_NOT_COVERED_BY_EVIDENCE");
    expect(() =>
      assertCoverageScopeCovers({
        evidenceScope,
        requestedScope: normalizeCoverageScope({
          type: "FIELDS",
          runId: "run-a",
          fields: ["bankAccountNumber"],
        }),
      }),
    ).toThrow("COVERAGE_SCOPE_NOT_COVERED_BY_EVIDENCE");
    expect(() =>
      assertCoverageScopeCovers({
        evidenceScope,
        requestedScope: normalizeCoverageScope({
          type: "MIXED",
          runId: "run-a",
          employeeIds: ["employee-a"],
          fields: ["bankAccountNumber"],
        }),
      }),
    ).not.toThrow();
  });

  it("keeps an invalidated latest confirmation pack as pending until it is regenerated", async () => {
    const payrollRunUpdateMock = vi.fn();

    await recalculatePendingCustomerConfirmationCount(
      {
        questionItem: { count: vi.fn(async () => 0) },
        customerConfirmationPackItem: { count: vi.fn(async () => 0) },
        customerConfirmation: { count: vi.fn(async () => 0) },
        customerConfirmationPack: {
          findFirst: vi.fn(async () => ({ status: "INVALIDATED" })),
        },
        payrollRun: { update: payrollRunUpdateMock },
      } as never,
      "run-a",
    );

    expect(payrollRunUpdateMock).toHaveBeenCalledWith({
      where: { id: "run-a" },
      data: { pendingCustomerConfirmationCount: 1 },
    });
  });

  it("rejects run-only mixed customer confirmation coverage", () => {
    expect(() =>
      assertConfirmationReplyHasCoverage({
        confirmationText: "确认无误",
        coverageScope: normalizeCoverageScope({ type: "MIXED", runId: "run-a" }),
      }),
    ).toThrow("CONFIRMATION_COVERAGE_SCOPE_REQUIRED");
  });

  it("requires explicit coverage for customer replies and invalidates matching old confirmations", () => {
    expect(() =>
      assertConfirmationReplyHasCoverage({
        confirmationText: "确认无误",
        coverageScope: normalizeCoverageScope({ type: "MIXED" }),
      }),
    ).toThrow("CONFIRMATION_COVERAGE_SCOPE_REQUIRED");

    const coverageScope = normalizeCoverageScope({
      type: "MIXED",
      runId: "run-a",
      employeeIds: ["employee-a"],
      fields: ["salaryAmount"],
    });
    expect(() =>
      assertConfirmationReplyHasCoverage({
        confirmationText: "确认无误",
        coverageScope,
      }),
    ).not.toThrow();
    expect(
      shouldInvalidateConfirmation({
        confirmation: { status: "VALID", coverageScope },
        change: { runId: "run-a", targetEmployeeId: "employee-a", targetField: "salaryAmount" },
      }),
    ).toBe(true);
  });

  it("blocks resolving a blocker-linked question without evidence", () => {
    const question = {
      blockingIssueRef: "blocking:fx-rate",
      evidenceRefs: [],
    };

    expect(() => assertQuestionTransitionAllowed("WAITING_CUSTOMER_REPLY", "RESOLVED")).toThrow(
      "QUESTION_STATUS_TRANSITION_NOT_ALLOWED",
    );
    expect(() =>
      assertQuestionResolutionAllowed({
        question,
        toStatus: "RESOLVED",
        resolutionNote: "客户回复了",
        blockingStatus: "RESOLVED",
        verifiedEvidenceCount: 0,
      }),
    ).toThrow("QUESTION_BLOCKING_EVIDENCE_REQUIRED");
    expect(() =>
      assertQuestionResolutionAllowed({
        question,
        toStatus: "RESOLVED",
        evidenceRef: "evidence:fx-rate-confirmation",
        resolutionNote: "客户确认汇率",
        blockingStatus: "UNRESOLVED",
        verifiedEvidenceCount: 1,
      }),
    ).toThrow("QUESTION_BLOCKING_ISSUE_UNRESOLVED");
    expect(() =>
      assertQuestionResolutionAllowed({
        question,
        toStatus: "RESOLVED",
        evidenceRef: "evidence:fx-rate-confirmation",
        resolutionNote: "客户确认汇率",
        blockingStatus: "RESOLVED",
        verifiedEvidenceCount: 1,
      }),
    ).not.toThrow();
  });
});

function packSnapshot(): PackSourceSnapshot {
  return {
    run: {
      id: "run-a",
      clientId: "client-a",
      clientCode: "SANFU",
      clientName: "Sanfu Indonesia",
      payrollMonth: "2026-06",
      status: "PENDING_CUSTOMER_CONFIRMATION",
      dataVersionRef: "run:run-a:v3",
      resultVersionRef: null,
      exportPreviewVersionRef: null,
    },
    ledgerEntries: [
      {
        id: "ledger-salary",
        entryType: "SALARY_ADJUSTMENT",
        targetEmployeeId: "employee-a",
        employeeLabel: "E001 · Ayu",
        targetField: "salaryAmount",
        previousValue: { amount: 10_000_000 },
        newValue: { amount: 12_000_000 },
        riskLevel: "R3",
        evidenceRefs: ["evidence:salary"],
      },
    ],
    questions: [
      {
        id: "question-fx",
        title: "确认 USD 汇率",
        detail: "外币工资缺少客户确认汇率",
        reason: "缺少汇率会阻断预检查",
        status: "WAITING_CUSTOMER_REPLY",
        riskLevel: "R2",
        targetField: "fxRate",
        blockingIssueRef: "blocking:fx",
        evidenceRefs: [],
      },
    ],
    standardizedInputs: [],
    previousStandardizedInputs: [],
    blockingIssues: [],
    highRiskIssues: [
      {
        id: "high-risk-bank",
        title: "银行账号变化",
        detail: "关键付款字段需要客户确认",
        riskLevel: "R3",
        sourceObjectType: "PAYROLL_RUN",
        sourceObjectId: "run-a",
      },
    ],
    invalidConfirmations: [
      {
        id: "confirmation-old",
        invalidationReason: "salaryAmount 已变化，旧确认失效",
        coverageScope: normalizeCoverageScope({
          type: "MIXED",
          runId: "run-a",
          employeeIds: ["employee-a"],
          fields: ["salaryAmount"],
        }),
      },
    ],
  };
}
