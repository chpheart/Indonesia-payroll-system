import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getObject, putObject } from "@/lib/storage/local-file-store";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "id-payroll-store-"));
  process.env.LOCAL_FILE_STORE_ROOT = tempDir;
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  delete process.env.LOCAL_FILE_STORE_ROOT;
});

describe("local file store", () => {
  it("writes and reads an object inside the configured root", async () => {
    const stored = await putObject("runs/run-1/input.xlsx", Buffer.from("payroll"));
    const data = await getObject("runs/run-1/input.xlsx");

    expect(stored.key).toBe("runs/run-1/input.xlsx");
    expect(stored.absolutePath.startsWith(tempDir)).toBe(true);
    expect(stored.size).toBe(7);
    expect(data.toString("utf8")).toBe("payroll");
  });

  it.each(["../outside.txt", "runs/../../outside.txt"])(
    "rejects unsafe storage key %s",
    async (key) => {
      await expect(putObject(key, Buffer.from("no"))).rejects.toThrow(
        "Storage key must be relative",
      );
    },
  );

  it("rejects absolute storage keys", async () => {
    await expect(putObject(path.resolve(tempDir, "outside.txt"), Buffer.from("no"))).rejects.toThrow(
      "Storage key must be relative",
    );
  });
});
