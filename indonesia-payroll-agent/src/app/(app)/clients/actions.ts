"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  actorHasPermission,
  assertClientActionAllowed,
} from "@/domain/auth/permissions";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

const clientSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  legalEntityName: z.string().max(200).optional(),
});

const configVersionSchema = z.object({
  clientId: z.string().min(1),
  effectiveMonth: z.string().min(7).max(7),
  payrollDay: z.coerce.number().int().min(1).max(31).optional(),
  templateCode: z.string().max(80).optional(),
  grossUpDefault: z.enum(["on"]).optional(),
  changeReason: z.string().min(1).max(500),
  evidenceRefs: z.string().optional(),
});

const grantClientAccessSchema = z.object({
  clientId: z.string().min(1),
  userId: z.string().min(1),
  roleId: z.string().min(1),
});

const revokeClientAccessSchema = z.object({
  accessId: z.string().min(1),
  clientId: z.string().min(1),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function splitRefs(value: string) {
  return value
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean);
}

export async function createClientAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  if (!actorHasPermission(actor, "client.edit")) {
    throw new Error("ROLE_MISSING_PERMISSION");
  }

  const body = clientSchema.parse({
    code: textValue(formData, "code"),
    name: textValue(formData, "name"),
    legalEntityName: textValue(formData, "legalEntityName") || undefined,
  });

  const client = await prisma.client.create({
    data: {
      code: body.code,
      name: body.name,
      legalEntityName: body.legalEntityName,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "CLIENT_CREATED",
      objectType: "CLIENT",
      objectId: client.id,
      riskLevel: "R1",
      ...auditFields,
      clientId: client.id,
      metadata: { code: client.code },
    },
  });

  revalidatePath("/clients");
}

export async function updateClientStatusAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const clientId = textValue(formData, "clientId");
  const status = z.enum(["ACTIVE", "DISABLED"]).parse(textValue(formData, "status"));
  assertClientActionAllowed(actor, "editClient", clientId);
  const existing = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, code: true, status: true },
  });

  if (!existing) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  const client = await prisma.client.update({ where: { id: clientId }, data: { status } });
  if (existing.status !== client.status) {
    await prisma.auditLog.create({
      data: {
        action: client.status === "ACTIVE" ? "CLIENT_ENABLED" : "CLIENT_DISABLED",
        objectType: "CLIENT",
        objectId: client.id,
        riskLevel: "R1",
        ...auditFields,
        clientId: client.id,
        metadata: {
          code: client.code,
          fromStatus: existing.status,
          toStatus: client.status,
        },
      },
    });
  }

  revalidatePath("/clients");
}

export async function deleteClientAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const clientId = textValue(formData, "clientId");
  assertClientActionAllowed(actor, "editClient", clientId);
  const client = await prisma.client.findUnique({ where: { id: clientId } });

  if (!client) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  if (client.hasHistoricalPayroll) {
    await prisma.auditLog.create({
      data: {
        action: "CLIENT_DELETE_REJECTED",
        objectType: "CLIENT",
        objectId: client.id,
        riskLevel: "R1",
        ...auditFields,
        clientId: client.id,
        metadata: { reason: "HAS_HISTORICAL_PAYROLL", code: client.code },
      },
    });
    throw new Error("CLIENT_WITH_HISTORY_CANNOT_BE_DELETED");
  }

  await prisma.client.delete({ where: { id: client.id } });
  revalidatePath("/clients");
}

