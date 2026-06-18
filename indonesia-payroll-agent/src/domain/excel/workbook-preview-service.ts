import { type ParsedWorkbook } from "@/domain/excel/excel-parser";

export type WorkbookPreview = {
  status: "PARSED" | "BLOCKED";
  workbookName?: string;
  sheetCount: number;
  formulaCellCount: number;
  mergedRangeCount: number;
  externalLinkCount: number;
  dangerousContentFlags: string[];
  issues: Array<{ code: string; severity: string; message: string }>;
  sheets: WorkbookSheetPreview[];
};

export type WorkbookSheetPreview = {
  sheetName: string;
  sheetIndex: number;
  rowCount: number;
  columnCount: number;
  effectiveRange?: string;
  headerRowIndex?: number;
  headerValues: string[];
  sampleRows: string[][];
  mergedRanges: string[];
  formulaCells: Array<{
    address: string;
    displayValue?: string;
    formulaText?: string;
  }>;
};

export function buildWorkbookPreview(parsed: ParsedWorkbook): WorkbookPreview {
  return {
    status: parsed.status,
    workbookName: parsed.workbookName,
    sheetCount: parsed.sheetCount,
    formulaCellCount: parsed.formulaCellCount,
    mergedRangeCount: parsed.mergedRangeCount,
    externalLinkCount: parsed.externalLinkCount,
    dangerousContentFlags: parsed.dangerousContentFlags,
    issues: parsed.issues,
    sheets: parsed.sheets.map((sheet) => ({
      sheetName: sheet.sheetName,
      sheetIndex: sheet.sheetIndex,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      effectiveRange: sheet.effectiveRange,
      headerRowIndex: sheet.headerRowIndex,
      headerValues: sheet.headerValues,
      sampleRows: sheet.sampleRows,
      mergedRanges: sheet.mergedRanges,
      formulaCells: parsed.cells
        .filter((cell) => cell.sheetName === sheet.sheetName && Boolean(cell.formulaText))
        .slice(0, 20)
        .map((cell) => ({
          address: cell.address,
          displayValue: cell.displayValue,
          formulaText: cell.formulaText,
        })),
    })),
  };
}
