export const EXCEL_PARSER_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const XLSX = require("xlsx");

const LIMITS = {
  maxSheets: 50,
  maxTotalCells: 200000,
  maxPersistedCells: 200000,
  maxPreviewRowsPerSheet: 5,
  maxRowsPerSheet: 5000,
};
const PARSER_VERSION = "xlsx@0.18.5-phase4-worker-readonly";

function blocked(workbookName, issues) {
  return {
    parserVersion: PARSER_VERSION,
    status: "BLOCKED",
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

function instructionFlags(value) {
  const checks = [
    [/忽略(系统|审批|规则|门禁|限制)/i, "PROMPT_INJECTION_CN"],
    [/直接(锁定|放行|导出|提交|报税|发送)/i, "UNAPPROVED_ACTION_CN"],
    [/自动(放行|审批|锁定|导出|提交)/i, "AUTONOMOUS_ACTION_CN"],
    [/ignore (previous|all|system) instructions?/i, "PROMPT_INJECTION_EN"],
    [/\\b(bypass|skip)\\s+(approval|review|guardrail|permission)/i, "BYPASS_APPROVAL_EN"],
    [/\\b(call|execute|run)\\s+(tool|api|function|command)/i, "TOOL_INSTRUCTION_EN"],
  ];
  return checks.flatMap(([pattern, flag]) => pattern.test(value) ? [flag] : []);
}

function rawCellValue(cell) {
  if (!cell) return undefined;
  if (cell.v instanceof Date) return cell.v.toISOString();
  if (typeof cell.v === "string") return cell.v;
  if (typeof cell.v === "number" || typeof cell.v === "boolean") return String(cell.v);
  return undefined;
}

function cellText(cell) {
  return cell ? (cell.w || rawCellValue(cell) || "") : "";
}

function rowValues(worksheet, rowIndex, range) {
  const values = [];
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
    values.push(cellText(worksheet[address]));
  }
  return values;
}

function headerRowIndex(worksheet, range) {
  const last = Math.min(range.e.r, range.s.r + 20);
  for (let rowIndex = range.s.r; rowIndex <= last; rowIndex += 1) {
    if (rowValues(worksheet, rowIndex, range).filter(Boolean).length >= 2) return rowIndex;
  }
  return undefined;
}

function sampleRows(worksheet, headerIndex, range) {
  const rows = [];
  const last = Math.min(range.e.r, headerIndex + LIMITS.maxPreviewRowsPerSheet);
  for (let rowIndex = headerIndex + 1; rowIndex <= last; rowIndex += 1) {
    const values = rowValues(worksheet, rowIndex, range);
    if (values.some(Boolean)) rows.push(values);
  }
  return rows;
}

function rangeIncludesAddress(range, address) {
  const decodedRange = XLSX.utils.decode_range(range);
  const decodedAddress = XLSX.utils.decode_cell(address);
  return (
    decodedAddress.r >= decodedRange.s.r &&
    decodedAddress.r <= decodedRange.e.r &&
    decodedAddress.c >= decodedRange.s.c &&
    decodedAddress.c <= decodedRange.e.c
  );
}

function sheetCells(worksheet, sheetName, range, headerIndex, mergedRanges) {
  const cells = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = worksheet[address];
      if (!cell || (!cell.f && cellText(cell).trim().length === 0)) continue;
      cells.push({
        sheetName,
        address,
        rowIndex,
        columnIndex,
        rawValue: rawCellValue(cell),
        displayValue: cell.w || rawCellValue(cell),
        formulaText: cell.f,
        numberFormat: typeof cell.z === "string" ? cell.z : undefined,
        mergedRange: mergedRanges.find((item) => rangeIncludesAddress(item, address)),
        isHeader: headerIndex === rowIndex,
      });
    }
  }
  return cells;
}

function isExternalFormula(formula) {
  return /\\[[^\\]]+\\]|https?:|WEBSERVICE|HYPERLINK|IMPORTXML|IMPORTHTML/i.test(formula);
}

