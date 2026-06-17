import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { inspectExcelUpload } from "@/domain/excel/excel-safety-policy";
import { parseExcelWorkbook } from "@/domain/excel/excel-parser";

function workbookBufferWithFormula() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Salary", "Tax"],
    ["Ayu", 1000, 100],
  ]);
  sheet.C2 = { t: "n", v: 100, w: "100", f: "B2*0.1" };
  XLSX.utils.book_append_sheet(workbook, sheet, "1店");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function workbookBufferWithExternalFormula() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Lookup"],
    ["Ayu", ""],
  ]);
  sheet.B2 = {
    t: "s",
    v: "not executed",
    w: "not executed",
    f: 'WEBSERVICE("https://example.com/payroll")',
  };
  XLSX.utils.book_append_sheet(workbook, sheet, "6002店");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("excel parser", () => {
  it("parses workbook sheets, headers, cell addresses and formula text without executing formulas", () => {
    const buffer = workbookBufferWithFormula();
    const preflightIssues = inspectExcelUpload({
      fileName: "三福-工资考勤.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: buffer.byteLength,
      buffer,
    });

    const parsed = parseExcelWorkbook({
      buffer,
      workbookName: "三福-工资考勤.xlsx",
      preflightIssues,
    });

    expect(parsed.status).toBe("PARSED");
    expect(parsed.sheets[0]).toMatchObject({
      sheetName: "1店",
      headerValues: ["Name", "Salary", "Tax"],
      hasHeader: true,
    });
    expect(parsed.cells).toContainEqual(
      expect.objectContaining({
        sheetName: "1店",
        address: "C2",
        displayValue: "100",
        formulaText: "B2*0.1",
      }),
    );
    expect(parsed.formulaCellCount).toBe(1);
  });

  it("records external formula references as warnings and data only", () => {
    const buffer = workbookBufferWithExternalFormula();
    const parsed = parseExcelWorkbook({
      buffer,
      workbookName: "external.xlsx",
      preflightIssues: inspectExcelUpload({
        fileName: "external.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: buffer.byteLength,
        buffer,
      }),
    });

    expect(parsed.status).toBe("PARSED");
    expect(parsed.externalLinkCount).toBe(1);
    expect(parsed.dangerousContentFlags).toContain("EXTERNAL_LINK_REFERENCE");
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: "EXTERNAL_LINK_REFERENCE", severity: "warning" }),
    );
  });

  it("blocks files whose signature does not match the Excel extension", () => {
    const buffer = Buffer.from("not an excel workbook");
    const preflightIssues = inspectExcelUpload({
      fileName: "broken.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: buffer.byteLength,
      buffer,
    });
    const parsed = parseExcelWorkbook({ buffer, workbookName: "broken.xlsx", preflightIssues });

    expect(preflightIssues).toContainEqual(
      expect.objectContaining({ code: "FILE_SIGNATURE_MISMATCH", severity: "blocking" }),
    );
    expect(parsed.status).toBe("BLOCKED");
  });

  it("flags files over 50MB before workbook parsing", () => {
    const buffer = workbookBufferWithFormula();
    const preflightIssues = inspectExcelUpload({
      fileName: "huge.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 51 * 1024 * 1024,
      buffer,
    });
    const parsed = parseExcelWorkbook({ buffer, workbookName: "huge.xlsx", preflightIssues });

    expect(preflightIssues).toContainEqual(
      expect.objectContaining({ code: "FILE_TOO_LARGE", severity: "blocking" }),
    );
    expect(parsed.status).toBe("BLOCKED");
    expect(parsed.sheets).toHaveLength(0);
  });
});
