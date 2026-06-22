import { describe, expect, it } from "vitest";
import {
  buildCustomerConfirmationPackDraft,
  assertPackHasNoCriticalOmissions,
  type PackSourceSnapshot,
} from "@/domain/confirmation-packs/customer-confirmation-pack-service";

describe("phase 9 confirmation pack source coverage", () => {
  it("adds critical standardized input changes that are not covered by ChangeLedger", () => {
    const snapshot = sourceSnapshot({
      standardizedInputs: [
        {
          id: "std-bank",
          employeeId: "employee-a",
          employeeLabel: "E001 · Ayu",
          standardField: "bankAccountNumber",
          value: { masked: "1234" },
          amount: null,
          currencyCode: "IDR",
          status: "CONFIRMED",
          evidenceStatus: "VALID",
          evidenceRefs: ["evidence-bank"],
          sourceLabel: "Sheet1 #12",
        },
      ],
    });

    const draft = buildCustomerConfirmationPackDraft(snapshot);

    expect(draft.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceObjectType: "STANDARDIZED_PAYROLL_INPUT",
          sourceObjectId: "std-bank",
          targetField: "bankAccountNumber",
          isSystemRequired: true,
        }),
      ]),
    );
    expect(() => assertPackHasNoCriticalOmissions({ items: draft.items, source: snapshot })).not.toThrow();
  });

  it("adds previous-run differences that are not covered by ChangeLedger", () => {
    const snapshot = sourceSnapshot({
      previousRunRef: "run:previous:updated:2026-05",
      standardizedInputs: [
        standardizedInput("std-current", "salaryAmount", "12000000"),
      ],
      previousStandardizedInputs: [
        standardizedInput("std-previous", "salaryAmount", "10000000"),
      ],
    });

    const draft = buildCustomerConfirmationPackDraft(snapshot);

    expect(draft.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: expect.stringContaining("上月差异需确认"),
          targetField: "salaryAmount",
          riskLevel: "R3",
          isCritical: true,
        }),
      ]),
    );
  });
});

function sourceSnapshot(input: {
  previousRunRef?: string | null;
  standardizedInputs?: PackSourceSnapshot["standardizedInputs"];
  previousStandardizedInputs?: PackSourceSnapshot["previousStandardizedInputs"];
}): PackSourceSnapshot {
  return {
    run: {
      id: "run-a",
      clientId: "client-a",
      clientCode: "SANFU",
      clientName: "Sanfu Indonesia",
      payrollMonth: "2026-06",
      status: "PENDING_CUSTOMER_CONFIRMATION",
      dataVersionRef: "run:run-a:v1",
      resultVersionRef: null,
      exportPreviewVersionRef: null,
      previousRunRef: input.previousRunRef ?? null,
    },
    ledgerEntries: [],
    standardizedInputs: input.standardizedInputs ?? [],
    previousStandardizedInputs: input.previousStandardizedInputs ?? [],
    questions: [],
    blockingIssues: [],
    highRiskIssues: [],
    invalidConfirmations: [],
  };
}

function standardizedInput(id: string, field: string, amount: string) {
  return {
    id,
    employeeId: "employee-a",
    employeeLabel: "E001 · Ayu",
    standardField: field,
    value: {},
    amount,
    currencyCode: "IDR",
    status: "CONFIRMED",
    evidenceStatus: "VALID",
    evidenceRefs: [],
    sourceLabel: "standardized",
  };
}
