"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { normalizeCurrencyCode } from "@/domain/fx/fx-rate-service";
import { assertPayrollMonth } from "@/domain/payroll-runs/run-service";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonArray } from "@/lib/json/input-json";

const employeeOverrideSchema = z.object({
  employeeId: z.string().min(1),
  rate: z.coerce.number().positive(),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1).max(500),
});

const fxSchema = z.object({
  clientId: z.string().min(1),
  payrollMonth: z.string().min(7).max(7),
  currencyCode: z.string().min(3).max(3),
  rate: z.coerce.number().positive(),
  evidenceRefs: z.string().min(1),
  sourceLabel: z.string().min(1).max(200),
  changeReason: z.string().min(1).max(1000),
  employeeOverrides: z.array(employeeOverrideSchema),
});

const confirmSchema = z.object({
  fxRateVersionId: z.string().min(1),
  confirmationText: z.string().min(1),
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

function parseOverrides(value: string) {
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return z.array(employeeOverrideSchema).parse(parsed);
}

function assertStoredOverridesHaveEvidence(value: unknown) {
  const overrides = z.array(employeeOverrideSchema).parse(value);
  for (const override of overrides) {
    if (override.evidenceRefs.length === 0) {
      throw new Error("FX_RATE_EMPLOYEE_OVERRIDE_EVIDENCE_REQUIRED");
    }
  }
}

export async function createFXRateDraftAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = fxSchema.parse({
    clientId: textValue(formData, "clientId"),
    payrollMonth: textValue(formData, "payrollMonth"),
    currencyCode: textValue(formData, "currencyCode"),
    rate: textValue(formData, "rate"),
    evidenceRefs: textValue(formData, "evidenceRefs"),
    sourceLabel: textValue(formData, "sourceLabel"),
    changeReason: textValue(formData, "changeReason"),
    employeeOverrides: parseOverrides(textValue(formData, "employeeOverridesJson")),
  });
  assertClientActionAllowed(actor, "configureRules", body.clientId);
  assertPayrollMonth(body.payrollMonth);
  const currencyCode = normalizeCurrencyCode(body.currencyCode);
  const latest = await prisma.fXRateVersion.findFirst({
    where: { clientId: body.clientId, payrollMonth: body.payrollMonth, currencyCode },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  const fxRate = await prisma.fXRateVersion.create({
    data: {
      clientId: body.clientId,
      payrollMonth: body.payrollMonth,
      currencyCode,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      rate: body.rate,
      employeeOverrides: toInputJsonArray(body.employeeOverrides),
      evidenceRefs: splitRefs(body.evidenceRefs),
      sourceLabel: body.sourceLabel,
      changeReason: body.changeReason,
      createdById: auditFields.actorUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      action: "FX_RATE_VERSION_CREATED",
      objectType: "FX_RATE_VERSION",
      objectId: fxRate.id,
      riskLevel: "R2",
      ...auditFields,
      clientId: fxRate.clientId,
      metadata: {
        payrollMonth: fxRate.payrollMonth,
        currencyCode: fxRate.currencyCode,
        versionNumber: fxRate.versionNumber,
        inputSummary: "创建汇率草稿版本，不进入正式算薪",
        outputSummary: "待确认汇率版本已保存，未确认前预检查阻断",
      },
    },
  });

  revalidatePath("/rules");
}

export async function confirmFXRateAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = confirmSchema.parse({
    fxRateVersionId: textValue(formData, "fxRateVersionId"),
    confirmationText: textValue(formData, "confirmationText"),
  });
  const fxRate = await prisma.fXRateVersion.findUnique({ where: { id: body.fxRateVersionId } });
  if (!fxRate) {
    throw new Error("FX_RATE_VERSION_NOT_FOUND");
  }
  if (body.confirmationText !== "CONFIRM_FX") {
    throw new Error("FX_RATE_CONFIRMATION_REQUIRED");
  }
  assertClientActionAllowed(actor, "approveRules", fxRate.clientId);
  if (fxRate.status === "CONFIRMED") {
    return;
  }
  if (fxRate.evidenceRefs.length === 0) {
    throw new Error("FX_RATE_EVIDENCE_REQUIRED");
  }
  assertStoredOverridesHaveEvidence(fxRate.employeeOverrides);

  await prisma.$transaction([
    prisma.fXRateVersion.update({
      where: { id: fxRate.id },
      data: {
        status: "CONFIRMED",
        confirmedById: auditFields.actorUserId,
        confirmedAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        action: "FX_RATE_VERSION_CONFIRMED",
        objectType: "FX_RATE_VERSION",
        objectId: fxRate.id,
        riskLevel: "R2",
        ...auditFields,
        clientId: fxRate.clientId,
        metadata: {
          payrollMonth: fxRate.payrollMonth,
          currencyCode: fxRate.currencyCode,
          versionNumber: fxRate.versionNumber,
          outputSummary: "汇率已确认，可被预检查和算薪快照引用",
        },
      },
    }),
  ]);

  revalidatePath("/rules");
}
