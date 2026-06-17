import type { Prisma } from "@/generated/prisma/client";

export function toInputJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, toInputJsonValue(child)]),
  ) as Prisma.InputJsonObject;
}

function toInputJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toInputJsonValue(item));
  }

  if (value && typeof value === "object") {
    return toInputJsonObject(value as Record<string, unknown>);
  }

  throw new Error("INVALID_JSON_VALUE");
}
