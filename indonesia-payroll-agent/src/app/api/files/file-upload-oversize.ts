import { fileExtension } from "@/domain/excel/excel-safety-policy";
import { type FilePurpose } from "@/domain/files/upload-service";
import { evidenceCandidateRefForRawInput, summarizeRawInput } from "@/domain/intake/raw-input-redaction";
import {
  type RawInputSourceChannel,
  type RawInputType,
} from "@/domain/intake/intake-service";
import { type requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export async function persistBlockedOversizeFileUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  binding: { clientId: string | null; payrollMonth: string | null; runId: string | null };
  purpose: FilePurpose;
  sourceChannel: RawInputSourceChannel;
  inputType: RawInputType;
  auditFields: Awaited<ReturnType<typeof requestAuditFields>>;
}) {
  const isAssigned = Boolean(input.binding.clientId && input.binding.payrollMonth);

  return prisma.$transaction(async (tx) => {
    const rawInput = await tx.rawInputItem.create({
      data: {
        ...input.binding,
        sourceChannel: input.sourceChannel,
        inputType: input.inputType,
        status: isAssigned ? "PENDING_EXTRACTION" : "PENDING_ASSIGNMENT",
        redactedSummary: summarizeRawInput(
          `${input.fileName} · ${input.sizeBytes} bytes · FILE_TOO_LARGE`,
        ),
        contentHash: input.contentHash,
        attachmentFileName: input.fileName,
        attachmentMimeType: input.mimeType,
        attachmentSizeBytes: input.sizeBytes,
        securityFlags: ["FILE_TOO_LARGE"],
        createdById: input.auditFields.actorUserId,
      },
    });
    const fileVersion = await tx.uploadedFileVersion.create({
      data: {
        rawInputItemId: rawInput.id,
        ...input.binding,
        purpose: input.purpose,
        versionNumber: 1,
        fileName: input.fileName,
        extension: fileExtension(input.fileName),
        mimeType: input.mimeType,
        storageKey: `blocked/oversize/${rawInput.id}/${input.fileName}`,
        sha256: input.contentHash,
        sizeBytes: input.sizeBytes,
        parseStatus: "BLOCKED",
        parseErrorCode: "FILE_TOO_LARGE",
        parseErrorMessage: "文件超过 50MB 限制，未读取入内存，需人工拆分后重新上传。",
        riskFlags: ["FILE_TOO_LARGE"],
        uploadedById: input.auditFields.actorUserId,
      },
    });
    await tx.rawInputItem.update({
      where: { id: rawInput.id },
      data: {
        evidenceCandidateRefs: [
          evidenceCandidateRefForRawInput(rawInput.id),
          `uploaded-file:${fileVersion.id}`,
        ],
      },
    });
    await tx.caseItem.create({
      data: {
        clientId: input.binding.clientId,
        runId: input.binding.runId,
        rawInputItemId: rawInput.id,
        fileVersionId: fileVersion.id,
        type: "FILE_PARSE_BLOCKER",
        riskLevel: "R2",
        title: "上传文件超过大小限制",
        detail: "文件超过 50MB 限制，系统未读取文件内容；请拆分后重新上传。",
        metadata: { code: "FILE_TOO_LARGE", sizeBytes: input.sizeBytes },
      },
    });

    if (input.binding.runId) {
      await tx.payrollRun.update({
        where: { id: input.binding.runId },
        data: { blockingIssueCount: { increment: 1 } },
      });
    }

    await tx.auditLog.createMany({
      data: [
        {
          action: "RAW_INPUT_CREATED",
          objectType: "RAW_INPUT_ITEM",
          objectId: rawInput.id,
          riskLevel: "R1",
          ...input.auditFields,
          clientId: input.binding.clientId,
          runId: input.binding.runId,
          metadata: {
            inputType: input.inputType,
            sourceChannel: input.sourceChannel,
            status: rawInput.status,
            inputSummary: "超限文件已进入 RawInputItem 队列，但未读取内容",
          },
        },
        {
          action: "FILE_PARSE_BLOCKED",
          objectType: "UPLOADED_FILE_VERSION",
          objectId: fileVersion.id,
          riskLevel: "R2",
          ...input.auditFields,
          clientId: input.binding.clientId,
          runId: input.binding.runId,
          metadata: {
            fileName: input.fileName,
            purpose: input.purpose,
            sizeBytes: input.sizeBytes,
            status: "BLOCKED",
            code: "FILE_TOO_LARGE",
          },
        },
      ],
    });

    return { rawInput, fileVersion };
  });
}
