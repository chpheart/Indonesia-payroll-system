"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  RAW_INPUT_SOURCE_CHANNELS,
  RAW_INPUT_TYPES,
} from "@/domain/intake/intake-service";
import {
  detectInstructionLikeContent,
  evidenceCandidateRefForRawInput,
  hashRawInputContent,
  summarizeRawInput,
} from "@/domain/intake/raw-input-redaction";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

const createTextRawInputSchema = z.object({
  sourceChannel: z.enum(RAW_INPUT_SOURCE_CHANNELS),
  inputType: z.enum(RAW_INPUT_TYPES),
  originalText: z.string().min(1).max(100_000),
  clientId: z.string().optional(),
  payrollMonth: z.string().optional(),
  runId: z.string().optional(),
});

function textValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalTextValue(formData: FormData, key: string) {
  return textValue(formData, key) || undefined;
}

export async function createTextRawInputAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const body = createTextRawInputSchema.parse({
    sourceChannel: textValue(formData, "sourceChannel"),
    inputType: textValue(formData, "inputType"),
    originalText: textValue(formData, "originalText"),
    clientId: optionalTextValue(formData, "clientId"),
    payrollMonth: optionalTextValue(formData, "payrollMonth"),
    runId: optionalTextValue(formData, "runId"),
  });
  const run = body.runId
    ? await prisma.payrollRun.findUnique({
        where: { id: body.runId },
        select: { id: true, clientId: true, payrollMonth: true },
      })
    : null;

  if (body.runId && !run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }

  const clientId = run?.clientId ?? body.clientId ?? null;
  const payrollMonth = run?.payrollMonth ?? body.payrollMonth ?? null;
  if (clientId) {
    assertClientActionAllowed(actor, "updatePayrollRun", clientId);
  }

  const originalText = body.originalText.trim();
  const contentHash = hashRawInputContent(originalText);
  const duplicate = await prisma.rawInputItem.findFirst({
    where: { contentHash, clientId, payrollMonth },
    select: { id: true, contentHash: true },
  });
  const securityFlags = detectInstructionLikeContent(originalText);
  const isAssigned = Boolean(clientId && payrollMonth);

  const rawInput = await prisma.$transaction(async (tx) => {
    const created = await tx.rawInputItem.create({
      data: {
        clientId,
        payrollMonth,
        runId: run?.id ?? null,
        sourceChannel: body.sourceChannel,
        inputType: body.inputType,
        status: isAssigned ? "PENDING_EXTRACTION" : "PENDING_ASSIGNMENT",
        originalText,
        redactedSummary: summarizeRawInput(originalText),
        contentHash,
        duplicateGroupHash: duplicate?.contentHash ?? null,
        duplicateRiskScore: duplicate ? 1 : 0,
        securityFlags,
        createdById: auditFields.actorUserId,
      },
    });
    const updated = await tx.rawInputItem.update({
      where: { id: created.id },
      data: { evidenceCandidateRefs: [evidenceCandidateRefForRawInput(created.id)] },
    });

    if (!isAssigned) {
      await tx.caseItem.create({
        data: {
          clientId,
          runId: run?.id ?? null,
          rawInputItemId: created.id,
          type: "INTAKE_UNASSIGNED",
          riskLevel: "R1",
          title: "原始输入未完成客户/月度归属",
          detail: "未归属输入不得进入 ChangeProposal、映射、算薪或导出流程。",
        },
      });
    }

    if (duplicate) {
      await tx.caseItem.create({
        data: {
          clientId,
          runId: run?.id ?? null,
          rawInputItemId: created.id,
          type: "DUPLICATE_RISK",
          riskLevel: "R1",
          title: "检测到重复原始输入",
          detail: `与 ${duplicate.id} 的内容 hash 相同，保留证据但需要人工确认是否重复处理。`,
          metadata: { duplicateRawInputItemId: duplicate.id },
        },
      });
    }

    if (securityFlags.length > 0) {
      await tx.caseItem.create({
        data: {
          clientId,
          runId: run?.id ?? null,
          rawInputItemId: created.id,
          type: "SECURITY_REVIEW",
          riskLevel: "R2",
          title: "原始输入包含疑似指令类内容",
          detail: "客户文本只能作为数据处理，不得改变系统规则、权限或工具调用边界。",
          metadata: { securityFlags },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        action: "RAW_INPUT_CREATED",
        objectType: "RAW_INPUT_ITEM",
        objectId: created.id,
        riskLevel: "R1",
        ...auditFields,
        clientId,
        runId: run?.id ?? null,
        metadata: {
          inputType: body.inputType,
          sourceChannel: body.sourceChannel,
          status: updated.status,
          securityFlags,
          duplicateRiskScore: updated.duplicateRiskScore,
          inputSummary: "保存原始输入为不可信 evidence 候选，不触发生效变更",
        },
      },
    });

    return updated;
  });

  revalidatePath("/intake");
  if (rawInput.runId) {
    revalidatePath(`/payroll-runs/${rawInput.runId}`);
    revalidatePath(`/payroll-runs/${rawInput.runId}/intake`);
  }
}
