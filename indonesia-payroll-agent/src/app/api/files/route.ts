import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import {
  EXCEL_SAFETY_LIMITS,
  fileExtension,
  inspectExcelUpload,
  isExcelFileName,
} from "@/domain/excel/excel-safety-policy";
import { parseExcelWorkbookIsolated } from "@/domain/excel/excel-parser-runner";
import {
  buildUploadStorageKey,
  FILE_PURPOSES,
  inputTypeForUploadedFile,
  normalizeUploadFileName,
  sha256Hex,
  sourceChannelForUploadedFile,
} from "@/domain/files/upload-service";
import {
  evidenceCandidateRefForRawInput,
  hashRawInputContent,
  summarizeRawInput,
} from "@/domain/intake/raw-input-redaction";
import { handleApi } from "@/app/api/_utils/errors";
import { resolveFileBinding } from "@/app/api/files/file-upload-binding";
import {
  nextReplacementVersionNumber,
  persistParsedWorkbook,
} from "@/app/api/files/file-upload-persistence";
import { persistBlockedOversizeFileUpload } from "@/app/api/files/file-upload-oversize";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { putObject } from "@/lib/storage/local-file-store";

export const dynamic = "force-dynamic";

const metadataSchema = z.object({
  purpose: z.enum(FILE_PURPOSES).default("OTHER"),
  clientId: z.string().min(1).optional(),
  payrollMonth: z.string().min(7).max(7).optional(),
  runId: z.string().min(1).optional(),
  replacesFileId: z.string().min(1).optional(),
  replacementReason: z.string().max(500).optional(),
});

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("FILE_REQUIRED");
    }

    const metadata = metadataSchema.parse({
      purpose: formText(formData, "purpose"),
      clientId: formText(formData, "clientId"),
      payrollMonth: formText(formData, "payrollMonth"),
      runId: formText(formData, "runId"),
      replacesFileId: formText(formData, "replacesFileId"),
      replacementReason: formText(formData, "replacementReason"),
    });
    const binding = await resolveFileBinding({
      actor,
      clientId: metadata.clientId,
      payrollMonth: metadata.payrollMonth,
      runId: metadata.runId,
    });
    const normalizedFileName = normalizeUploadFileName(file.name);
    const inputType = inputTypeForUploadedFile(normalizedFileName, file.type);
    const sourceChannel = sourceChannelForUploadedFile({
      fileName: normalizedFileName,
      purpose: metadata.purpose,
    });

    if (file.size > EXCEL_SAFETY_LIMITS.maxFileBytes) {
      const created = await persistBlockedOversizeFileUpload({
        fileName: normalizedFileName,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        contentHash: hashRawInputContent(
          `oversize:${normalizedFileName}:${file.size}:${file.type || ""}`,
        ),
        binding,
        purpose: metadata.purpose,
        sourceChannel,
        inputType,
        auditFields,
      });

      return NextResponse.json({ ...created, parsed: null }, { status: 201 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = sha256Hex(buffer);
    const duplicate = await prisma.uploadedFileVersion.findFirst({
      where: {
        sha256,
        clientId: binding.clientId,
        payrollMonth: binding.payrollMonth,
      },
      select: { id: true, fileName: true },
    });
    const isAssigned = Boolean(binding.clientId && binding.payrollMonth);
    const preflightIssues = isExcelFileName(normalizedFileName)
      ? inspectExcelUpload({
          fileName: normalizedFileName,
          mimeType: file.type,
          sizeBytes: buffer.byteLength,
          buffer,
        })
      : [];
    const versionNumber = metadata.replacesFileId
      ? await nextReplacementVersionNumber({
          replacesFileId: metadata.replacesFileId,
          actor,
          binding,
        })
      : 1;

    const created = await prisma.$transaction(async (tx) => {
      const rawInput = await tx.rawInputItem.create({
        data: {
          ...binding,
          sourceChannel,
          inputType,
          status: isAssigned ? "PENDING_EXTRACTION" : "PENDING_ASSIGNMENT",
          redactedSummary: summarizeRawInput(
            `${normalizedFileName} · ${buffer.byteLength} bytes · sha256 ${sha256.slice(0, 12)}`,
          ),
          contentHash: sha256,
          attachmentFileName: normalizedFileName,
          attachmentMimeType: file.type || "application/octet-stream",
          attachmentSizeBytes: buffer.byteLength,
          duplicateGroupHash: duplicate ? sha256 : null,
          duplicateRiskScore: duplicate ? 1 : 0,
          securityFlags: preflightIssues.map((issue) => issue.code),
          createdById: auditFields.actorUserId,
        },
      });
      const storageKey = buildUploadStorageKey({
        rawInputItemId: rawInput.id,
        versionNumber,
        fileName: normalizedFileName,
      });
      const stored = await putObject(storageKey, buffer);
      const fileVersion = await tx.uploadedFileVersion.create({
        data: {
          rawInputItemId: rawInput.id,
          ...binding,
          purpose: metadata.purpose,
          versionNumber,
          fileName: normalizedFileName,
          extension: fileExtension(normalizedFileName),
          mimeType: file.type || "application/octet-stream",
          storageKey: stored.key,
          sha256,
          sizeBytes: buffer.byteLength,
          parseStatus: isExcelFileName(normalizedFileName) ? "PENDING" : "SKIPPED",
          riskFlags: preflightIssues.map((issue) => issue.code),
          replacesFileId: metadata.replacesFileId,
          uploadedById: auditFields.actorUserId,
        },
      });
      await tx.rawInputItem.update({
        where: { id: rawInput.id },
        data: {
          attachmentKey: stored.key,
          evidenceCandidateRefs: [
            evidenceCandidateRefForRawInput(rawInput.id),
            `uploaded-file:${fileVersion.id}`,
          ],
        },
      });

      if (metadata.replacesFileId) {
        await tx.fileReplacement.create({
          data: {
            oldFileId: metadata.replacesFileId,
            newFileId: fileVersion.id,
            reason: metadata.replacementReason ?? "上传新文件版本替代旧版本",
            createdById: auditFields.actorUserId,
          },
        });
      }

      if (!isAssigned) {
        await tx.caseItem.create({
          data: {
            clientId: binding.clientId,
            runId: binding.runId,
            rawInputItemId: rawInput.id,
            fileVersionId: fileVersion.id,
            type: "INTAKE_UNASSIGNED",
            riskLevel: "R1",
            title: "上传文件未完成客户/月度归属",
            detail: "未归属文件只能停留在 intake 队列，不得进入映射、算薪或导出流程。",
          },
        });
      }

      if (duplicate) {
        await tx.caseItem.create({
          data: {
            clientId: binding.clientId,
            runId: binding.runId,
            rawInputItemId: rawInput.id,
            fileVersionId: fileVersion.id,
            type: "DUPLICATE_RISK",
            riskLevel: "R1",
            title: "检测到重复上传文件",
            detail: `与 ${duplicate.fileName} (${duplicate.id}) 的 sha256 相同，保留证据但需要人工判断是否重复处理。`,
            metadata: { duplicateFileVersionId: duplicate.id },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: "RAW_INPUT_CREATED",
          objectType: "RAW_INPUT_ITEM",
          objectId: rawInput.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: binding.clientId,
          runId: binding.runId,
          metadata: {
            inputType,
            sourceChannel,
            fileName: normalizedFileName,
            inputSummary: "上传文件已进入 RawInputItem 队列，不触发生效变更",
          },
        },
      });
      await tx.auditLog.create({
        data: {
          action: "FILE_UPLOADED",
          objectType: "UPLOADED_FILE_VERSION",
          objectId: fileVersion.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: binding.clientId,
          runId: binding.runId,
          metadata: {
            fileName: normalizedFileName,
            purpose: metadata.purpose,
            sizeBytes: buffer.byteLength,
            sha256,
            parseStatus: fileVersion.parseStatus,
          },
        },
      });

      return { rawInput, fileVersion };
    });

    if (!isExcelFileName(normalizedFileName)) {
      return NextResponse.json({ ...created, parsed: null }, { status: 201 });
    }

    const parsed = await parseExcelWorkbookIsolated({
      buffer,
      workbookName: normalizedFileName,
      preflightIssues,
    });
    await persistParsedWorkbook({
      parsed,
      fileVersionId: created.fileVersion.id,
      clientId: binding.clientId,
      runId: binding.runId,
      auditFields,
    });

    return NextResponse.json({ ...created, parsed }, { status: 201 });
  });
}
