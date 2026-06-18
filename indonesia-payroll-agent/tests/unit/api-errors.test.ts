import { describe, expect, it } from "vitest";
import { apiErrorResponse } from "@/app/api/_utils/errors";

describe("api error responses", () => {
  it("does not expose unexpected internal error messages", async () => {
    const response = apiErrorResponse(new Error("database host leaked: payroll-prod"));
    const body = (await response.json()) as { errorCode: string; details?: unknown };

    expect(response.status).toBe(500);
    expect(body).toEqual({ errorCode: "INTERNAL_ERROR" });
  });

  it("returns explicit application error codes without stack details", async () => {
    const response = apiErrorResponse(new Error("CLIENT_ID_REQUIRED"));
    const body = (await response.json()) as { errorCode: string; details?: unknown };

    expect(response.status).toBe(400);
    expect(body).toEqual({ errorCode: "CLIENT_ID_REQUIRED" });
  });
});
