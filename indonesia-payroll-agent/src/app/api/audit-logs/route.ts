import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import {
  assertClientActionAllowed,
  isSystemAdmin,
  type ActorContext,
} from "@/domain/auth/permissions";
import { AUDIT_ACTIONS } from "@/domain/audit/audit-service";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const correctionSchema = z.object({
  auditLogId: z.string().min(1),
  note: z.string().min(1),
});

function actionFromParam(value: string | null) {
  if (!value) {
    return undefined;
  }

  return AUDIT_ACTIONS.includes(value as (typeof AUDIT_ACTIONS)[number])
    ? (value as (typeof AUDIT_ACTIONS)[number])
    : undefined;
}

function dateFromParam(value: string | null) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function scopedClientFilter(actor: ActorContext, clientId: string | null) {
  if (clientId) {
    assertClientActionAllowed(actor, "viewAudit", clientId);
    return clientId;
  }

  if (isSystemAdmin(actor)) {
    return undefined;
  }

  return actor.authorizedClientIds;
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const clientScope = scopedClientFilter(actor, searchParams.get("clientId"));
    const runId = searchParams.get("runId")?.trim();
    const actorEmail = searchParams.get("actorEmail")?.trim();
    const action = actionFromParam(searchParams.get("action"));
    const from = dateFromParam(searchParams.get("from"));
    const to = dateFromParam(searchParams.get("to"));

    const logs = await prisma.auditLog.findMany({
      where: {
        clientId: Array.isArray(clientScope)
          ? { in: clientScope }
          : clientScope
            ? clientScope
            : undefined,
        runId: runId || undefined,
        actorEmail: actorEmail || undefined,
        action,
        createdAt: from || to ? { gte: from, lte: to } : undefined,
      },
      include: {
        corrections: {
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return NextResponse.json({ logs });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = correctionSchema.parse(await request.json());
    const auditLog = await prisma.auditLog.findUnique({
      where: { id: body.auditLogId },
    });

    if (!auditLog) {
      return NextResponse.json({ errorCode: "AUDIT_LOG_NOT_FOUND" }, { status: 404 });
    }

    if (auditLog.clientId) {
      assertClientActionAllowed(actor, "viewAudit", auditLog.clientId);
    }

    const correction = await prisma.auditCorrection.create({
      data: {
        auditLogId: auditLog.id,
        note: body.note.trim(),
        createdById: auditFields.actorUserId,
        createdByEmail: actor.email,
      },
    });

    return NextResponse.json({ correction }, { status: 201 });
  });
}
