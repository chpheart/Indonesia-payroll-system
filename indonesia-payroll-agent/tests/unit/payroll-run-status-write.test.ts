import { describe, expect, it } from "vitest";
import { statusUpdateData } from "@/app/(app)/payroll-runs/status-write";

describe("payroll run status writes", () => {
  it("sets immutable milestone timestamps for terminal statuses", () => {
    expect(statusUpdateData("LOCKED", "locked")).toMatchObject({
      status: "LOCKED",
      statusReason: "locked",
      lockedAt: expect.any(Date),
    });
    expect(statusUpdateData("EXPORTED", "exported")).toMatchObject({
      exportedAt: expect.any(Date),
    });
    expect(statusUpdateData("ARCHIVED", "archived")).toMatchObject({
      archivedAt: expect.any(Date),
    });
    expect(statusUpdateData("VOIDED", "voided")).toMatchObject({
      voidedAt: expect.any(Date),
    });
    expect(statusUpdateData("CORRECTED", "corrected")).toMatchObject({
      correctedAt: expect.any(Date),
    });
  });

  it("does not set milestone timestamps for in-flight statuses", () => {
    expect(statusUpdateData("PENDING_PRECHECK", "precheck")).toEqual({
      status: "PENDING_PRECHECK",
      statusReason: "precheck",
    });
  });
});