export async function createClientConfigVersionAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = configVersionSchema.parse({
    clientId: textValue(formData, "clientId"),
    effectiveMonth: textValue(formData, "effectiveMonth"),
    payrollDay: textValue(formData, "payrollDay") || undefined,
    templateCode: textValue(formData, "templateCode") || undefined,
    grossUpDefault: formData.get("grossUpDefault") === "on" ? "on" : undefined,
    changeReason: textValue(formData, "changeReason"),
    evidenceRefs: textValue(formData, "evidenceRefs") || undefined,
  });
  assertClientActionAllowed(actor, "editClient", body.clientId);

  const latest = await prisma.clientConfigVersion.findFirst({
    where: { clientId: body.clientId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  const version = await prisma.clientConfigVersion.create({
    data: {
      clientId: body.clientId,
      versionNumber,
      effectiveMonth: body.effectiveMonth,
      payrollDay: body.payrollDay,
      templateCode: body.templateCode,
      grossUpDefault: body.grossUpDefault === "on",
      bpjsConfig: {},
      ruleConfig: {},
      evidenceRefs: splitRefs(body.evidenceRefs ?? ""),
      changeReason: body.changeReason,
      status: "DRAFT",
      createdById: auditFields.actorUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "CLIENT_CONFIG_VERSION_CREATED",
      objectType: "CLIENT_CONFIG_VERSION",
      objectId: version.id,
      riskLevel: "R2",
      ...auditFields,
      clientId: body.clientId,
      metadata: {
        versionNumber,
        effectiveMonth: body.effectiveMonth,
        inputSummary: "生成客户配置待确认版本，不直接生效",
        outputSummary: "DRAFT 版本已创建，等待人工确认后才能生效",
        evidenceRefs: splitRefs(body.evidenceRefs ?? ""),
      },
    },
  });

  revalidatePath("/clients");
}

export async function grantClientAccessAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  if (!actorHasPermission(actor, "users.manage")) {
    throw new Error("ROLE_MISSING_PERMISSION");
  }

  const body = grantClientAccessSchema.parse({
    clientId: textValue(formData, "clientId"),
    userId: textValue(formData, "userId"),
    roleId: textValue(formData, "roleId"),
  });

  const [client, user, role] = await Promise.all([
    prisma.client.findUnique({ where: { id: body.clientId }, select: { id: true, code: true } }),
    prisma.user.findUnique({
      where: { id: body.userId },
      select: { id: true, email: true, status: true },
    }),
    prisma.role.findUnique({ where: { id: body.roleId }, select: { id: true, code: true } }),
  ]);

  if (!client) {
    throw new Error("CLIENT_NOT_FOUND");
  }

  if (!user || user.status !== "ACTIVE") {
    throw new Error("ACTIVE_USER_REQUIRED");
  }

  if (!role) {
    throw new Error("ROLE_NOT_FOUND");
  }

  const access = await prisma.clientAccess.upsert({
    where: {
      userId_clientId_roleId: {
        userId: user.id,
        clientId: client.id,
        roleId: body.roleId,
      },
    },
    create: {
      userId: user.id,
      clientId: client.id,
      roleId: body.roleId,
      status: "ACTIVE",
      grantedById: auditFields.actorUserId,
    },
    update: {
      status: "ACTIVE",
      revokedAt: null,
      grantedById: auditFields.actorUserId,
      grantedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "CLIENT_ACCESS_GRANTED",
      objectType: "CLIENT",
      objectId: client.id,
      riskLevel: "R1",
      ...auditFields,
      clientId: client.id,
      metadata: {
        clientCode: client.code,
        accessId: access.id,
        targetUserId: user.id,
        targetUserEmail: user.email,
        roleCode: role.code,
        inputSummary: "授予用户客户访问范围；不改变用户角色权限",
        outputSummary: "客户授权已启用并写入审计",
      },
    },
  });

  revalidatePath("/clients");
}

export async function revokeClientAccessAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  if (!actorHasPermission(actor, "users.manage")) {
    throw new Error("ROLE_MISSING_PERMISSION");
  }

  const body = revokeClientAccessSchema.parse({
    accessId: textValue(formData, "accessId"),
    clientId: textValue(formData, "clientId"),
  });
  const access = await prisma.clientAccess.findUnique({
    where: { id: body.accessId },
    include: {
      client: { select: { id: true, code: true } },
      user: { select: { id: true, email: true } },
      role: { select: { code: true } },
    },
  });

  if (!access || access.clientId !== body.clientId) {
    throw new Error("CLIENT_ACCESS_NOT_FOUND");
  }

  const revoked = await prisma.clientAccess.update({
    where: { id: access.id },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "CLIENT_ACCESS_REVOKED",
      objectType: "CLIENT",
      objectId: access.client.id,
      riskLevel: "R1",
      ...auditFields,
      clientId: access.client.id,
      metadata: {
        clientCode: access.client.code,
        accessId: revoked.id,
        targetUserId: access.user.id,
        targetUserEmail: access.user.email,
        roleCode: access.role?.code ?? null,
        inputSummary: "撤销用户客户访问范围；不改变用户角色权限",
        outputSummary: "客户授权已撤销并写入审计",
      },
    },
  });

  revalidatePath("/clients");
}
