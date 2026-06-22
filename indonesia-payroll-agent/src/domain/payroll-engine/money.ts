import { type RoundingMode } from "@/domain/payroll-engine/engine-types";

export function assertFiniteMoney(value: unknown, code: string): number {
  const numberValue = typeof value === "string" ? Number(value) : value;
  if (typeof numberValue !== "number" || !Number.isFinite(numberValue)) {
    throw new PayrollMoneyError(code);
  }
  return numberValue;
}

export function roundMoney(value: number, mode: RoundingMode): number {
  switch (mode) {
    case "UP":
      return Math.ceil(value);
    case "DOWN":
      return Math.floor(value);
    case "TRUNCATE":
      return value < 0 ? Math.ceil(value) : Math.trunc(value);
    case "HALF_UP":
      return value < 0 ? -Math.round(Math.abs(value)) : Math.round(value);
  }
}

export function sumMoney(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function clampAtZero(value: number): number {
  return value < 0 ? 0 : value;
}

export class PayrollMoneyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PayrollMoneyError";
  }
}
