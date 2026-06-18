"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actorHasPermission,
  assertClientActionAllowed,
  type ActorContext,
} from "@/domain/auth/permissions";
import { assertRegressionGate } from "@/domain/rules/rule-gates";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

const publishSchema = z.object({
  ruleVersionId: z.string().min(1),
  confirmationText: z.string().min(1),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function assertRuleApproveAllowed(actor: ActorContext, clientId?: string | null) {
  if (clientId) {
    assertClientActionAllowed(actor, "approveRules", clientId);
    return;
  }
  if (!actorHasPermission(actor, "rules.approve")) {
    throw new Error("ROLE_MISSING_PERMISSION");
  }
}

export async function publishRuleAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = publishSchema.parse({
    ruleVersionId: textValue(formData, "ruleVersionId"),
    confirmationText: textValue(formData, "confirmationText"),
  });
  const rule = await prisma.ruleVersion.findUnique({
    where: { id: body.ruleVersionId },
    include: { approvals: true, regressionRuns: true },
  });
  if (!rule) {
    throw new Error("RULE_VERSION_NOT_FOUND");
  }
  if (body.confirmationText !== "PUBLISH") {
    throw new Error("RULE_PUBLISH_CONFIRMATION_REQUIRED");
  }
  assertRuleApproveAllowed(actor, rule.clientId);
  if (rule.status === "PUBLISHED") {
    return;
  }
  if (!rule.approvals.some((approval) => approval.decision === "APPROVED")) {
    throw new Error("RULE_APPROVAL_REQUIRED_BEFORE_PUBLISH");
  }
  assertRegressionGate(rule.regressionRuns);

  await prisma.$transaction([
    prisma.ruleVersion.update({
      where: { id: rule.id },
      data: {
        status: "PUBLISHED",
        publishedById: auditFields.actorUserId,
        publishedAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "RULE_VERSION_PUBLISHED",
        objectType: "RULE_VERSION",
        objectId: rule.id,
        riskLevel: "R3",
        ...auditFields,
        clientId: rule.clientId,
        metadata: {
          ruleKey: rule.ruleKey,
          versionNumber: rule.versionNumber,
          inputSummary: "发布规则版本，正式 payroll run 可引用",
          outputSummary: "规则已通过审批与蓝色光标/三福回归门禁",
        },
      },
    }),
  ]);

  revalidatePath("/rules");
}
