"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { currentRequestContext } from "@/app/(app)/server-actor";
import { textValue } from "@/app/(app)/payroll-runs/[runId]/phase8-form-utils";
import { assertEvidenceCreateScope } from "@/app/api/evidence/route-guards";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { parseCoverageScopeJson } from "@/domain/confirmation-packs/pack-coverage-service";
import {
  assertEvidenceHasContent,
  isEvidenceKind,
  isEvidenceLinkObjectType,
} from "@/domain/evidence/evidence-service";
import { RAW_INPUT_SOURCE_CHANNELS, type RawInputSourceChannel } from "@/domain/intake/intake-types";
import { hashRawInputContent, summarizeRawInput } from "@/domain/intake/raw-input-redaction";
import { normalizeUploadFileName, sha256Hex } from "@/domain/files/upload-service";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject } from "@/lib/json/input-json";
import { putObject } from "@/lib/storage/local-file-store";

export async function createEvidenceAction(formData: FormData) {
  const { actor, auditFields } = await currentRequestContext();
  const runId = textValue(formData, "runId");
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, clientId: true, payrollMonth: true, status: true, lockedAt: true },
  });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  if (["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(run.status) || run.lockedAt) {
    throw new Error("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
  }
  assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);

  const contentText = textValue(formData, "contentText");
  const file = formData.get("file");
  const attachment = file instanceof File && file.size > 0 ? await storeEvidenceFile(file) : null;
  const coverageScope = coverageScopeFromForm(formData, run.id);
  const objectTypeValue = textValue(formData, "objectType") || "PAYROLL_RUN";
  if (!isEvidenceLinkObjectType(objectTypeValue)) {
    throw new Error("EVIDENCE_LINK_OBJECT_TYPE_INVALID");
  }
  const objectType = objectTypeValue;
  const objectId = textValue(formData, "objectId") || run.id;
  const sourceLabel = textValue(formData, "sourceLabel") || "客户证据";
  const kindValue = textValue(formData, "kind") || (attachment ? "CUSTOMER_FILE" : "WECHAT_TEXT");
  if (!isEvidenceKind(kindValue)) {
    throw new Error("EVIDENCE_KIND_INVALID");
  }
  const kind = kindValue;
  const sourceChannelValue = textValue(formData, "sourceChannel") || (attachment ? "CUSTOMER_CONFIRMATION" : "WECHAT_TEXT");
  if (!isRawInputSourceChannel(sourceChannelValue)) {
    throw new Error("EVIDENCE_SOURCE_CHANNEL_INVALID");
  }
  const sourceChannel = sourceChannelValue;
  const contentHash = attachment?.contentHash ?? (contentText ? hashRawInputContent(contentText) : undefined);

  assertEvidenceHasContent({
    contentText,
    attachmentKey: attachment?.attachmentKey,
    rawInputItemId: textValue(formData, "rawInputItemId"),
    fileVersionId: textValue(formData, "fileVersionId"),
  });
  const linkDraft = {
    clientId: run.clientId,
    runId: run.id,
    objectType,
    objectId,
    coverageScope,
  };
  await assertEvidenceCreateScope({
    db: prisma,
    clientId: run.clientId,
    runId: run.id,
    rawInputItemId: textValue(formData, "rawInputItemId"),
    fileVersionId: textValue(formData, "fileVersionId"),
    coverageScope,
    links: [linkDraft],
  });

  await prisma.$transaction(async (tx) => {
    const evidence = await tx.evidence.create({
      data: {
        clientId: run.clientId,
        runId: run.id,
        rawInputItemId: textValue(formData, "rawInputItemId") || undefined,
        fileVersionId: textValue(formData, "fileVersionId") || undefined,
        kind,
        sourceChannel,
        redactedSummary: textValue(formData, "redactedSummary") || summarizeRawInput(contentText || attachment?.attachmentFileName || sourceLabel),
        contentText: contentText || undefined,
        attachmentKey: attachment?.attachmentKey,
        attachmentFileName: attachment?.attachmentFileName,
        attachmentMimeType: attachment?.attachmentMimeType,
        attachmentSizeBytes: attachment?.attachmentSizeBytes,
        contentHash,
        applicableMonth: run.payrollMonth,
        sourceLabel,
        coverageScopeType: coverageScope.type,
        coverageScope: toInputJsonObject(coverageScope),
        notes: textValue(formData, "notes") || undefined,
        uploadedById: auditFields.actorUserId,
      },
    });
    const link = await tx.evidenceLink.create({
      data: {
        evidenceId: evidence.id,
        clientId: run.clientId,
        runId: run.id,
        objectType,
        objectId,
        objectLabel: textValue(formData, "objectLabel") || undefined,
        targetField: textValue(formData, "targetField") || undefined,
        coverageScopeType: coverageScope.type,
        coverageScope: toInputJsonObject(coverageScope),
        linkedById: auditFields.actorUserId,
      },
    });
    await tx.auditLog.createMany({
      data: [
        {
          action: "EVIDENCE_CREATED",
          objectType: "EVIDENCE",
          objectId: evidence.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: run.clientId,
          runId: run.id,
          metadata: {
            kind: evidence.kind,
            sourceLabel: evidence.sourceLabel,
            inputSummary: "证据已保存；不会自动改写工资结果",
          },
        },
        {
          action: "EVIDENCE_LINKED",
          objectType: "EVIDENCE_LINK",
          objectId: link.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: run.clientId,
          runId: run.id,
          metadata: {
            evidenceId: evidence.id,
            objectType: linkDraft.objectType,
            objectId: linkDraft.objectId,
            targetField: link.targetField ?? "",
          },
        },
      ],
    });
  });

  revalidatePath(`/payroll-runs/${run.id}/evidence`);
  revalidatePath(`/payroll-runs/${run.id}/customer-confirmation`);
}

function coverageScopeFromForm(formData: FormData, runId: string) {
  const raw = textValue(formData, "coverageScope");
  if (raw) {
    return parseCoverageScopeJson(JSON.parse(raw) as Record<string, unknown>);
  }

  return parseCoverageScopeJson({
    type: textValue(formData, "coverageScopeType") || "MIXED",
    runId,
    employeeIds: splitField(textValue(formData, "employeeIds")),
    fields: splitField(textValue(formData, "fields")),
    clientScopeKeys: splitField(textValue(formData, "clientScopeKeys")),
    fileVersionIds: splitField(textValue(formData, "fileVersionIds")),
    sourceObjectRefs: splitField(textValue(formData, "sourceObjectRefs")),
    note: textValue(formData, "coverageNote"),
  });
}

async function storeEvidenceFile(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileName = normalizeUploadFileName(file.name);
  const contentHash = sha256Hex(buffer);
  const attachmentKey = `evidence/${randomUUID()}/${fileName}`;
  await putObject(attachmentKey, buffer);

  return {
    attachmentKey,
    attachmentFileName: fileName,
    attachmentMimeType: file.type || "application/octet-stream",
    attachmentSizeBytes: buffer.byteLength,
    contentHash,
  };
}

function splitField(value?: string) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function isRawInputSourceChannel(value: string): value is RawInputSourceChannel {
  return RAW_INPUT_SOURCE_CHANNELS.includes(value as RawInputSourceChannel);
}
