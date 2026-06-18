import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMocks = vi.hoisted(() => ({
  ruleFindMany: vi.fn(),
  fxFindMany: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ruleVersion: { findMany: prismaMocks.ruleFindMany },
    fXRateVersion: { findMany: prismaMocks.fxFindMany },
  },
}));

import { buildRunPrecheckUpdate } from "@/app/(app)/payroll-runs/precheck-snapshot";

describe("run precheck snapshot", () => {
  beforeEach(() => {
    prismaMocks.ruleFindMany.mockReset();
    prismaMocks.fxFindMany.mockReset();
  });

  it("fails closed when no published rule version is available", async () => {
    prismaMocks.ruleFindMany.mockResolvedValue([]);
    prismaMocks.fxFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await expect(
      buildRunPrecheckUpdate({ clientId: "client-a", payrollMonth: "2026-06" }),
    ).rejects.toThrow("PAYROLL_RUN_PUBLISHED_RULE_VERSION_REQUIRED");
  });

  it("blocks calculation when any fx rate for the run month is unconfirmed", async () => {
    prismaMocks.ruleFindMany.mockResolvedValue([
      {
        id: "rule-a",
        ruleKey: "PPH21_TER",
        ruleType: "PPH21",
        scopeType: "PUBLIC",
        scopeKey: "PUBLIC",
        versionNumber: 1,
        effectiveMonth: "2026-01",
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    prismaMocks.fxFindMany
      .mockResolvedValueOnce([{ id: "fx-a", currencyCode: "USD", versionNumber: 1, status: "DRAFT" }])
      .mockResolvedValueOnce([]);

    await expect(
      buildRunPrecheckUpdate({ clientId: "client-a", payrollMonth: "2026-06" }),
    ).rejects.toThrow("PAYROLL_RUN_FX_RATE_UNCONFIRMED");
  });

  it("returns rule and fx snapshots when gates pass", async () => {
    prismaMocks.ruleFindMany.mockResolvedValue([
      {
        id: "rule-a",
        ruleKey: "PPH21_TER",
        ruleType: "PPH21",
        scopeType: "PUBLIC",
        scopeKey: "PUBLIC",
        versionNumber: 1,
        effectiveMonth: "2026-01",
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ]);
    prismaMocks.fxFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: "fx-a",
        currencyCode: "USD",
        versionNumber: 1,
        rate: { toString: () => "16000" },
        confirmedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ]);

    const update = await buildRunPrecheckUpdate({
      clientId: "client-a",
      payrollMonth: "2026-06",
    });

    expect(update.ruleVersionSnapshot).toHaveLength(1);
    expect(update.fxRateSnapshot).toHaveLength(1);
    expect(update.precheckSnapshot).toMatchObject({
      gate: "rules_and_fx_versions",
      ruleVersionCount: 1,
      fxRateVersionCount: 1,
    });
  });
});