function parse() {
  const preflightIssues = workerData.preflightIssues || [];
  if (preflightIssues.some((issue) => issue.severity === "blocking")) {
    return blocked(workerData.workbookName, preflightIssues);
  }

  const workbook = XLSX.read(Buffer.from(workerData.buffer), {
    type: "buffer",
    cellFormula: true,
    cellNF: true,
    cellText: true,
    bookVBA: true,
    sheetRows: LIMITS.maxRowsPerSheet,
    WTF: false,
  });
  const issues = [...preflightIssues];
  const flags = new Set();
  const sheets = [];
  const cells = [];
  let formulaCellCount = 0;
  let mergedRangeCount = 0;
  let externalLinkCount = 0;
  let estimatedCellCount = 0;

  if (workbook.SheetNames.length === 0) {
    issues.push({ code: "WORKBOOK_HAS_NO_SHEETS", severity: "blocking", message: "workbook 没有 sheet，不能进入后续映射或算薪流程。" });
  }
  if (workbook.SheetNames.length > LIMITS.maxSheets) {
    issues.push({ code: "SHEET_LIMIT_EXCEEDED", severity: "blocking", message: "sheet 数量超过安全解析限制，需要人工拆分。" });
  }
  if (workbook.vbaraw) {
    flags.add("MACRO_PRESENT");
    issues.push({ code: "MACRO_PRESENT", severity: "warning", message: "检测到 VBA 宏内容；系统只记录风险，不执行宏。" });
  }

  for (const [sheetIndex, sheetName] of workbook.SheetNames.entries()) {
    const worksheet = workbook.Sheets[sheetName];
    const ref = worksheet && worksheet["!ref"];
    if (!ref) {
      sheets.push({ sheetName, sheetIndex, rowCount: 0, columnCount: 0, headerValues: [], sampleRows: [], mergedRanges: [], hasHeader: false });
      continue;
    }
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r + 1;
    const columnCount = range.e.c - range.s.c + 1;
    estimatedCellCount += rowCount * columnCount;
    if (rowCount >= LIMITS.maxRowsPerSheet) {
      issues.push({ code: "CELL_LIMIT_EXCEEDED", severity: "blocking", message: "sheet 行数达到安全解析上限，需要人工拆分后重新上传。" });
    }
    const mergedRanges = (worksheet["!merges"] || []).map((mergeRange) => XLSX.utils.encode_range(mergeRange));
    mergedRangeCount += mergedRanges.length;
    const headerIndex = headerRowIndex(worksheet, range);
    const headerValues = headerIndex === undefined ? [] : rowValues(worksheet, headerIndex, range);
    const parsedCells = sheetCells(worksheet, sheetName, range, headerIndex, mergedRanges);
    for (const cell of parsedCells) {
      if (cell.formulaText) {
        formulaCellCount += 1;
        flags.add("FORMULA_PRESENT");
        if (isExternalFormula(cell.formulaText)) {
          externalLinkCount += 1;
          flags.add("EXTERNAL_LINK_REFERENCE");
        }
      }
      for (const flag of instructionFlags((cell.rawValue || "") + " " + (cell.displayValue || ""))) flags.add(flag);
    }
    sheets.push({
      sheetName,
      sheetIndex,
      rowCount,
      columnCount,
      effectiveRange: ref,
      headerRowIndex: headerIndex,
      headerValues,
      sampleRows: headerIndex === undefined ? [] : sampleRows(worksheet, headerIndex, range),
      mergedRanges,
      hasHeader: headerIndex !== undefined,
    });
    cells.push(...parsedCells);
  }

  if (estimatedCellCount > LIMITS.maxTotalCells) {
    issues.push({ code: "CELL_LIMIT_EXCEEDED", severity: "blocking", message: "单个 workbook 单元格数量超过安全解析限制，需要人工拆分。" });
  }
  if (sheets.length > 0 && sheets.every((sheet) => !sheet.hasHeader)) {
    issues.push({ code: "WORKBOOK_HAS_NO_HEADER", severity: "blocking", message: "未识别到有效表头，不能进入字段映射。" });
  }
  if (formulaCellCount > 0) {
    issues.push({ code: "FORMULA_PRESENT", severity: "info", message: "检测到公式单元格；系统只记录公式文本和显示值，不执行公式。" });
  }
  if (externalLinkCount > 0) {
    issues.push({ code: "EXTERNAL_LINK_REFERENCE", severity: "warning", message: "检测到疑似外部链接或联网函数；系统只记录文本，不联网。" });
  }
  if ([...flags].some((flag) => flag.includes("INJECTION") || flag.includes("ACTION") || flag.includes("BYPASS") || flag.includes("TOOL"))) {
    issues.push({ code: "INSTRUCTION_LIKE_TEXT", severity: "warning", message: "单元格包含疑似指令类文本；按客户数据保存，不改变系统行为。" });
  }

  return {
    parserVersion: PARSER_VERSION,
    status: issues.some((issue) => issue.severity === "blocking") ? "BLOCKED" : "PARSED",
    workbookName: workerData.workbookName,
    sheetCount: workbook.SheetNames.length,
    formulaCellCount,
    mergedRangeCount,
    externalLinkCount,
    dangerousContentFlags: [...flags].sort(),
    issues,
    sheets,
    cells: cells.slice(0, LIMITS.maxPersistedCells),
  };
}

try {
  parentPort.postMessage({ ok: true, parsed: parse() });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    message: error && error.message ? error.message : "workbook 解析失败。",
  });
}
`;
