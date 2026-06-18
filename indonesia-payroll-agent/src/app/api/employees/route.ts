import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import {
  assertClientActionAllowed,
  isSystemAdmin,
  type ActorContext,
} from "@/domain/auth/permissions";
import {
  maskEmployeeSensitiveFields,
  SENSITIVE_EMPLOYEE_FIELDS,
  type SensitiveEmployeeField,
} from "@/domain/employees/employee-service";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const createEmployeeSchema = z.object({
  clientId: z.string().min(1),
  employeeCode: z.string().min(1).max(80),
  fullName: z.string().min(1).max(160),
});

function scopedClientFilter(actor: ActorContext, clientId: string | null) {
  if (clientId) {
    assertClientActionAllowed(actor, "viewEmployee", clientId);
    return clientId;
  }

  if (isSystemAdmin(actor)) {
    return undefined;
  }

  return actor.authorizedClientIds;
}

function sensitiveFieldFromParam(value: string | null): SensitiveEmployeeField | null {
  if (!value) {
    return null;
  }

  return SENSITIVE_EMPLOYEE_FIELDS.includes(value as SensitiveEmployeeField)
    ? (value as SensitiveEmployeeField)
    : null;
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const revealField = sensitiveFieldFromParam(searchParams.get("revealField"));
    const employeeId = searchParams.get("employeeId")?.trim();

    if (revealField && employeeId) {
      return revealEmployeeField(request, actor, employeeId, revealField);
    }

    const clientScope = scopedClientFilter(actor, searchParams.get("clientId"));
    const query = searchParams.get("q")?.trim();
    const employees = await prisma.employee.findMany({
      where: {
        clientId: Array.isArray(clientScope)
          ? { in: clientScope }
          : clientScope
            ? clientScope
            : undefined,
        OR: query
          ? [
              { employeeCode: { contains: query, mode: "insensitive" } },
              { fullName: { contains: query, mode: "insensitive" } },
              { nikOrPassport: { contains: query, mode: "insensitive" } },
              { npwp: { contains: query, mode: "insensitive" } },
            ]
          : undefined,
      },
      include: {
        client: { select: { code: true, name: true } },
        masterVersions: {
          orderBy: { versionNumber: "desc" },
          take: 2,
        },
      },
      orderBy: [{ clientId: "asc" }, { employeeCode: "asc" }],
      take: 100,
    });

    return NextResponse.json({
      employees: employees.map((employee) => ({
        ...maskEmployeeSensitiveFields(employee),
        client: employee.client,
        masterVersions: employee.masterVersions,
      })),
    });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = createEmployeeSchema.parse(await request.json());
    assertClientActionAllowed(actor, "editEmployee", body.clientId);

    const employee = await prisma.employee.create({
      data: {
        clientId: body.clientId,
        employeeCode: body.employeeCode.trim(),
        fullName: body.fullName.trim(),
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "EMPLOYEE_CREATED",
        objectType: "EMPLOYEE",
        objectId: employee.id,
        riskLevel: "R1",
        ...auditFields,
        clientId: employee.clientId,
        metadata: { employeeCode: employee.employeeCode },
      },
    });

    return NextResponse.json({ employee: maskEmployeeSensitiveFields(employee) }, { status: 201 });
  });
}

async function revealEmployeeField(
  request: NextRequest,
  actor: ActorContext,
  employeeId: string,
  field: SensitiveEmployeeField,
) {
  const purpose = request.nextUrl.searchParams.get("purpose")?.trim();
  const confirmed = request.nextUrl.searchParams.get("confirmed") === "on";
  const auditFields = await requestAuditFields(actor, request.headers);
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
  });

  if (!employee) {
    return NextResponse.json({ errorCode: "EMPLOYEE_NOT_FOUND" }, { status: 404 });
  }

  assertClientActionAllowed(actor, "viewSensitive", employee.clientId);

  if (!confirmed) {
    return NextResponse.json(
      { errorCode: "SENSITIVE_REVEAL_CONFIRMATION_REQUIRED" },
      { status: 400 },
    );
  }

  if (!purpose || purpose.length < 8) {
    return NextResponse.json(
      { errorCode: "SENSITIVE_REVEAL_PURPOSE_REQUIRED" },
      { status: 400 },
    );
  }

  await prisma.auditLog.create({
    data: {
      action: "SENSITIVE_FIELD_REVEALED",
      objectType: "SENSITIVE_FIELD",
      objectId: `${employee.id}:${field}`,
      riskLevel: "R1",
      ...auditFields,
      clientId: employee.clientId,
      purpose,
      metadata: {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        field,
      },
    },
  });

  return NextResponse.json({
    employeeId: employee.id,
    field,
    value: employee[field],
  }, {
    headers: { "Cache-Control": "no-store" },
  });
}
