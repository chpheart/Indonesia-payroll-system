import { roundMoney } from "@/domain/payroll-engine/money";
import { type RoundingMode } from "@/domain/payroll-engine/engine-types";
import { type ThrRuleConfig } from "@/domain/payroll-engine/rule-content";

export type ThrInput = {
  explicitThrAmount?: number;
  baseSalary: number;
  monthsWorked?: number;
  eligible: boolean;
  rule: ThrRuleConfig;
  roundingMode: RoundingMode;
};

export type ThrResult = {
  amount: number;
  method: "EXPLICIT_INPUT" | "FULL_MONTH" | "PRORATED" | "NOT_ELIGIBLE";
};

export function calculateThr(input: ThrInput): ThrResult {
  if (!input.eligible) {
    return { amount: 0, method: "NOT_ELIGIBLE" };
  }
  if (typeof input.explicitThrAmount === "number") {
    return { amount: roundMoney(input.explicitThrAmount, input.roundingMode), method: "EXPLICIT_INPUT" };
  }

  const monthsWorked = input.monthsWorked ?? input.rule.minMonthsForFullThr;
  if (monthsWorked >= input.rule.minMonthsForFullThr) {
    return { amount: roundMoney(input.baseSalary, input.roundingMode), method: "FULL_MONTH" };
  }

  return {
    amount: roundMoney(input.baseSalary * (monthsWorked / input.rule.prorateDivisorMonths), input.roundingMode),
    method: "PRORATED",
  };
}
