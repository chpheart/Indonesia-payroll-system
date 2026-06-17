import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const patchEmployeeSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

type RouteContext = {
  params: Promise<{
    employeeId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { employeeId } = await context.params;
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });

    if (!employee) {
      return NextResponse.json({ errorCode: "EMPLOYEE_NOT_FOUND" }, { status: 404 });
    }

    assertClientActionAllowed(actor, "editEmployee", employee.clientId);
    const body = patchEmployeeSchema.parse(await request.json());
    const updated = await prisma.employee.update({
      where: { id: employeeId },
      data: { status: body.status },
    });

    await prisma.auditLog.create({
      data: {
        action: "EMPLOYEE_STATUS_UPDATED",
        objectType: "EMPLOYEE",
        objectId: updated.id,
        riskLevel: "R1",
        ...auditFields,
        clientId: updated.clientId,
        metadata: {
          employeeCode: updated.employeeCode,
          fromStatus: employee.status,
          toStatus: updated.status,
          inputSummary: "API 员工启用/停用状态更新；离职不允许走此入口",
          outputSummary: "当前员工状态已更新并写入审计",
        },
      },
    });

    return NextResponse.json({ employee: updated });
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { employeeId } = await context.params;
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        clientId: true,
        employeeCode: true,
        hasHistoricalPayroll: true,
      },
    });

    if (!employee) {
      return NextResponse.json({ errorCode: "EMPLOYEE_NOT_FOUND" }, { status: 404 });
    }

    assertClientActionAllowed(actor, "editEmployee", employee.clientId);

    if (employee.hasHistoricalPayroll) {
      await prisma.auditLog.create({
        data: {
          action: "EMPLOYEE_DELETE_REJECTED",
          objectType: "EMPLOYEE",
          objectId: employee.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: employee.clientId,
          metadata: { reason: "HAS_HISTORICAL_PAYROLL", employeeCode: employee.employeeCode },
        },
      });
      return NextResponse.json(
        { errorCode: "EMPLOYEE_WITH_HISTORY_CANNOT_BE_DELETED" },
        { status: 409 },
      );
    }

    await prisma.employee.delete({ where: { id: employee.id } });
    return NextResponse.json({ deleted: true });
  });
}
