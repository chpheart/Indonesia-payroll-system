import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { actorHasPermission, isSystemAdmin } from "@/domain/auth/permissions";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const createClientSchema = z.object({
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(160),
  legalEntityName: z.string().max(200).optional(),
});

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const clients = await prisma.client.findMany({
      where: isSystemAdmin(actor)
        ? undefined
        : {
            id: { in: actor.authorizedClientIds },
          },
      include: {
        accesses: {
          where: { status: "ACTIVE" },
          include: { user: true, role: true },
          orderBy: { grantedAt: "desc" },
        },
        configVersions: {
          orderBy: { versionNumber: "desc" },
          take: 3,
        },
      },
      orderBy: { code: "asc" },
    });

    return NextResponse.json({ clients });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    if (!actorHasPermission(actor, "client.edit")) {
      return NextResponse.json({ errorCode: "ROLE_MISSING_PERMISSION" }, { status: 403 });
    }

    const body = createClientSchema.parse(await request.json());
    const client = await prisma.client.create({
      data: {
        code: body.code.trim(),
        name: body.name.trim(),
        legalEntityName: body.legalEntityName?.trim() || undefined,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "CLIENT_CREATED",
        objectType: "CLIENT",
        objectId: client.id,
        riskLevel: "R1",
        ...auditFields,
        clientId: client.id,
        metadata: { code: client.code },
      },
    });

    return NextResponse.json({ client }, { status: 201 });
  });
}
