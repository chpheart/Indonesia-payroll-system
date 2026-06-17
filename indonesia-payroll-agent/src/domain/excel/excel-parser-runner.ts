import { Worker } from "node:worker_threads";
import {
  EXCEL_SAFETY_LIMITS,
  type ExcelSafetyIssue,
} from "@/domain/excel/excel-safety-policy";
import { type ParsedWorkbook } from "@/domain/excel/excel-parser";
import { EXCEL_PARSER_WORKER_SOURCE } from "@/domain/excel/excel-parser-worker-source";

type WorkerResult =
  | { ok: true; parsed: ParsedWorkbook }
  | { ok: false; message: string };

export async function parseExcelWorkbookIsolated(input: {
  buffer: Buffer;
  workbookName?: string;
  preflightIssues?: ExcelSafetyIssue[];
  timeoutMs?: number;
}): Promise<ParsedWorkbook> {
  const preflightIssues = input.preflightIssues ?? [];
  if (preflightIssues.some((issue) => issue.severity === "blocking")) {
    return blockedWorkbook(input.workbookName, preflightIssues);
  }

  const timeoutMs = input.timeoutMs ?? EXCEL_SAFETY_LIMITS.maxParseMs;
  const worker = new Worker(EXCEL_PARSER_WORKER_SOURCE, {
    eval: true,
    resourceLimits: {
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 16,
    },
    workerData: {
      buffer: input.buffer,
      workbookName: input.workbookName,
      preflightIssues,
    },
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(async () => {
      await worker.terminate();
      resolve(
        blockedWorkbook(input.workbookName, [
          ...preflightIssues,
          {
            code: "WORKBOOK_PARSE_TIMEOUT",
            severity: "blocking",
            message: "workbook 解析超过安全耗时预算，worker 已终止。",
          },
        ]),
      );
    }, timeoutMs);

    worker.once("message", (result: WorkerResult) => {
      clearTimeout(timeout);
      void worker.terminate();
      resolve(result.ok ? result.parsed : parseFailed(input.workbookName, result.message));
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      void worker.terminate();
      resolve(parseFailed(input.workbookName, error.message));
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        resolve(parseFailed(input.workbookName, `worker exited with code ${code}`));
      }
    });
  });
}

function parseFailed(workbookName: string | undefined, message: string): ParsedWorkbook {
  return blockedWorkbook(workbookName, [
    {
      code: "WORKBOOK_PARSE_FAILED",
      severity: "blocking",
      message,
    },
  ]);
}

function blockedWorkbook(
  workbookName: string | undefined,
  issues: ExcelSafetyIssue[],
): ParsedWorkbook {
  return {
    parserVersion: "xlsx@0.18.5-phase4-worker-readonly",
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
