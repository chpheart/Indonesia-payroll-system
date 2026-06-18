import * as XLSX from "xlsx";
import { EXCEL_SAFETY_LIMITS } from "@/domain/excel/excel-safety-policy";
import {
  type ParsedWorkbookCell,
  type ParsedWorkbookSheet,
} from "@/domain/excel/excel-parser-types";

export function emptyParsedSheet(sheetName: string, sheetIndex: number): ParsedWorkbookSheet {
  return {
    sheetName,
    sheetIndex,
    rowCount: 0,
    columnCount: 0,
    headerValues: [],
    sampleRows: [],
    mergedRanges: [],
    hasHeader: false,
  };
}

export function findHeaderRowIndex(
  worksheet: XLSX.WorkSheet,
  range: XLSX.Range,
): number | undefined {
  const maxHeaderScanRow = Math.min(range.e.r, range.s.r + 20);
  for (let rowIndex = range.s.r; rowIndex <= maxHeaderScanRow; rowIndex += 1) {
    const values = rowValues(worksheet, rowIndex, range).filter(Boolean);
    if (values.length >= 2) {
      return rowIndex;
    }
  }

  return undefined;
}

export function sampleRowsAfterHeader(
  worksheet: XLSX.WorkSheet,
  headerRowIndex: number,
  range: XLSX.Range,
): string[][] {
  const rows: string[][] = [];
  const lastRow = Math.min(range.e.r, headerRowIndex + EXCEL_SAFETY_LIMITS.maxPreviewRowsPerSheet);
  for (let rowIndex = headerRowIndex + 1; rowIndex <= lastRow; rowIndex += 1) {
    const values = rowValues(worksheet, rowIndex, range);
    if (values.some(Boolean)) {
      rows.push(values);
    }
  }

  return rows;
}

export function rowValues(
  worksheet: XLSX.WorkSheet,
  rowIndex: number,
  range: XLSX.Range,
): string[] {
  const values: string[] = [];
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
    const cell = worksheet[address] as XLSX.CellObject | undefined;
    values.push(cellText(cell));
  }

  return values;
}

export function cellsFromSheet(input: {
  worksheet: XLSX.WorkSheet;
  sheetName: string;
  range: XLSX.Range;
  headerRowIndex?: number;
  mergedRanges: string[];
}): ParsedWorkbookCell[] {
  const cells: ParsedWorkbookCell[] = [];
  for (let rowIndex = input.range.s.r; rowIndex <= input.range.e.r; rowIndex += 1) {
    for (let columnIndex = input.range.s.c; columnIndex <= input.range.e.c; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = input.worksheet[address] as XLSX.CellObject | undefined;
      if (!cell || isEmptyCell(cell)) {
        continue;
      }

      cells.push({
        sheetName: input.sheetName,
        address,
        rowIndex,
        columnIndex,
        rawValue: rawCellValue(cell),
        displayValue: cell.w ?? rawCellValue(cell),
        formulaText: cell.f,
        numberFormat: typeof cell.z === "string" ? cell.z : undefined,
        mergedRange: input.mergedRanges.find((range) => rangeIncludesAddress(range, address)),
        isHeader: input.headerRowIndex === rowIndex,
      });
    }
  }

  return cells;
}

function rawCellValue(cell: XLSX.CellObject): string | undefined {
  if (cell.v instanceof Date) {
    return cell.v.toISOString();
  }

  if (typeof cell.v === "string") {
    return cell.v;
  }

  if (typeof cell.v === "number" || typeof cell.v === "boolean") {
    return String(cell.v);
  }

  return undefined;
}

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) {
    return "";
  }

  return cell.w ?? rawCellValue(cell) ?? "";
}

function isEmptyCell(cell: XLSX.CellObject): boolean {
  return !cell.f && cellText(cell).trim().length === 0;
}

function rangeIncludesAddress(range: string, address: string): boolean {
  const decodedRange = XLSX.utils.decode_range(range);
  const decodedAddress = XLSX.utils.decode_cell(address);

  return (
    decodedAddress.r >= decodedRange.s.r &&
    decodedAddress.r <= decodedRange.e.r &&
    decodedAddress.c >= decodedRange.s.c &&
    decodedAddress.c <= decodedRange.e.c
  );
}
