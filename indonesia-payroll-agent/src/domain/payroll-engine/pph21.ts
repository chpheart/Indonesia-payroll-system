import { clampAtZero, roundMoney } from "@/domain/payroll-engine/money";
import { type RoundingMode } from "@/domain/payroll-engine/engine-types";
import { type Pph21RuleConfig, type RateBracket } from "@/domain/payroll-engine/rule-content";

type RoundingDetail = {
  before: number;
  after: number;
};

export type Pph21Input = {
  taxableIncome: number;
  hasNpwp: boolean;
  ptkpStatus?: string | null;
  isFinalSettlement: boolean;
  yearToDateTaxableIncome: number;
  yearToDatePph21Paid: number;
  rule: Pph21RuleConfig;
  roundingMode: RoundingMode;
};

export type Pph21Result = {
  pph21: number;
  method: "TER" | "PASAL17_FINAL" | "PASAL17_MONTHLY";
  taxableIncome: number;
  annualTaxableIncome: number;
  ptkpDeduction: number;
  npwpPenaltyMultiplier: number;
  rateApplied?: number;
  parameters: Record<string, unknown>;
  rounding: Record<string, RoundingDetail>;
};

export function calculatePph21(input: Pph21Input): Pph21Result {
  const ptkpStatus = input.ptkpStatus || input.rule.defaultPtkpStatus;
  const ptkpDeduction = input.rule.ptkpByStatus[ptkpStatus];
  if (ptkpDeduction === undefined) {
    throw new Error("PPH21_PTKP_STATUS_NOT_CONFIGURED");
  }
  const penalty = input.hasNpwp ? 1 : input.rule.npwpPenaltyMultiplier;

  if (input.isFinalSettlement) {
    assertAnnualBracketsAvailable(input.rule.annualBrackets);
    const annualTaxableIncome = clampAtZero(
      input.yearToDateTaxableIncome + input.taxableIncome - ptkpDeduction,
    );
    const rawAnnualTax = applyProgressiveBrackets(annualTaxableIncome, input.rule.annualBrackets) * penalty;
    const annualTax = roundMoney(rawAnnualTax, input.roundingMode);
    const rawPph21 = clampAtZero(annualTax - input.yearToDatePph21Paid);
    return {
      pph21: rawPph21,
      method: "PASAL17_FINAL",
      taxableIncome: input.taxableIncome,
      annualTaxableIncome,
      ptkpDeduction,
      npwpPenaltyMultiplier: penalty,
      parameters: pph21Parameters({
        method: "PASAL17_FINAL",
        ptkpStatus,
        ptkpDeduction,
        npwpPenaltyMultiplier: penalty,
        annualBrackets: input.rule.annualBrackets,
        yearToDateTaxableIncome: input.yearToDateTaxableIncome,
        yearToDatePph21Paid: input.yearToDatePph21Paid,
      }),
      rounding: {
        annualTax: { before: rawAnnualTax, after: annualTax },
        pph21: { before: rawPph21, after: rawPph21 },
      },
    };
  }

  if (input.rule.monthlyTerRates.length > 0) {
    const rate = pickRate(input.taxableIncome, input.rule.monthlyTerRates);
    const rawPph21 = input.taxableIncome * rate * penalty;
    const pph21 = roundMoney(rawPph21, input.roundingMode);
    return {
      pph21,
      method: "TER",
      taxableIncome: input.taxableIncome,
      annualTaxableIncome: input.taxableIncome * 12,
      ptkpDeduction,
      npwpPenaltyMultiplier: penalty,
      rateApplied: rate,
      parameters: pph21Parameters({
        method: "TER",
        ptkpStatus,
        ptkpDeduction,
        npwpPenaltyMultiplier: penalty,
        rateApplied: rate,
        monthlyTerRates: input.rule.monthlyTerRates,
      }),
      rounding: { pph21: { before: rawPph21, after: pph21 } },
    };
  }

  const annualTaxableIncome = clampAtZero(input.taxableIncome * 12 - ptkpDeduction);
  assertAnnualBracketsAvailable(input.rule.annualBrackets);
  const rawPph21 = (applyProgressiveBrackets(annualTaxableIncome, input.rule.annualBrackets) / 12) * penalty;
  const pph21 = roundMoney(rawPph21, input.roundingMode);
  return {
    pph21,
    method: "PASAL17_MONTHLY",
    taxableIncome: input.taxableIncome,
    annualTaxableIncome,
    ptkpDeduction,
    npwpPenaltyMultiplier: penalty,
    parameters: pph21Parameters({
      method: "PASAL17_MONTHLY",
      ptkpStatus,
      ptkpDeduction,
      npwpPenaltyMultiplier: penalty,
      annualBrackets: input.rule.annualBrackets,
    }),
    rounding: { pph21: { before: rawPph21, after: pph21 } },
  };
}

function pph21Parameters(parameters: Record<string, unknown>) {
  return parameters;
}

function pickRate(taxableIncome: number, brackets: RateBracket[]): number {
  const ordered = [...brackets].sort((a, b) => (a.upTo ?? Number.POSITIVE_INFINITY) - (b.upTo ?? Number.POSITIVE_INFINITY));
  return ordered.find((bracket) => bracket.upTo === undefined || taxableIncome <= bracket.upTo)?.rate ?? 0;
}

function applyProgressiveBrackets(amount: number, brackets: RateBracket[]): number {
  const ordered = [...brackets].sort((a, b) => (a.upTo ?? Number.POSITIVE_INFINITY) - (b.upTo ?? Number.POSITIVE_INFINITY));
  let remaining = amount;
  let lowerBound = 0;
  let tax = 0;
  for (const bracket of ordered) {
    const upper = bracket.upTo ?? Number.POSITIVE_INFINITY;
    const taxableInBracket = Math.min(remaining, upper - lowerBound);
    if (taxableInBracket <= 0) break;
    tax += taxableInBracket * bracket.rate;
    remaining -= taxableInBracket;
    lowerBound = upper;
  }
  return tax;
}

function assertAnnualBracketsAvailable(brackets: RateBracket[]): void {
  if (brackets.length === 0) {
    throw new Error("PPH21_ANNUAL_BRACKETS_REQUIRED");
  }
}
