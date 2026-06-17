"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actorHasPermission,
  assertClientActionAllowed,
  type ActorContext,
} from "@/domain/auth/permissions";
import {
  assertRuleCanRecordRegression,
  hasBlockingConflict,
  regressionStatusFor,
  scopeKeyForRule,
} from "@/domain/rules/rule-gates";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject } from "@/lib/json/input-json";

const ruleDraftSchema = z.object({
  ruleKey: z.string().min(1).max(80),
  ruleType: z.enum([
    "PPH21",
    "BPJS",
    "THR",
    "GROSS_UP",
    "FX",
    "ROUNDING",
    "CUSTOMER_POLICY",
    "COMPONENT_CLASSIFICATION",
  ]),
  scopeType: z.enum(["PUBLIC", "CUSTOMER", "COMPONENT"]),
  clientId: z.string().optional(),
  componentId: z.string().optional(),
  effectiveMonth: z.string().min(7).max(7),
  content: z.record(z.string(), z.unknown()),
  conflictCheckSummary: z.record(z.string(), z.unknown()),
  changeSummary: z.string().min(1).max(1000),
});

const approvalSchema = z.object({
  ruleVersionId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().min(1).max(1000),
});

const regressionSchema = z.object({
  ruleVersionId: z.string().min(1),
  datasetCode: z.enum(["BLUE_FOCUS", "SANFU"]),
  scenarioName: z.string().min(1).max(160),
  expectedEmployeeCount: z.coerce.number().int().nonnegative(),
  actualEmployeeCount: z.coerce.number().int().nonnegative(),
  maxDiffIdr: z.coerce.number(),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  return textValue(formData, key) || undefined;
}

function parseJsonObject(value: string) {
  if (!value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON_OBJECT_REQUIRED");
  }
  return parsed as Record<string, unknown>;
}

function assertRuleWriteAllowed(actor: ActorContext, clientId?: string | null) {
  if (clientId) {
    assertClientActionAllowed(actor, "configureRules", clientId);
    return;
  }
  if (!actorHasPermission(actor, "rules.configure")) {
    throw new Error("ROLE_MISSING_PERMISSION");
  }
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

export async function createRuleDraftAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = ruleDraftSchema.parse({
    ruleKey: textValue(formData, "ruleKey").toUpperCase(),
    ruleType: textValue(formData, "ruleType"),
    scopeType: textValue(formData, "scopeType"),
    clientId: optionalText(formData, "clientId"),
    componentId: optionalText(formData, "componentId"),
    effectiveMonth: textValue(formData, "effectiveMonth"),
    content: parseJsonObject(textValue(formData, "contentJson")),
    conflictCheckSummary: parseJsonObject(textValue(formData, "conflictCheckJson")),
    changeSummary: textValue(formData, "changeSummary"),
  });
  assertRuleWriteAllowed(actor, body.clientId);
  if (hasBlockingConflict(body.conflictCheckSummary)) {
    throw new Error("CUSTOMER_RULE_CONFLICTS_PUBLIC_BASELINE");
  }

  const scopeKey = scopeKeyForRule(body.scopeType, body.clientId, body.componentId);
  const latest = await prisma.ruleVersion.findFirst({
    where: { ruleKey: body.ruleKey, scopeKey },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const rule = await prisma.ruleVersion.create({
    data: {
      ruleKey: body.ruleKey,
      ruleType: body.ruleType,
      scopeType: body.scopeType,
      scopeKey,
      clientId: body.clientId,
      componentId: body.componentId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      effectiveMonth: body.effectiveMonth,
      content: toInputJsonObject(body.content),
      conflictCheckSummary: toInputJsonObject(body.conflictCheckSummary),
      changeSummary: body.changeSummary,
      draftedById: auditFields.actorUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "RULE_VERSION_DRAFTED",
      objectType: "RULE_VERSION",
      objectId: rule.id,
      riskLevel: "R2",
      ...auditFields,
      clientId: rule.clientId,
      metadata: {
        ruleKey: rule.ruleKey,
        versionNumber: rule.versionNumber,
        inputSummary: "起草规则版本，不进入正式算薪",
        outputSummary: "DRAFT 规则已保存，发布前必须审批并通过回归",
      },
    },
  });

  revalidatePath("/rules");
}

export async function approveRuleAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = approvalSchema.parse({
    ruleVersionId: textValue(formData, "ruleVersionId"),
    decision: textValue(formData, "decision"),
    note: textValue(formData, "note"),
  });
  const rule = await prisma.ruleVersion.findUnique({ where: { id: body.ruleVersionId } });
  if (!rule) {
    throw new Error("RULE_VERSION_NOT_FOUND");
  }
  assertRuleApproveAllowed(actor, rule.clientId);

  await prisma.$transaction([
    prisma.ruleApproval.create({
      data: {
        ruleVersionId: rule.id,
        decision: body.decision,
        note: body.note,
        approverId: auditFields.actorUserId,
      },
    }),
    ...(body.decision === "APPROVED" && rule.status === "DRAFT"
      ? [prisma.ruleVersion.update({ where: { id: rule.id }, data: { status: "APPROVED" } })]
      : []),
    prisma.auditLog.create({
      data: {
        action: "RULE_VERSION_APPROVED",
        objectType: "RULE_VERSION",
        objectId: rule.id,
        riskLevel: "R3",
        ...auditFields,
        clientId: rule.clientId,
        metadata: { decision: body.decision, note: body.note },
      },
    }),
  ]);

  revalidatePath("/rules");
}

export async function recordRegressionRunAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = regressionSchema.parse({
    ruleVersionId: textValue(formData, "ruleVersionId"),
    datasetCode: textValue(formData, "datasetCode"),
    scenarioName: textValue(formData, "scenarioName"),
    expectedEmployeeCount: optionalText(formData, "expectedEmployeeCount"),
    actualEmployeeCount: optionalText(formData, "actualEmployeeCount"),
    maxDiffIdr: textValue(formData, "maxDiffIdr"),
  });
  const rule = await prisma.ruleVersion.findUnique({ where: { id: body.ruleVersionId } });
  if (!rule) {
    throw new Error("RULE_VERSION_NOT_FOUND");
  }
  assertRuleWriteAllowed(actor, rule.clientId);
  assertRuleCanRecordRegression(rule.status);
  const status = regressionStatusFor(body);

  const regression = await prisma.regressionRun.upsert({
    where: {
      ruleVersionId_datasetCode_scenarioName: {
        ruleVersionId: rule.id,
        datasetCode: body.datasetCode,
        scenarioName: body.scenarioName,
      },
    },
    create: {
      ...body,
      status,
      blockingThresholdIdr: 10_000,
      warningThresholdIdr: 1_000,
      runById: auditFields.actorUserId,
    },
    update: {
      status,
      expectedEmployeeCount: body.expectedEmployeeCount,
      actualEmployeeCount: body.actualEmployeeCount,
      maxDiffIdr: body.maxDiffIdr,
      resultSummary: {},
      runById: auditFields.actorUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "REGRESSION_RUN_RECORDED",
      objectType: "REGRESSION_RUN",
      objectId: regression.id,
      riskLevel: regression.status === "PASSED" ? "R1" : "R2",
      ...auditFields,
      clientId: rule.clientId,
      metadata: {
        ruleVersionId: rule.id,
        datasetCode: regression.datasetCode,
        status: regression.status,
        maxDiffIdr: Number(regression.maxDiffIdr),
        inputSummary: "记录系统回归输出数值，状态由人数和差异阈值自动计算",
      },
    },
  });

  revalidatePath("/rules");
}
