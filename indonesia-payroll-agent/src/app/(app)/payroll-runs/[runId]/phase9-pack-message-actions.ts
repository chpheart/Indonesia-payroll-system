"use server";
import { revalidatePath } from "next/cache";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { textValue } from "@/app/(app)/payroll-runs/[runId]/phase8-form-utils";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export async function updateCustomerConfirmationPackMessageAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const runId = textValue(formData, "runId");
  const packId = textValue(formData, "packId");
  const editableMessage = textValue(formData, "editableMessage");
  if (!editableMessage) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_MESSAGE_REQUIRED");
  }

  await prisma.$transaction(async (tx) => {
    const pack = await tx.customerConfirmationPack.findUnique({
      where: { id: packId },
      select: { id: true, clientId: true, runId: true, status: true },
    });
    if (!pack || pack.runId !== runId) {
      throw new Error("CUSTOMER_CONFIRMATION_PACK_NOT_FOUND");
    }
    if (["INVALIDATED", "SUPERSEDED"].includes(pack.status)) {
      throw new Error("CUSTOMER_CONFIRMATION_PACK_NOT_EDITABLE");
    }
    assertClientActionAllowed(actor, "updatePayrollRun", pack.clientId);
    await tx.customerConfirmationPack.update({
      where: { id: pack.id },
      data: { editableMessage },
    });
    await tx.auditLog.create({
      data: {
        action: "CUSTOMER_CONFIRMATION_PACK_UPDATED",
        objectType: "CUSTOMER_CONFIRMATION_PACK",
        objectId: pack.id,
        riskLevel: "R1",
        ...auditFields,
        clientId: pack.clientId,
        runId: pack.runId,
        metadata: { field: "editableMessage", inputSummary: "对客确认话术已人工编辑" },
      },
    });
  });

  revalidatePath(`/payroll-runs/${runId}/customer-confirmation`);
}
