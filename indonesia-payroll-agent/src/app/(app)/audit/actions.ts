"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

const correctionSchema = z.object({
  auditLogId: z.string().min(1),
  note: z.string().min(1).max(1000),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function appendAuditCorrectionAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = correctionSchema.parse({
    auditLogId: textValue(formData, "auditLogId"),
    note: textValue(formData, "note"),
  });
  const auditLog = await prisma.auditLog.findUnique({ where: { id: body.auditLogId } });

  if (!auditLog) {
    throw new Error("AUDIT_LOG_NOT_FOUND");
  }

  if (auditLog.clientId) {
    assertClientActionAllowed(actor, "viewAudit", auditLog.clientId);
  }

  await prisma.auditCorrection.create({
    data: {
      auditLogId: auditLog.id,
      note: body.note,
      createdById: auditFields.actorUserId,
      createdByEmail: actor.email,
    },
  });

  revalidatePath("/audit");
}
