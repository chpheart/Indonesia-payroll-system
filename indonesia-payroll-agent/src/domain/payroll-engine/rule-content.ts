import { type PayrollRuleRef, type RoundingMode } from "@/domain/payroll-engine/engine-types";

export type RateBracket = {
  upTo?: number;
  rate: number;
};

export type Pph21RuleConfig = {
  monthlyTerRates: RateBracket[];
  annualBrackets: RateBracket[];
  ptkpByStatus: Record<string, number>;
  defaultPtkpStatus: string;
  npwpPenaltyMultiplier: number;
};

export type BpjsRuleConfig = {
  healthEmployeeRate: number;
  healthEmployerRate: number;
  healthWageCap: number;
  jhtEmployeeRate: number;
  jhtEmployerRate: number;
  jpEmployeeRate: number;
  jpEmployerRate: number;
  jpWageCap: number;
  jkkEmployerRate: number;
  jkmEmployerRate: number;
  employmentWageCap: number;
};

export type ThrRuleConfig = {
  prorateDivisorMonths: number;
  minMonthsForFullThr: number;
};

export type GrossUpRuleConfig = {
  maxIterations: number;
  toleranceIdr: number;
};

export const MAX_GROSS_UP_SUCCESS_TOLERANCE_IDR = 1;

export function pickLatestRule(rules: PayrollRuleRef[], ruleType: PayrollRuleRef["ruleType"]) {
  const matches = rules.filter((rule) => rule.ruleType === ruleType);
  matches.sort((a, b) => b.versionNumber - a.versionNumber);
  const rule = matches[0];
  if (!rule) {
    throw new PayrollRuleContentError(`PAYROLL_RULE_${ruleType}_MISSING`);
  }
  return rule;
}

export function parsePph21Rule(rule: PayrollRuleRef): Pph21RuleConfig {
  const monthlyTerRates = parseBrackets(rule.content.monthlyTerRates);
  const annualBrackets = parseBrackets(rule.content.annualBrackets);
  const ptkpByStatus = parseNumberMap(rule.content.ptkpByStatus);
  if (monthlyTerRates.length === 0 && annualBrackets.length === 0) {
    throw new PayrollRuleContentError("PPH21_RULE_RATE_TABLE_REQUIRED");
  }
  if (Object.keys(ptkpByStatus).length === 0) {
    throw new PayrollRuleContentError("PPH21_PTKP_TABLE_REQUIRED");
  }
  return {
    monthlyTerRates,
    annualBrackets,
    ptkpByStatus,
    defaultPtkpStatus: readString(rule.content.defaultPtkpStatus, "TK/0"),
    npwpPenaltyMultiplier: readNumber(rule.content.npwpPenaltyMultiplier, 1.2),
  };
}

export function parseBpjsRule(rule: PayrollRuleRef): BpjsRuleConfig {
  const employmentWageCap = readRequiredNumber(
    rule.content.employmentWageCap,
    "BPJS_EMPLOYMENT_WAGE_CAP_REQUIRED",
  );
  return {
    healthEmployeeRate: readRequiredNumber(rule.content.healthEmployeeRate, "BPJS_HEALTH_EMPLOYEE_RATE_REQUIRED"),
    healthEmployerRate: readRequiredNumber(rule.content.healthEmployerRate, "BPJS_HEALTH_EMPLOYER_RATE_REQUIRED"),
    healthWageCap: readRequiredNumber(rule.content.healthWageCap, "BPJS_HEALTH_WAGE_CAP_REQUIRED"),
    jhtEmployeeRate: readNumberWithAlias(
      rule.content.jhtEmployeeRate,
      rule.content.employmentEmployeeRate,
      "BPJS_JHT_EMPLOYEE_RATE_REQUIRED",
    ),
    jhtEmployerRate: readNumberWithAlias(
      rule.content.jhtEmployerRate,
      rule.content.employmentEmployerRate,
      "BPJS_JHT_EMPLOYER_RATE_REQUIRED",
    ),
    jpEmployeeRate: readRequiredNumber(rule.content.jpEmployeeRate, "BPJS_JP_EMPLOYEE_RATE_REQUIRED"),
    jpEmployerRate: readRequiredNumber(rule.content.jpEmployerRate, "BPJS_JP_EMPLOYER_RATE_REQUIRED"),
    jpWageCap: readRequiredNumber(rule.content.jpWageCap, "BPJS_JP_WAGE_CAP_REQUIRED"),
    jkkEmployerRate: readRequiredNumber(rule.content.jkkEmployerRate, "BPJS_JKK_EMPLOYER_RATE_REQUIRED"),
    jkmEmployerRate: readRequiredNumber(rule.content.jkmEmployerRate, "BPJS_JKM_EMPLOYER_RATE_REQUIRED"),
    employmentWageCap,
  };
}

export function parseThrRule(rule: PayrollRuleRef): ThrRuleConfig {
  return {
    prorateDivisorMonths: readNumber(rule.content.prorateDivisorMonths, 12),
    minMonthsForFullThr: readNumber(rule.content.minMonthsForFullThr, 12),
  };
}

export function parseGrossUpRule(rule: PayrollRuleRef): GrossUpRuleConfig {
  return {
    maxIterations: readNumber(rule.content.maxIterations, 60),
    toleranceIdr: Math.min(
      readNumber(rule.content.toleranceIdr, MAX_GROSS_UP_SUCCESS_TOLERANCE_IDR),
      MAX_GROSS_UP_SUCCESS_TOLERANCE_IDR,
    ),
  };
}

export function parseRoundingMode(rule: PayrollRuleRef): RoundingMode {
  const mode = readString(rule.content.defaultMode, "HALF_UP");
  if (mode === "HALF_UP" || mode === "UP" || mode === "DOWN" || mode === "TRUNCATE") {
    return mode;
  }
  throw new PayrollRuleContentError("ROUNDING_MODE_INVALID");
}

function parseBrackets(value: unknown): RateBracket[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = asRecord(item, "RATE_BRACKET_INVALID");
    const upTo = record.upTo === null || record.upTo === undefined ? undefined : readRequiredNumber(record.upTo, "RATE_BRACKET_UP_TO_INVALID");
    return { upTo, rate: readRequiredNumber(record.rate, "RATE_BRACKET_RATE_INVALID") };
  });
}

function parseNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, readRequiredNumber(child, "NUMBER_MAP_VALUE_INVALID")]),
  );
}

function asRecord(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PayrollRuleContentError(errorCode);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  return readRequiredNumber(value, "RULE_NUMBER_INVALID");
}

function readRequiredNumber(value: unknown, errorCode: string): number {
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isFinite(numberValue)) {
    throw new PayrollRuleContentError(errorCode);
  }
  return numberValue;
}

function readNumberWithAlias(value: unknown, aliasValue: unknown, errorCode: string): number {
  if (value !== undefined && value !== null && value !== "") {
    return readRequiredNumber(value, errorCode);
  }
  return readRequiredNumber(aliasValue, errorCode);
}

export class PayrollRuleContentError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PayrollRuleContentError";
  }
}
