import { roundMoney } from "@/domain/payroll-engine/money";
import { type RoundingMode } from "@/domain/payroll-engine/engine-types";
import { type BpjsRuleConfig } from "@/domain/payroll-engine/rule-content";

type RoundingDetail = {
  before: number;
  after: number;
};

export type BpjsInput = {
  healthBase: number;
  employmentBase: number;
  jpExempt: boolean;
  rule: BpjsRuleConfig;
  roundingMode: RoundingMode;
};

export type BpjsResult = {
  healthBase: number;
  employmentBase: number;
  healthEmployee: number;
  healthEmployer: number;
  jhtEmployee: number;
  jhtEmployer: number;
  jpEmployee: number;
  jpEmployer: number;
  jkkEmployer: number;
  jkmEmployer: number;
  employmentEmployee: number;
  employmentEmployer: number;
  parameters: Record<string, number | boolean>;
  rounding: Record<string, RoundingDetail>;
};

export function calculateBpjs(input: BpjsInput): BpjsResult {
  const healthBase = Math.min(input.healthBase, input.rule.healthWageCap);
  const employmentBase = Math.min(input.employmentBase, input.rule.employmentWageCap);
  const jpBase = input.jpExempt ? 0 : Math.min(input.employmentBase, input.rule.jpWageCap);
  const raw = {
    healthEmployee: healthBase * input.rule.healthEmployeeRate,
    healthEmployer: healthBase * input.rule.healthEmployerRate,
    jhtEmployee: employmentBase * input.rule.jhtEmployeeRate,
    jhtEmployer: employmentBase * input.rule.jhtEmployerRate,
    jpEmployee: jpBase * input.rule.jpEmployeeRate,
    jpEmployer: jpBase * input.rule.jpEmployerRate,
    jkkEmployer: employmentBase * input.rule.jkkEmployerRate,
    jkmEmployer: employmentBase * input.rule.jkmEmployerRate,
  };
  const healthEmployee = roundMoney(raw.healthEmployee, input.roundingMode);
  const healthEmployer = roundMoney(raw.healthEmployer, input.roundingMode);
  const jhtEmployee = roundMoney(raw.jhtEmployee, input.roundingMode);
  const jpEmployee = roundMoney(raw.jpEmployee, input.roundingMode);
  const jhtEmployer = roundMoney(raw.jhtEmployer, input.roundingMode);
  const jpEmployer = roundMoney(raw.jpEmployer, input.roundingMode);
  const jkkEmployer = roundMoney(raw.jkkEmployer, input.roundingMode);
  const jkmEmployer = roundMoney(raw.jkmEmployer, input.roundingMode);
  const employmentEmployee = jhtEmployee + jpEmployee;
  const employmentEmployer = jhtEmployer + jpEmployer + jkkEmployer + jkmEmployer;
  return {
    healthBase,
    employmentBase,
    healthEmployee,
    healthEmployer,
    jhtEmployee,
    jhtEmployer,
    jpEmployee,
    jpEmployer,
    jkkEmployer,
    jkmEmployer,
    employmentEmployee,
    employmentEmployer,
    parameters: {
      healthEmployeeRate: input.rule.healthEmployeeRate,
      healthEmployerRate: input.rule.healthEmployerRate,
      healthWageCap: input.rule.healthWageCap,
      jhtEmployeeRate: input.rule.jhtEmployeeRate,
      jhtEmployerRate: input.rule.jhtEmployerRate,
      jpEmployeeRate: input.rule.jpEmployeeRate,
      jpEmployerRate: input.rule.jpEmployerRate,
      jpWageCap: input.rule.jpWageCap,
      jkkEmployerRate: input.rule.jkkEmployerRate,
      jkmEmployerRate: input.rule.jkmEmployerRate,
      employmentWageCap: input.rule.employmentWageCap,
      jpExempt: input.jpExempt,
    },
    rounding: {
      healthEmployee: { before: raw.healthEmployee, after: healthEmployee },
      healthEmployer: { before: raw.healthEmployer, after: healthEmployer },
      jhtEmployee: { before: raw.jhtEmployee, after: jhtEmployee },
      jhtEmployer: { before: raw.jhtEmployer, after: jhtEmployer },
      jpEmployee: { before: raw.jpEmployee, after: jpEmployee },
      jpEmployer: { before: raw.jpEmployer, after: jpEmployer },
      jkkEmployer: { before: raw.jkkEmployer, after: jkkEmployer },
      jkmEmployer: { before: raw.jkmEmployer, after: jkmEmployer },
      employmentEmployee: { before: raw.jhtEmployee + raw.jpEmployee, after: employmentEmployee },
      employmentEmployer: {
        before: raw.jhtEmployer + raw.jpEmployer + raw.jkkEmployer + raw.jkmEmployer,
        after: employmentEmployer,
      },
    },
  };
}
