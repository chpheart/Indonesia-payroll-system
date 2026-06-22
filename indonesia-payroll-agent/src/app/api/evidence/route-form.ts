import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { EVIDENCE_KINDS, EVIDENCE_LINK_OBJECT_TYPES } from "@/domain/evidence/evidence-service";
import { normalizeUploadFileName, sha256Hex } from "@/domain/files/upload-service";
import { RAW_INPUT_SOURCE_CHANNELS } from "@/domain/intake/intake-types";
import { putObject } from "@/lib/storage/local-file-store";

const evidenceLinkSchema = z.object({
  clientId: z.string().min(1),
  runId: z.string().min(1).optional(),
  objectType: z.enum(EVIDENCE_LINK_OBJECT_TYPES),
  objectId: z.string().min(1),
  objectLabel: z.string().max(200).optional(),
  targetField: z.string().max(120).optional(),
  coverageScope: z.record(z.string(), z.unknown()).default({ type: "MIXED" }),
});

const evidenceJsonSchema = z.object({
  clientId: z.string().min(1),
  runId: z.string().min(1).optional(),
  rawInputItemId: z.string().min(1).optional(),
  fileVersionId: z.string().min(1).optional(),
  kind: z.enum(EVIDENCE_KINDS),
  sourceChannel: z.enum(RAW_INPUT_SOURCE_CHANNELS).optional(),
  redactedSummary: z.string().max(500).optional(),
  contentText: z.string().max(20_000).optional(),
  attachmentKey: z.string().max(500).optional(),
  attachmentFileName: z.string().max(255).optional(),
  attachmentMimeType: z.string().max(120).optional(),
  attachmentSizeBytes: z.number().int().nonnegative().optional(),
  contentHash: z.string().max(128).optional(),
  applicableMonth: z.string().min(7).max(7).optional(),
  sourceLabel: z.string().min(1).max(200),
  coverageScope: z.record(z.string(), z.unknown()).default({ type: "MIXED" }),
  notes: z.string().max(2000).optional(),
  links: z.array(evidenceLinkSchema).min(1),
});

export type EvidenceRequestBody = z.infer<typeof evidenceJsonSchema>;

export async function evidenceFromRequest(request: NextRequest): Promise<EvidenceRequestBody> {
  return request.headers.get("content-type")?.includes("multipart/form-data")
    ? evidenceJsonSchema.parse(await evidenceFromFormData(await request.formData()))
    : evidenceJsonSchema.parse(await request.json());
}

async function evidenceFromFormData(formData: FormData) {
  const file = formData.get("file");
  const contentText = formText(formData, "contentText");
  let attachment:
    | {
        attachmentKey: string;
        attachmentFileName: string;
        attachmentMimeType: string;
        attachmentSizeBytes: number;
        contentHash: string;
      }
    | undefined;

  if (file instanceof File && file.size > 0) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = normalizeUploadFileName(file.name);
    const contentHash = sha256Hex(buffer);
    const attachmentKey = `evidence/${randomUUID()}/${fileName}`;
    await putObject(attachmentKey, buffer);
    attachment = {
      attachmentKey,
      attachmentFileName: fileName,
      attachmentMimeType: file.type || "application/octet-stream",
      attachmentSizeBytes: buffer.byteLength,
      contentHash,
    };
  }

  const coverageScope = parseJsonField(formText(formData, "coverageScope")) ?? {
    type: formText(formData, "coverageScopeType") ?? "MIXED",
    runId: formText(formData, "runId"),
    employeeIds: splitField(formText(formData, "employeeIds")),
    fields: splitField(formText(formData, "fields")),
    clientScopeKeys: splitField(formText(formData, "clientScopeKeys")),
    fileVersionIds: splitField(formText(formData, "fileVersionIds")),
    sourceObjectRefs: splitField(formText(formData, "sourceObjectRefs")),
  };
  const linkCoverage = parseJsonField(formText(formData, "linkCoverageScope")) ?? coverageScope;
  const objectType = formText(formData, "objectType");
  const objectId = formText(formData, "objectId");
  const kind = formText(formData, "kind") ?? (attachment ? "CUSTOMER_FILE" : "WECHAT_TEXT");
  const sourceChannel = formText(formData, "sourceChannel") ?? (attachment ? "CUSTOMER_CONFIRMATION" : "WECHAT_TEXT");

  return {
    clientId: formText(formData, "clientId"),
    runId: formText(formData, "runId"),
    rawInputItemId: formText(formData, "rawInputItemId"),
    fileVersionId: formText(formData, "fileVersionId"),
    kind,
    sourceChannel,
    redactedSummary: formText(formData, "redactedSummary"),
    contentText,
    applicableMonth: formText(formData, "applicableMonth"),
    sourceLabel: formText(formData, "sourceLabel") ?? "客户证据",
    coverageScope,
    notes: formText(formData, "notes"),
    ...attachment,
    links: [
      {
        clientId: formText(formData, "clientId"),
        runId: formText(formData, "runId"),
        objectType: objectType ?? "PAYROLL_RUN",
        objectId: objectId ?? formText(formData, "runId"),
        objectLabel: formText(formData, "objectLabel"),
        targetField: formText(formData, "targetField"),
        coverageScope: linkCoverage,
      },
    ],
  };
}

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseJsonField(value?: string) {
  return value ? JSON.parse(value) as Record<string, unknown> : undefined;
}

function splitField(value?: string) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}
