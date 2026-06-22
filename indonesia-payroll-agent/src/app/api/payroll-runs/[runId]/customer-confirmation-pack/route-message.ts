import { type PrismaClient } from "@/generated/prisma/client";
import { type RequestAuditFields } from "@/lib/audit/request-audit-fields";

type MessageTx = Pick<PrismaClient, "customerConfirmationPack" | "auditLog">;

export async function updateCustomerConfirmationPackMessage(
  tx: MessageTx,
  input: {
    runId: string;
    packId: string;
    editableMessage: string;
    auditFields: RequestAuditFields;
  },
) {
  const pack = await tx.customerConfirmationPack.findUnique({
    where: { id: input.packId },
    select: { id: true, clientId: true, runId: true, status: true },
  });
  if (!pack || pack.runId !== input.runId) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_NOT_FOUND");
  }
  if (["INVALIDATED", "SUPERSEDED"].includes(pack.status)) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_NOT_EDITABLE");
  }
  const updated = await tx.customerConfirmationPack.update({
    where: { id: pack.id },
    data: { editableMessage: input.editableMessage },
  });
  await tx.auditLog.create({
    data: {
      action: "CUSTOMER_CONFIRMATION_PACK_UPDATED",
      objectType: "CUSTOMER_CONFIRMATION_PACK",
      objectId: pack.id,
      riskLevel: "R1",
      ...input.auditFields,
      clientId: pack.clientId,
      runId: pack.runId,
      metadata: { field: "editableMessage", inputSummary: "对客确认话术已人工编辑" },
    },
  });

  return updated;
}
