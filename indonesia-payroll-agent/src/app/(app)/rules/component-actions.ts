"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actorHasPermission,
  assertClientActionAllowed,
} from "@/domain/auth/permissions";
import { normalizeComponentAlias } from "@/domain/components/component-service";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

const componentSchema = z.object({
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  componentType: z.enum(["EARNING", "DEDUCTION", "TAX_ALLOWANCE", "BENEFIT", "EMPLOYER_COST", "MEMO"]),
  effectiveMonth: z.string().max(7).optional(),
  taxableCash: z.boolean(),
  bpjsHealthBase: z.boolean(),
  bpjsEmploymentBase: z.boolean(),
  paidOut: z.boolean(),
  affectsNetPay: z.boolean(),
  affectsEmployerCost: z.boolean(),
});

const aliasSchema = z.object({
  clientId: z.string().min(1),
  componentId: z.string().min(1),
  sourceLabel: z.string().min(1).max(160),
  effectiveMonth: z.string().min(7).max(7),
  evidenceRefs: z.string().optional(),
  changeReason: z.string().min(1).max(1000),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function checkboxValue(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function splitRefs(value: string) {
  return value
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean);
}

export async function createPayrollComponentAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  if (!actorHasPermission(actor, "rules.configure")) {
    throw new Error("ROLE_MISSING_PERMISSION");
  }

  const body = componentSchema.parse({
    code: textValue(formData, "code").toUpperCase(),
    name: textValue(formData, "name"),
    componentType: textValue(formData, "componentType"),
    effectiveMonth: textValue(formData, "effectiveMonth") || undefined,
    taxableCash: checkboxValue(formData, "taxableCash"),
    bpjsHealthBase: checkboxValue(formData, "bpjsHealthBase"),
    bpjsEmploymentBase: checkboxValue(formData, "bpjsEmploymentBase"),
    paidOut: formData.has("paidOut"),
    affectsNetPay: formData.has("affectsNetPay"),
    affectsEmployerCost: checkboxValue(formData, "affectsEmployerCost"),
  });

  const component = await prisma.payrollComponent.create({
    data: { ...body, createdById: auditFields.actorUserId },
  });
  await prisma.auditLog.create({
    data: {
      action: "PAYROLL_COMPONENT_CREATED",
      objectType: "PAYROLL_COMPONENT",
      objectId: component.id,
      riskLevel: "R2",
      ...auditFields,
      metadata: {
        code: component.code,
        componentType: component.componentType,
        inputSummary: "新增系统级薪资组件字典项",
        outputSummary: "组件属性固定，客户别名不得覆盖",
      },
    },
  });

  revalidatePath("/rules");
}

export async function createComponentAliasAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = aliasSchema.parse({
    clientId: textValue(formData, "clientId"),
    componentId: textValue(formData, "componentId"),
    sourceLabel: textValue(formData, "sourceLabel"),
    effectiveMonth: textValue(formData, "effectiveMonth"),
    evidenceRefs: textValue(formData, "evidenceRefs") || undefined,
    changeReason: textValue(formData, "changeReason"),
  });
  assertClientActionAllowed(actor, "configureRules", body.clientId);

  const component = await prisma.payrollComponent.findUnique({
    where: { id: body.componentId },
    select: { id: true, code: true, status: true },
  });
  if (!component || component.status !== "ACTIVE") {
    throw new Error("ACTIVE_PAYROLL_COMPONENT_REQUIRED");
  }

  const normalizedLabel = normalizeComponentAlias(body.sourceLabel);
  const latest = await prisma.clientComponentAlias.findFirst({
    where: { clientId: body.clientId, normalizedLabel },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const alias = await prisma.clientComponentAlias.create({
    data: {
      clientId: body.clientId,
      componentId: body.componentId,
      sourceLabel: body.sourceLabel,
      normalizedLabel,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      effectiveMonth: body.effectiveMonth,
      evidenceRefs: splitRefs(body.evidenceRefs ?? ""),
      changeReason: body.changeReason,
      createdById: auditFields.actorUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "CLIENT_COMPONENT_ALIAS_VERSION_CREATED",
      objectType: "CLIENT_COMPONENT_ALIAS",
      objectId: alias.id,
      riskLevel: "R2",
      ...auditFields,
      clientId: alias.clientId,
      metadata: {
        sourceLabel: alias.sourceLabel,
        componentCode: component.code,
        versionNumber: alias.versionNumber,
        inputSummary: "创建客户组件别名草稿版本",
        outputSummary: "别名只预填标准组件映射，不改变标准组件属性",
      },
    },
  });

  revalidatePath("/rules");
}
