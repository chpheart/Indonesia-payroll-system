import { roundMoney } from "@/domain/payroll-engine/money";
import { type RoundingMode } from "@/domain/payroll-engine/engine-types";
import {
  type GrossUpRuleConfig,
  MAX_GROSS_UP_SUCCESS_TOLERANCE_IDR,
} from "@/domain/payroll-engine/rule-content";

export type GrossUpIterationResult = {
  taxAllowance: number;
  netPay: number;
  pph21: number;
};

export type GrossUpInput = {
  targetNetPay: number;
  rule: GrossUpRuleConfig;
  roundingMode: RoundingMode;
  calculateWithTaxAllowance: (taxAllowance: number) => GrossUpIterationResult;
};

export type GrossUpResult = GrossUpIterationResult & {
  iterations: number;
  difference: number;
};

export function solveGrossUp(input: GrossUpInput): GrossUpResult {
  let low = 0;
  let high = Math.max(input.targetNetPay, 1);
  const successToleranceIdr = Math.min(
    input.rule.toleranceIdr,
    MAX_GROSS_UP_SUCCESS_TOLERANCE_IDR,
  );
  let highResult = input.calculateWithTaxAllowance(high);
  let guard = 0;
  while (highResult.netPay < input.targetNetPay && guard < input.rule.maxIterations) {
    high *= 2;
    highResult = input.calculateWithTaxAllowance(high);
    guard += 1;
  }

  let best: GrossUpResult = {
    ...highResult,
    taxAllowance: high,
    iterations: guard,
    difference: Math.abs(highResult.netPay - input.targetNetPay),
  };

  for (let iteration = guard; iteration < input.rule.maxIterations; iteration += 1) {
    const mid = roundMoney((low + high) / 2, input.roundingMode);
    const result = input.calculateWithTaxAllowance(mid);
    const difference = Math.abs(result.netPay - input.targetNetPay);
    if (difference < best.difference) {
      best = { ...result, taxAllowance: mid, iterations: iteration + 1, difference };
    }
    if (difference <= successToleranceIdr) {
      return best;
    }
    if (result.netPay < input.targetNetPay) {
      low = mid;
    } else {
      high = mid;
    }
  }

  throw new GrossUpError("GROSS_UP_DID_NOT_CONVERGE");
}

export class GrossUpError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "GrossUpError";
  }
}
