import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { toInputJsonObject } from "@/lib/json/input-json";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const createConfigVersionSchema = z.object({
  effectiveMonth: z.string().min(7).max(7),
  payrollDay: z.number().int().min(1).max(31).optional(),
  templateCode: z.string().max(80).optional(),
  grossUpDefault: z.boolean().default(false),
  bpjsConfig: z.record(z.string(), z.unknown()).default({}),
  ruleConfig: z.record(z.string(), z.unknown()).default({}),
  evidenceRefs: z.array(z.string()).default([]),
  changeReason: z.string().min(1).max(500),
});

type RouteContext = {
  params: Promise<unknown>;
};

async function clientIdFromContext(context: RouteContext) {
  const params = (await context.params) as { clientId?: unknown };
  if (typeof params.clientId !== "string") {
    throw new Error("CLIENT_ID_REQUIRED");
  }

  return params.clientId;
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const clientId = await clientIdFromContext(context);
    assertClientActionAllowed(actor, "editClient", clientId);
    const body = createConfigVersionSchema.parse(await request.json());
    const client = await prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });

    if (!client) {
      return NextResponse.json({ errorCode: "CLIENT_NOT_FOUND" }, { status: 404 });
    }

    const latest = await prisma.clientConfigVersion.findFirst({
      where: { clientId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const version = await prisma.clientConfigVersion.create({
      data: {
        clientId,
        versionNumber,
        effectiveMonth: body.effectiveMonth,
        payrollDay: body.payrollDay,
        templateCode: body.templateCode,
        grossUpDefault: body.grossUpDefault,
        bpjsConfig: toInputJsonObject(body.bpjsConfig),
        ruleConfig: toInputJsonObject(body.ruleConfig),
        evidenceRefs: body.evidenceRefs,
        changeReason: body.changeReason,
        status: "DRAFT",
        createdById: auditFields.actorUserId,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "CLIENT_CONFIG_VERSION_CREATED",
        objectType: "CLIENT_CONFIG_VERSION",
        objectId: version.id,
        riskLevel: "R2",
        ...auditFields,
        clientId,
        metadata: {
          versionNumber,
          effectiveMonth: body.effectiveMonth,
          inputSummary: "API 生成客户配置待确认版本，不直接生效",
          outputSummary: "DRAFT 版本已创建，等待人工确认后才能生效",
          evidenceRefs: body.evidenceRefs,
        },
      },
    });

    return NextResponse.json({ version }, { status: 201 });
  });
}
