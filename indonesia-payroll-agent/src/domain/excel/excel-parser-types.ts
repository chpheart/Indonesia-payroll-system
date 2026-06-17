import { type ExcelSafetyIssue } from "@/domain/excel/excel-safety-policy";

export type ParsedWorkbook = {
  parserVersion: string;
  status: "PARSED" | "BLOCKED";
  workbookName?: string;
  sheetCount: number;
  formulaCellCount: number;
  mergedRangeCount: number;
  externalLinkCount: number;
  dangerousContentFlags: string[];
  issues: ExcelSafetyIssue[];
  sheets: ParsedWorkbookSheet[];
  cells: ParsedWorkbookCell[];
};

export type ParsedWorkbookSheet = {
  sheetName: string;
  sheetIndex: number;
  rowCount: number;
  columnCount: number;
  effectiveRange?: string;
  headerRowIndex?: number;
  headerValues: string[];
  sampleRows: string[][];
  mergedRanges: string[];
  hasHeader: boolean;
};

export type ParsedWorkbookCell = {
  sheetName: string;
  address: string;
  rowIndex: number;
  columnIndex: number;
  rawValue?: string;
  displayValue?: string;
  formulaText?: string;
  numberFormat?: string;
  mergedRange?: string;
  isHeader: boolean;
};
