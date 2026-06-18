import { type Prisma } from "@/generated/prisma/client";
import { toInputJsonArray, toInputJsonObject } from "@/lib/json/input-json";
import { prisma } from "@/lib/db/prisma";

type RunPrecheckInput = {
  clientId: string;
  payrollMonth: string;
};

type VersionSnapshot = Record<string, string | number | null>;

export async function buildRunPrecheckUpdate(
  input: RunPrecheckInput,
): Promise<Prisma.PayrollRunUpdateInput> {
  const [rules, unconfirmedFxRates, confirmedFxRates] = await Promise.all([
    prisma.ruleVersion.findMany({
      where: {
        status: "PUBLISHED",
        effectiveMonth: { lte: input.payrollMonth },
        OR: [{ scopeType: "PUBLIC" }, { clientId: input.clientId }],
      },
      orderBy: [{ ruleKey: "asc" }, { versionNumber: "desc" }],
      select: {
        id: true,
        ruleKey: true,
        ruleType: true,
        scopeType: true,
        scopeKey: true,
        versionNumber: true,
        effectiveMonth: true,
        publishedAt: true,
      },
    }),
    prisma.fXRateVersion.findMany({
      where: {
        clientId: input.clientId,
        payrollMonth: input.payrollMonth,
        status: { not: "CONFIRMED" },
      },
      select: { id: true, currencyCode: true, versionNumber: true, status: true },
    }),
    prisma.fXRateVersion.findMany({
      where: {
        clientId: input.clientId,
        payrollMonth: input.payrollMonth,
        status: "CONFIRMED",
      },
      orderBy: [{ currencyCode: "asc" }, { versionNumber: "desc" }],
      select: {
        id: true,
        currencyCode: true,
        versionNumber: true,
        rate: true,
        confirmedAt: true,
      },
    }),
  ]);

  if (rules.length === 0) {
    throw new Error("PAYROLL_RUN_PUBLISHED_RULE_VERSION_REQUIRED");
  }

  if (unconfirmedFxRates.length > 0) {
    throw new Error("PAYROLL_RUN_FX_RATE_UNCONFIRMED");
  }

  const ruleVersionSnapshot: VersionSnapshot[] = rules.map((rule) => ({
    id: rule.id,
    ruleKey: rule.ruleKey,
    ruleType: rule.ruleType,
    scopeType: rule.scopeType,
    scopeKey: rule.scopeKey,
    versionNumber: rule.versionNumber,
    effectiveMonth: rule.effectiveMonth,
    publishedAt: rule.publishedAt?.toISOString() ?? null,
  }));
  const fxRateSnapshot: VersionSnapshot[] = confirmedFxRates.map((rate) => ({
    id: rate.id,
    currencyCode: rate.currencyCode,
    versionNumber: rate.versionNumber,
    rate: rate.rate.toString(),
    confirmedAt: rate.confirmedAt?.toISOString() ?? null,
  }));

  return {
    ruleVersionSnapshot: toInputJsonArray(ruleVersionSnapshot),
    fxRateSnapshot: toInputJsonArray(fxRateSnapshot),
    precheckSnapshot: toInputJsonObject({
      generatedAt: new Date().toISOString(),
      gate: "rules_and_fx_versions",
      payrollMonth: input.payrollMonth,
      ruleVersionCount: ruleVersionSnapshot.length,
      fxRateVersionCount: fxRateSnapshot.length,
      unconfirmedFxRateCount: 0,
    }),
  };
}

export function invalidateRunPrecheckUpdate(reason: string): Prisma.PayrollRunUpdateInput {
  return {
    ruleVersionSnapshot: toInputJsonArray([]),
    fxRateSnapshot: toInputJsonArray([]),
    precheckSnapshot: toInputJsonObject({
      invalidatedAt: new Date().toISOString(),
      reason,
    }),
  };
}
