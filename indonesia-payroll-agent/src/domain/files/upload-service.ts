import { createHash } from "node:crypto";
import path from "node:path";
import {
  fileExtension,
  isExcelFileName,
} from "@/domain/excel/excel-safety-policy";
import {
  type RawInputSourceChannel,
  type RawInputType,
} from "@/domain/intake/intake-service";

export const FILE_PURPOSES = [
  "EMPLOYEE_MASTER",
  "MOVEMENT",
  "PAYROLL_INPUT",
  "ATTENDANCE",
  "CONTRACT",
  "CUSTOMER_CONFIRMATION",
  "INTERNAL_NOTE",
  "OTHER",
] as const;

export type FilePurpose = (typeof FILE_PURPOSES)[number];

export function isFilePurpose(value: string): value is FilePurpose {
  return FILE_PURPOSES.includes(value as FilePurpose);
}

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizeUploadFileName(fileName: string): string {
  const baseName = path.basename(fileName).replace(/[^\w.\-()\u4e00-\u9fa5 ]/g, "_").trim();
  return baseName || "upload.bin";
}

export function buildUploadStorageKey(input: {
  rawInputItemId: string;
  versionNumber: number;
  fileName: string;
}): string {
  const safeFileName = normalizeUploadFileName(input.fileName);
  return `intake/${input.rawInputItemId}/v${input.versionNumber}/${safeFileName}`;
}

export function inputTypeForUploadedFile(fileName: string, mimeType?: string | null): RawInputType {
  if (isExcelFileName(fileName)) {
    return "EXCEL";
  }

  const normalizedMime = mimeType?.toLowerCase() ?? "";
  if (normalizedMime.startsWith("image/")) {
    return "IMAGE";
  }

  if (normalizedMime === "application/pdf" || fileExtension(fileName) === ".pdf") {
    return "PDF";
  }

  if (fileExtension(fileName) === ".txt") {
    return "TEXT";
  }

  return "DOCUMENT";
}

export function sourceChannelForUploadedFile(input: {
  fileName: string;
  purpose: FilePurpose;
  fallback?: RawInputSourceChannel;
}): RawInputSourceChannel {
  if (isExcelFileName(input.fileName)) {
    return "CUSTOMER_EXCEL";
  }

  if (input.purpose === "CONTRACT") {
    return "CONTRACT";
  }

  if (input.purpose === "CUSTOMER_CONFIRMATION") {
    return "CUSTOMER_CONFIRMATION";
  }

  if (input.purpose === "INTERNAL_NOTE") {
    return "INTERNAL_NOTE";
  }

  return input.fallback ?? "OTHER";
}
