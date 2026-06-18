"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { assertCriticalFieldEvidence } from "@/domain/employees/employee-service";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { toInputJsonObject } from "@/lib/json/input-json";
import { prisma } from "@/lib/db/prisma";

const createEmployeeSchema = z.object({
  clientId: z.string().min(1),
  employeeCode: z.string().min(1).max(80),
  fullName: z.string().min(1).max(160),
});

const masterVersionSchema = z.object({
  employeeId: z.string().min(1),
  effectiveMonth: z.string().min(7).max(7),
  changeReason: z.string().min(1).max(500),
  changedFieldsJson: z.string().min(2),
  snapshotJson: z.string().min(2),
  evidenceRefs: z.string().optional(),
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

function parseJsonObject(value: string, code: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(code);
    }

    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(code);
  }
}

export async function createEmployeeAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = createEmployeeSchema.parse({
    clientId: textValue(formData, "clientId"),
    employeeCode: textValue(formData, "employeeCode"),
    fullName: textValue(formData, "fullName"),
  });
  assertClientActionAllowed(actor, "editEmployee", body.clientId);

  const employee = await prisma.employee.create({
    data: {
      clientId: body.clientId,
      employeeCode: body.employeeCode,
      fullName: body.fullName,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "EMPLOYEE_CREATED",
      objectType: "EMPLOYEE",
      objectId: employee.id,
      riskLevel: "R1",
      ...auditFields,
      clientId: employee.clientId,
      metadata: { employeeCode: employee.employeeCode },
    },
  });

  revalidatePath("/employees");
}

export async function updateEmployeeStatusAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const employeeId = textValue(formData, "employeeId");
  const status = z.enum(["ACTIVE", "DISABLED"]).parse(textValue(formData, "status"));
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });

  if (!employee) {
    throw new Error("EMPLOYEE_NOT_FOUND");
  }

  assertClientActionAllowed(actor, "editEmployee", employee.clientId);
  const updated = await prisma.employee.update({ where: { id: employeeId }, data: { status } });

  await prisma.auditLog.create({
    data: {
      action: "EMPLOYEE_STATUS_UPDATED",
      objectType: "EMPLOYEE",
      objectId: updated.id,
      riskLevel: "R1",
      ...auditFields,
      clientId: updated.clientId,
      metadata: {
        employeeCode: updated.employeeCode,
        fromStatus: employee.status,
        toStatus: updated.status,
        inputSummary: "员工启用/停用状态更新；离职不允许走此入口",
        outputSummary: "当前员工状态已更新并写入审计",
      },
    },
  });

  revalidatePath("/employees");
}

export async function deleteEmployeeAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const employeeId = textValue(formData, "employeeId");
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });

  if (!employee) {
    throw new Error("EMPLOYEE_NOT_FOUND");
  }

  assertClientActionAllowed(actor, "editEmployee", employee.clientId);
  if (employee.hasHistoricalPayroll) {
    await prisma.auditLog.create({
      data: {
        action: "EMPLOYEE_DELETE_REJECTED",
        objectType: "EMPLOYEE",
        objectId: employee.id,
        riskLevel: "R1",
        ...auditFields,
        clientId: employee.clientId,
        metadata: { reason: "HAS_HISTORICAL_PAYROLL", employeeCode: employee.employeeCode },
      },
    });
    throw new Error("EMPLOYEE_WITH_HISTORY_CANNOT_BE_DELETED");
  }

  await prisma.employee.delete({ where: { id: employee.id } });
  revalidatePath("/employees");
}

export async function createEmployeeMasterVersionAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = masterVersionSchema.parse({
    employeeId: textValue(formData, "employeeId"),
    effectiveMonth: textValue(formData, "effectiveMonth"),
    changeReason: textValue(formData, "changeReason"),
    changedFieldsJson: textValue(formData, "changedFieldsJson"),
    snapshotJson: textValue(formData, "snapshotJson"),
    evidenceRefs: textValue(formData, "evidenceRefs") || undefined,
  });
  const employee = await prisma.employee.findUnique({ where: { id: body.employeeId } });

  if (!employee) {
    throw new Error("EMPLOYEE_NOT_FOUND");
  }

  assertClientActionAllowed(actor, "editEmployee", employee.clientId);
  const changedFields = parseJsonObject(body.changedFieldsJson, "CHANGED_FIELDS_JSON_INVALID");
  const snapshot = parseJsonObject(body.snapshotJson, "SNAPSHOT_JSON_INVALID");
  const changedFieldsJson = toInputJsonObject(changedFields);
  const snapshotJson = toInputJsonObject(snapshot);
  const evidenceRefs = splitRefs(body.evidenceRefs ?? "");
  assertCriticalFieldEvidence(changedFields, evidenceRefs);

  const latest = await prisma.employeeMasterVersion.findFirst({
    where: { employeeId: employee.id },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const versionNumber = (latest?.versionNumber ?? 0) + 1;

  const version = await prisma.employeeMasterVersion.create({
    data: {
      employeeId: employee.id,
      versionNumber,
      effectiveMonth: body.effectiveMonth,
      changedFields: changedFieldsJson,
      snapshot: snapshotJson,
      evidenceRefs,
      changeReason: body.changeReason,
      status: "DRAFT",
      createdById: auditFields.actorUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "EMPLOYEE_MASTER_VERSION_CREATED",
      objectType: "EMPLOYEE_MASTER_VERSION",
      objectId: version.id,
      riskLevel: "R2",
      ...auditFields,
      clientId: employee.clientId,
      metadata: {
        employeeCode: employee.employeeCode,
        versionNumber,
        effectiveMonth: body.effectiveMonth,
        inputSummary: "生成员工主档待确认版本，不写入当前员工主档",
        outputSummary: "DRAFT 版本已创建，等待人工确认后才能生效",
        evidenceRefs,
      },
    },
  });

  revalidatePath("/employees");
}
