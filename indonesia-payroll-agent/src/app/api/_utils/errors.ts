import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { PermissionDeniedError } from "@/domain/auth/permissions";

export async function handleApi(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export function apiErrorResponse(
  error: unknown,
): NextResponse<{ errorCode: string; details?: unknown }> {
  if (error instanceof PermissionDeniedError) {
    return NextResponse.json({ errorCode: error.code }, { status: 403 });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        errorCode: "VALIDATION_ERROR",
        details: error.issues,
      },
      { status: 400 },
    );
  }

  if (error instanceof Error && isPublicErrorCode(error.message)) {
    return NextResponse.json({ errorCode: error.message }, { status: 400 });
  }

  return NextResponse.json(
    {
      errorCode: "INTERNAL_ERROR",
    },
    { status: 500 },
  );
}

function isPublicErrorCode(message: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,}$/.test(message);
}
