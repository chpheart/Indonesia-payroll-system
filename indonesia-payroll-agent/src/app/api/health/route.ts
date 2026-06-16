import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type HealthPayload = {
  app: "ok";
  database: "ok" | "error";
  timestamp: string;
  errorCode?: "DATABASE_UNAVAILABLE";
};

export async function GET() {
  const payload: HealthPayload = {
    app: "ok",
    database: "ok",
    timestamp: new Date().toISOString(),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(payload);
  } catch {
    return NextResponse.json(
      {
        ...payload,
        database: "error",
        errorCode: "DATABASE_UNAVAILABLE",
      },
      { status: 503 },
    );
  }
}
