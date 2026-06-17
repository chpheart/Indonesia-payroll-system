import * as XLSX from "xlsx";
import {
  cellsFromSheet,
  emptyParsedSheet,
  findHeaderRowIndex,
  rowValues,
  sampleRowsAfterHeader,
} from "@/domain/excel/excel-cell-utils";
import {
  EXCEL_SAFETY_LIMITS,
  type ExcelSafetyIssue,
} from "@/domain/excel/excel-safety-policy";
import {
  type ParsedWorkbook,
  type ParsedWorkbookCell,
  type ParsedWorkbookSheet,
} from "@/domain/excel/excel-parser-types";
import { detectInstructionLikeContent } from "@/domain/intake/raw-input-redaction";

export const EXCEL_PARSER_VERSION = "xlsx@0.18.5-phase4-readonly";
export type { ParsedWorkbook, ParsedWorkbookCell, ParsedWorkbookSheet };

export function parseExcelWorkbook(input: {
  buffer: Buffer;
  workbookName?: string;
  preflightIssues?: ExcelSafetyIssue[];
}): ParsedWorkbook {
  const preflightIssues = input.preflightIssues ?? [];
  if (preflightIssues.some((issue) => issue.severity === "blocking")) {
    return blockedWorkbook(input.workbookName, preflightIssues);
  }

  try {
    const parseStartedAt = Date.now();
    const workbook = XLSX.read(input.buffer, {
      type: "buffer",
      cellFormula: true,
      cellNF: true,
      cellText: true,
      bookVBA: true,
      sheetRows: EXCEL_SAFETY_LIMITS.maxRowsPerSheet,
      WTF: false,
    });
    const parseDurationMs = Date.now() - parseStartedAt;

    const issues = [...preflightIssues];
    const dangerousContentFlags = new Set<string>();
    const sheetNames = workbook.SheetNames;
    if (sheetNames.length === 0) {
      issues.push({
        code: "WORKBOOK_HAS_NO_SHEETS",
        severity: "blocking",
        message: "workbook 没有 sheet，不能进入后续映射或算薪流程。",
      });
    }

    if (sheetNames.length > EXCEL_SAFETY_LIMITS.maxSheets) {
      issues.push({
        code: "SHEET_LIMIT_EXCEEDED",
        severity: "blocking",
        message: "sheet 数量超过安全解析限制，需要人工拆分。",
      });
    }

    if (workbook.vbaraw) {
      dangerousContentFlags.add("MACRO_PRESENT");
      issues.push({
        code: "MACRO_PRESENT",
        severity: "warning",
        message: "检测到 VBA 宏内容；系统只记录风险，不执行宏。",
      });
    }

    if (parseDurationMs > EXCEL_SAFETY_LIMITS.maxParseMs) {
      issues.push({
        code: "WORKBOOK_PARSE_TIMEOUT",
        severity: "blocking",
        message: "workbook 解析超过安全耗时预算，按不可信文件阻断。",
      });
    }

    const parsedSheets: ParsedWorkbookSheet[] = [];
    const parsedCells: ParsedWorkbookCell[] = [];
    const instructionLikeFlags = new Set<string>();
    let formulaCellCount = 0;
    let mergedRangeCount = 0;
    let externalLinkCount = 0;
    let estimatedCellCount = 0;

    for (const [sheetIndex, sheetName] of sheetNames.entries()) {
      const worksheet = workbook.Sheets[sheetName];
      if (!worksheet) {
        continue;
      }

      const ref = worksheet["!ref"];
      if (!ref) {
        parsedSheets.push(emptyParsedSheet(sheetName, sheetIndex));
        continue;
      }

      const range = XLSX.utils.decode_range(ref);
      const rowCount = range.e.r - range.s.r + 1;
      const columnCount = range.e.c - range.s.c + 1;
      estimatedCellCount += rowCount * columnCount;
      if (rowCount >= EXCEL_SAFETY_LIMITS.maxRowsPerSheet) {
        issues.push({
          code: "CELL_LIMIT_EXCEEDED",
          severity: "blocking",
          message: "sheet 行数达到安全解析上限，需要人工拆分后重新上传。",
        });
      }
      const mergedRanges = (worksheet["!merges"] ?? []).map((mergeRange) =>
        XLSX.utils.encode_range(mergeRange),
      );
      mergedRangeCount += mergedRanges.length;
      const headerRowIndex = findHeaderRowIndex(worksheet, range);
      const headerValues =
        headerRowIndex === undefined ? [] : rowValues(worksheet, headerRowIndex, range);
      const sampleRows =
        headerRowIndex === undefined
          ? []
          : sampleRowsAfterHeader(worksheet, headerRowIndex, range);
      const sheetCells = cellsFromSheet({
        worksheet,
        sheetName,
        range,
        headerRowIndex,
        mergedRanges,
      });

      for (const cell of sheetCells) {
        if (cell.formulaText) {
          formulaCellCount += 1;
          dangerousContentFlags.add("FORMULA_PRESENT");
          if (isExternalFormulaReference(cell.formulaText)) {
            externalLinkCount += 1;
            dangerousContentFlags.add("EXTERNAL_LINK_REFERENCE");
          }
        }

        const instructionFlags = detectInstructionLikeContent(
          `${cell.rawValue ?? ""} ${cell.displayValue ?? ""}`,
        );
        for (const flag of instructionFlags) {
          instructionLikeFlags.add(flag);
          dangerousContentFlags.add(flag);
        }
      }

      parsedSheets.push({
        sheetName,
        sheetIndex,
        rowCount,
        columnCount,
        effectiveRange: ref,
        headerRowIndex,
        headerValues,
        sampleRows,
        mergedRanges,
        hasHeader: headerRowIndex !== undefined,
      });
      parsedCells.push(...sheetCells);
    }

    if (estimatedCellCount > EXCEL_SAFETY_LIMITS.maxTotalCells) {
      issues.push({
        code: "CELL_LIMIT_EXCEEDED",
        severity: "blocking",
        message: "单个 workbook 单元格数量超过安全解析限制，需要人工拆分。",
      });
    }

    if (parsedSheets.length > 0 && parsedSheets.every((sheet) => !sheet.hasHeader)) {
      issues.push({
        code: "WORKBOOK_HAS_NO_HEADER",
        severity: "blocking",
        message: "未识别到有效表头，不能进入字段映射。",
      });
    }

    if (formulaCellCount > 0) {
      issues.push({
        code: "FORMULA_PRESENT",
        severity: "info",
        message: "检测到公式单元格；系统只记录公式文本和显示值，不执行公式。",
      });
    }

    if (externalLinkCount > 0) {
      issues.push({
        code: "EXTERNAL_LINK_REFERENCE",
        severity: "warning",
        message: "检测到疑似外部链接或联网函数；系统只记录文本，不联网。",
      });
    }

    if (instructionLikeFlags.size > 0) {
      issues.push({
        code: "INSTRUCTION_LIKE_TEXT",
        severity: "warning",
        message: "单元格包含疑似指令类文本；按客户数据保存，不改变系统行为。",
      });
    }

    return {
      parserVersion: EXCEL_PARSER_VERSION,
      status: issues.some((issue) => issue.severity === "blocking") ? "BLOCKED" : "PARSED",
      workbookName: input.workbookName,
      sheetCount: sheetNames.length,
      formulaCellCount,
      mergedRangeCount,
      externalLinkCount,
      dangerousContentFlags: Array.from(dangerousContentFlags).sort(),
      issues,
      sheets: parsedSheets,
      cells: parsedCells.slice(0, EXCEL_SAFETY_LIMITS.maxPersistedCells),
    };
  } catch (error) {
    return blockedWorkbook(input.workbookName, [
      ...preflightIssues,
      {
        code: "WORKBOOK_PARSE_FAILED",
        severity: "blocking",
        message: error instanceof Error ? error.message : "workbook 解析失败。",
      },
    ]);
  }
}

function blockedWorkbook(workbookName: string | undefined, issues: ExcelSafetyIssue[]) {
  return {
    parserVersion: EXCEL_PARSER_VERSION,
    status: "BLOCKED" as const,
    workbookName,
    sheetCount: 0,
    formulaCellCount: 0,
    mergedRangeCount: 0,
    externalLinkCount: 0,
    dangerousContentFlags: issues.map((issue) => issue.code),
    issues,
    sheets: [],
    cells: [],
  };
}

function isExternalFormulaReference(formula: string): boolean {
  return /\[[^\]]+\]|https?:|WEBSERVICE|HYPERLINK|IMPORTXML|IMPORTHTML/i.test(formula);
}
