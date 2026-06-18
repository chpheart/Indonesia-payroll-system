"use server";

import { z } from "zod";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  SENSITIVE_EMPLOYEE_FIELDS,
  type SensitiveEmployeeField,
} from "@/domain/employees/employee-service";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

const sensitiveAccessSchema = z.object({
  employeeId: z.string().min(1),
  field: z.enum(SENSITIVE_EMPLOYEE_FIELDS),
  purpose: z.string().min(8).max(500),
  confirmed: z.literal("on"),
});

export type RevealSensitiveFieldState = {
  error?: string;
  field?: SensitiveEmployeeField;
  value?: string | null;
  purpose?: string;
};

export type CopySensitiveFieldState = {
  error?: string;
  copied?: boolean;
  field?: SensitiveEmployeeField;
};

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function revealSensitiveFieldAction(
  _previousState: RevealSensitiveFieldState,
  formData: FormData,
): Promise<RevealSensitiveFieldState> {
  try {
    const { actor, auditFields } = await currentRequestContext();
    const body = sensitiveAccessSchema.parse({
      employeeId: textValue(formData, "employeeId"),
      field: textValue(formData, "field"),
      purpose: textValue(formData, "purpose"),
      confirmed: formData.get("confirmed"),
    });
    const employee = await prisma.employee.findUnique({ where: { id: body.employeeId } });

    if (!employee) {
      return { error: "EMPLOYEE_NOT_FOUND" };
    }

    assertClientActionAllowed(actor, "viewSensitive", employee.clientId);
    const value = employee[body.field] ?? null;

    await prisma.auditLog.create({
      data: {
        action: "SENSITIVE_FIELD_REVEALED",
        objectType: "SENSITIVE_FIELD",
        objectId: `${employee.id}:${body.field}`,
        riskLevel: "R1",
        ...auditFields,
        clientId: employee.clientId,
        purpose: body.purpose,
        metadata: {
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          field: body.field,
          inputSummary: "页面级二次确认后查看员工敏感字段明文",
          outputSummary: value ? "返回单个字段明文给当前会话" : "字段为空",
          evidenceRefs: [],
        },
      },
    });

    return { field: body.field, value, purpose: body.purpose };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "SENSITIVE_REVEAL_FAILED" };
  }
}

export async function copySensitiveFieldAction(
  _previousState: CopySensitiveFieldState,
  formData: FormData,
): Promise<CopySensitiveFieldState> {
  try {
    const { actor, auditFields } = await currentRequestContext();
    const body = sensitiveAccessSchema.parse({
      employeeId: textValue(formData, "employeeId"),
      field: textValue(formData, "field"),
      purpose: textValue(formData, "purpose"),
      confirmed: formData.get("confirmed"),
    });
    const employee = await prisma.employee.findUnique({ where: { id: body.employeeId } });

    if (!employee) {
      return { error: "EMPLOYEE_NOT_FOUND" };
    }

    assertClientActionAllowed(actor, "viewSensitive", employee.clientId);
    await prisma.auditLog.create({
      data: {
        action: "SENSITIVE_FIELD_COPIED",
        objectType: "SENSITIVE_FIELD",
        objectId: `${employee.id}:${body.field}`,
        riskLevel: "R1",
        ...auditFields,
        clientId: employee.clientId,
        purpose: body.purpose,
        metadata: {
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          field: body.field,
          inputSummary: "用户点击受控复制按钮复制员工敏感字段",
          outputSummary: "复制动作已写入审计，明文只进入当前浏览器剪贴板",
          evidenceRefs: [],
        },
      },
    });

    return { copied: true, field: body.field };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "SENSITIVE_COPY_FAILED" };
  }
}
