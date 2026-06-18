import { type Prisma } from "@/generated/prisma/client";
import { type PayrollRunStatus } from "@/domain/payroll-runs/run-state-machine";

export function terminalTimestampUpdate(status: PayrollRunStatus, at = new Date()) {
  switch (status) {
    case "LOCKED":
      return { lockedAt: at };
    case "EXPORTED":
      return { exportedAt: at };
    case "ARCHIVED":
      return { archivedAt: at };
    case "VOIDED":
      return { voidedAt: at };
    case "CORRECTED":
      return { correctedAt: at };
    default:
      return {};
  }
}

export function statusUpdateData(
  status: PayrollRunStatus,
  statusReason: string,
): Prisma.PayrollRunUpdateInput {
  return {
    status,
    statusReason,
    ...terminalTimestampUpdate(status),
  };
}
