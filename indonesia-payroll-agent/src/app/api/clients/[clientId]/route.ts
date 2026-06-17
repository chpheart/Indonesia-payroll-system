import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const patchClientSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { clientId } = await context.params;
    assertClientActionAllowed(actor, "editClient", clientId);

    const body = patchClientSchema.parse(await request.json());
    const existing = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, code: true, status: true },
    });

    if (!existing) {
      return NextResponse.json({ errorCode: "CLIENT_NOT_FOUND" }, { status: 404 });
    }

    const client = await prisma.client.update({
      where: { id: clientId },
      data: { status: body.status },
    });

    if (existing.status !== client.status) {
      await prisma.auditLog.create({
        data: {
          action: client.status === "ACTIVE" ? "CLIENT_ENABLED" : "CLIENT_DISABLED",
          objectType: "CLIENT",
          objectId: client.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: client.id,
          metadata: {
            code: client.code,
            fromStatus: existing.status,
            toStatus: client.status,
          },
        },
      });
    }

    return NextResponse.json({ client });
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { clientId } = await context.params;
    assertClientActionAllowed(actor, "editClient", clientId);

    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true, hasHistoricalPayroll: true, code: true },
    });

    if (!client) {
      return NextResponse.json({ errorCode: "CLIENT_NOT_FOUND" }, { status: 404 });
    }

    if (client.hasHistoricalPayroll) {
      await prisma.auditLog.create({
        data: {
          action: "CLIENT_DELETE_REJECTED",
          objectType: "CLIENT",
          objectId: client.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: client.id,
          metadata: { reason: "HAS_HISTORICAL_PAYROLL", code: client.code },
        },
      });
      return NextResponse.json(
        { errorCode: "CLIENT_WITH_HISTORY_CANNOT_BE_DELETED" },
        { status: 409 },
      );
    }

    await prisma.client.delete({ where: { id: client.id } });
    return NextResponse.json({ deleted: true });
  });
}
