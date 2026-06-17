export const EXCEL_SAFETY_LIMITS = {
  maxFileBytes: 50 * 1024 * 1024,
  maxSheets: 50,
  maxTotalCells: 200_000,
  maxPersistedCells: 200_000,
  maxPreviewRowsPerSheet: 5,
  maxRowsPerSheet: 5_000,
  maxParseMs: 5_000,
} as const;

export const EXCEL_EXTENSIONS = [".xlsx", ".xls"] as const;

export type ExcelSafetyIssueCode =
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_EXTENSION"
  | "UNSUPPORTED_MIME_TYPE"
  | "FILE_SIGNATURE_MISMATCH"
  | "SHEET_LIMIT_EXCEEDED"
  | "CELL_LIMIT_EXCEEDED"
  | "WORKBOOK_HAS_NO_SHEETS"
  | "WORKBOOK_HAS_NO_HEADER"
  | "WORKBOOK_PARSE_FAILED"
  | "WORKBOOK_PARSE_TIMEOUT"
  | "FORMULA_PRESENT"
  | "MACRO_PRESENT"
  | "EXTERNAL_LINK_REFERENCE"
  | "INSTRUCTION_LIKE_TEXT";

export type ExcelSafetyIssue = {
  code: ExcelSafetyIssueCode;
  severity: "info" | "warning" | "blocking";
  message: string;
};

const ALLOWED_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

export function inspectExcelUpload(input: {
  fileName: string;
  mimeType?: string | null;
  sizeBytes: number;
  buffer: Buffer;
}): ExcelSafetyIssue[] {
  const issues: ExcelSafetyIssue[] = [];
  const extension = fileExtension(input.fileName);
  const mimeType = input.mimeType?.trim().toLowerCase() ?? "";

  if (input.sizeBytes > EXCEL_SAFETY_LIMITS.maxFileBytes) {
    issues.push({
      code: "FILE_TOO_LARGE",
      severity: "blocking",
      message: "文件超过 50MB 限制，必须人工拆分或重新上传。",
    });
  }

  if (!isExcelExtension(extension)) {
    issues.push({
      code: "UNSUPPORTED_EXTENSION",
      severity: "blocking",
      message: "仅支持 .xlsx 和 .xls 原始 Excel 文件。",
    });
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    issues.push({
      code: "UNSUPPORTED_MIME_TYPE",
      severity: "warning",
      message: "MIME type 不在允许列表内，继续按文件签名校验。",
    });
  }

  if (isExcelExtension(extension) && !hasExpectedExcelSignature(input.buffer, extension)) {
    issues.push({
      code: "FILE_SIGNATURE_MISMATCH",
      severity: "blocking",
      message: "文件签名与扩展名不匹配，按不可信文件阻断。",
    });
  }

  return issues;
}

export function isBlockingSafetyIssue(issue: ExcelSafetyIssue): boolean {
  return issue.severity === "blocking";
}

export function hasBlockingSafetyIssue(issues: ExcelSafetyIssue[]): boolean {
  return issues.some(isBlockingSafetyIssue);
}

export function fileExtension(fileName: string): string {
  const normalized = fileName.trim().toLowerCase();
  const dotIndex = normalized.lastIndexOf(".");

  return dotIndex >= 0 ? normalized.slice(dotIndex) : "";
}

export function isExcelExtension(extension: string): extension is (typeof EXCEL_EXTENSIONS)[number] {
  return EXCEL_EXTENSIONS.includes(extension as (typeof EXCEL_EXTENSIONS)[number]);
}

export function isExcelFileName(fileName: string): boolean {
  return isExcelExtension(fileExtension(fileName));
}

function hasExpectedExcelSignature(buffer: Buffer, extension: string): boolean {
  if (extension === ".xlsx") {
    return (
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]))
    );
  }

  if (extension === ".xls") {
    return buffer
      .subarray(0, 8)
      .equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  }

  return false;
}
