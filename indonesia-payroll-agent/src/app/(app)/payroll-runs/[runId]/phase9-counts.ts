import { type PrismaClient } from "@/generated/prisma/client";

type Phase9CountTx = Pick<
  PrismaClient,
  "questionItem" | "customerConfirmationPackItem" | "customerConfirmation" | "customerConfirmationPack" | "payrollRun"
>;

export async function recalculatePendingCustomerConfirmationCount(tx: Phase9CountTx, runId: string) {
  const [openQuestions, openPackItems, staleConfirmations, latestPack] = await Promise.all([
    tx.questionItem.count({
      where: {
        runId,
        status: { in: ["PENDING", "SENT_TO_CUSTOMER", "WAITING_CUSTOMER_REPLY", "EVIDENCE_BACKFILLED"] },
      },
    }),
    tx.customerConfirmationPackItem.count({
      where: {
        runId,
        status: "OPEN",
        category: { in: ["MONTHLY_CHANGE", "MISSING_INFORMATION", "EXCEPTION", "CONFIRMATION_REQUIRED"] },
        pack: { status: { in: ["DRAFT", "READY_FOR_CUSTOMER", "PARTIALLY_CONFIRMED", "CONFIRMED"] } },
      },
    }),
    tx.customerConfirmation.count({ where: { runId, status: "STALE" } }),
    tx.customerConfirmationPack.findFirst({
      where: { runId },
      orderBy: { versionNumber: "desc" },
      select: { status: true },
    }),
  ]);
  const invalidatedLatestPack = latestPack?.status === "INVALIDATED" ? 1 : 0;

  await tx.payrollRun.update({
    where: { id: runId },
    data: { pendingCustomerConfirmationCount: openQuestions + openPackItems + staleConfirmations + invalidatedLatestPack },
  });
}
