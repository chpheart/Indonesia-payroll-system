import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { assertCriticalFieldEvidence } from "@/domain/employees/employee-service";
import { toInputJsonObject } from "@/lib/json/input-json";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const createMasterVersionSchema = z.object({
  effectiveMonth: z.string().min(7).max(7),
  changedFields: z.record(z.string(), z.unknown()),
  snapshot: z.record(z.string(), z.unknown()),
  evidenceRefs: z.array(z.string()).default([]),
  changeReason: z.string().min(1).max(500),
});

type RouteContext = {
  params: Promise<unknown>;
};

async function employeeIdFromContext(context: RouteContext) {
  const params = (await context.params) as { employeeId?: unknown };
  if (typeof params.employeeId !== "string") {
    throw new Error("EMPLOYEE_ID_REQUIRED");
  }

  return params.employeeId;
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const employeeId = await employeeIdFromContext(context);
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });

    if (!employee) {
      return NextResponse.json({ errorCode: "EMPLOYEE_NOT_FOUND" }, { status: 404 });
    }

    assertClientActionAllowed(actor, "editEmployee", employee.clientId);
    const body = createMasterVersionSchema.parse(await request.json());
    assertCriticalFieldEvidence(body.changedFields, body.evidenceRefs);
    const changedFields = toInputJsonObject(body.changedFields);
    const snapshot = toInputJsonObject(body.snapshot);
    const latest = await prisma.employeeMasterVersion.findFirst({
      where: { employeeId },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const version = await prisma.employeeMasterVersion.create({
      data: {
        employeeId,
        versionNumber,
        effectiveMonth: body.effectiveMonth,
        changedFields,
        snapshot,
        evidenceRefs: body.evidenceRefs,
        changeReason: body.changeReason,
        status: "DRAFT",
        createdById: auditFields.actorUserId,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "EMPLOYEE_MASTER_VERSION_CREATED",
        objectType: "EMPLOYEE_MASTER_VERSION",
        objectId: version.id,
        riskLevel: "R2",
        ...auditFields,
        clientId: employee.clientId,
        metadata: {
          employeeCode: employee.employeeCode,
          versionNumber,
          effectiveMonth: body.effectiveMonth,
          inputSummary: "API 生成员工主档待确认版本，不写入当前员工主档",
          outputSummary: "DRAFT 版本已创建，等待人工确认后才能生效",
          evidenceRefs: body.evidenceRefs,
        },
      },
    });

    return NextResponse.json({ version }, { status: 201 });
  });
}
