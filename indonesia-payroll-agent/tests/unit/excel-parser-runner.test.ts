import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { inspectExcelUpload } from "@/domain/excel/excel-safety-policy";

function workbookBuffer() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Salary", "Tax"],
    ["Ayu", 1000, 100],
  ]);
  sheet.C2 = { t: "n", v: 100, w: "100", f: "B2*0.1" };
  XLSX.utils.book_append_sheet(workbook, sheet, "中国籍6名员工");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function loadRunner() {
  const runnerModule = await import("@/domain/excel/excel-parser-runner");
  return runnerModule.parseExcelWorkbookIsolated;
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("node:worker_threads");
});

describe("excel parser runner", () => {
  it("parses untrusted workbooks in an isolated worker path", async () => {
    const parseExcelWorkbookIsolated = await loadRunner();
    const buffer = workbookBuffer();
    const parsed = await parseExcelWorkbookIsolated({
      buffer,
      workbookName: "isolated.xlsx",
      preflightIssues: inspectExcelUpload({
        fileName: "isolated.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: buffer.byteLength,
        buffer,
      }),
    });

    expect(parsed.parserVersion).toContain("worker");
    expect(parsed.status).toBe("PARSED");
    expect(parsed.sheets[0]?.sheetName).toBe("中国籍6名员工");
    expect(parsed.cells).toContainEqual(
      expect.objectContaining({ address: "C2", formulaText: "B2*0.1" }),
    );
  });

  it("blocks workbook parsing when the worker exceeds the time budget", async () => {
    vi.doMock("node:worker_threads", () => ({
      Worker: class HangingWorker extends EventEmitter {
        terminate = vi.fn(async () => 0);
      },
    }));

    const parseExcelWorkbookIsolated = await loadRunner();
    const parsed = await parseExcelWorkbookIsolated({
      buffer: Buffer.from("not reached"),
      workbookName: "slow.xlsx",
      timeoutMs: 1,
    });

    expect(parsed.status).toBe("BLOCKED");
    expect(parsed.dangerousContentFlags).toContain("WORKBOOK_PARSE_TIMEOUT");
  });

  it("blocks workbook parsing when the worker throws", async () => {
    vi.doMock("node:worker_threads", () => ({
      Worker: class ErrorWorker extends EventEmitter {
        terminate = vi.fn(async () => 0);

        constructor() {
          super();
          queueMicrotask(() => this.emit("error", new Error("worker exploded")));
        }
      },
    }));

    const parseExcelWorkbookIsolated = await loadRunner();
    const parsed = await parseExcelWorkbookIsolated({
      buffer: Buffer.from("bad"),
      workbookName: "error.xlsx",
    });

    expect(parsed.status).toBe("BLOCKED");
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        code: "WORKBOOK_PARSE_FAILED",
        message: "worker exploded",
      }),
    );
  });

  it("blocks workbook parsing when the worker exits unexpectedly", async () => {
    vi.doMock("node:worker_threads", () => ({
      Worker: class ExitWorker extends EventEmitter {
        terminate = vi.fn(async () => 0);

        constructor() {
          super();
          queueMicrotask(() => this.emit("exit", 13));
        }
      },
    }));

    const parseExcelWorkbookIsolated = await loadRunner();
    const parsed = await parseExcelWorkbookIsolated({
      buffer: Buffer.from("bad"),
      workbookName: "exit.xlsx",
    });

    expect(parsed.status).toBe("BLOCKED");
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        code: "WORKBOOK_PARSE_FAILED",
        message: "worker exited with code 13",
      }),
    );
  });
});
