import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed, isSystemAdmin, type ActorContext } from "@/domain/auth/permissions";
import { assertPayrollMonth } from "@/domain/payroll-runs/run-service";
import { normalizeCurrencyCode } from "@/domain/fx/fx-rate-service";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonArray } from "@/lib/json/input-json";

export const dynamic = "force-dynamic";

const employeeOverrideSchema = z.object({
  employeeId: z.string().min(1),
  rate: z.coerce.number().positive(),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  reason: z.string().min(1).max(500),
});

const fxRateSchema = z.object({
  clientId: z.string().min(1),
  payrollMonth: z.string().min(7).max(7),
  currencyCode: z.string().min(3).max(3),
  rate: z.coerce.number().positive(),
  employeeOverrides: z.array(employeeOverrideSchema).default([]),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  sourceLabel: z.string().min(1).max(200),
  changeReason: z.string().min(1).max(1000),
});

const confirmSchema = z.object({
  action: z.literal("confirm"),
  fxRateVersionId: z.string().min(1),
  confirmationText: z.literal("CONFIRM_FX"),
});

function assertStoredOverridesHaveEvidence(value: unknown) {
  z.array(employeeOverrideSchema).parse(value);
}

function readableFXWhere(actor: ActorContext, clientId?: string) {
  if (clientId) {
    assertClientActionAllowed(actor, "viewClient", clientId);
    return { clientId };
  }
  return isSystemAdmin(actor) ? undefined : { clientId: { in: actor.authorizedClientIds } };
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const clientId = request.nextUrl.searchParams.get("clientId")?.trim() || undefined;
    const fxRates = await prisma.fXRateVersion.findMany({
      where: readableFXWhere(actor, clientId),
      include: { client: { select: { code: true, name: true } } },
      orderBy: [{ payrollMonth: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    return NextResponse.json({ fxRates });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = fxRateSchema.parse(await request.json());
    assertClientActionAllowed(actor, "configureRules", body.clientId);
    assertPayrollMonth(body.payrollMonth);
    const currencyCode = normalizeCurrencyCode(body.currencyCode);
    const latest = await prisma.fXRateVersion.findFirst({
      where: { clientId: body.clientId, payrollMonth: body.payrollMonth, currencyCode },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const fxRate = await prisma.fXRateVersion.create({
      data: {
        clientId: body.clientId,
        payrollMonth: body.payrollMonth,
        currencyCode,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        rate: body.rate,
        employeeOverrides: toInputJsonArray(body.employeeOverrides),
        evidenceRefs: body.evidenceRefs,
        sourceLabel: body.sourceLabel.trim(),
        changeReason: body.changeReason.trim(),
        createdById: auditFields.actorUserId,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "FX_RATE_VERSION_CREATED",
        objectType: "FX_RATE_VERSION",
        objectId: fxRate.id,
        riskLevel: "R2",
        ...auditFields,
        clientId: fxRate.clientId,
        metadata: {
          payrollMonth: fxRate.payrollMonth,
          currencyCode: fxRate.currencyCode,
          versionNumber: fxRate.versionNumber,
          inputSummary: "API 创建汇率草稿，不允许直接用于正式算薪",
          outputSummary: "DRAFT 汇率已保存，确认前预检查阻断",
        },
      },
    });

    return NextResponse.json({ fxRate }, { status: 201 });
  });
}

export async function PATCH(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = confirmSchema.parse(await request.json());
    const fxRate = await prisma.fXRateVersion.findUnique({
      where: { id: body.fxRateVersionId },
    });
    if (!fxRate) {
      throw new Error("FX_RATE_VERSION_NOT_FOUND");
    }
    assertClientActionAllowed(actor, "approveRules", fxRate.clientId);
    if (fxRate.evidenceRefs.length === 0) {
      throw new Error("FX_RATE_EVIDENCE_REQUIRED");
    }
    assertStoredOverridesHaveEvidence(fxRate.employeeOverrides);

    const [updated] = await prisma.$transaction([
      prisma.fXRateVersion.update({
        where: { id: fxRate.id },
        data: {
          status: "CONFIRMED",
          confirmedById: auditFields.actorUserId,
          confirmedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "FX_RATE_VERSION_CONFIRMED",
          objectType: "FX_RATE_VERSION",
          objectId: fxRate.id,
          riskLevel: "R2",
          ...auditFields,
          clientId: fxRate.clientId,
          metadata: {
            payrollMonth: fxRate.payrollMonth,
            currencyCode: fxRate.currencyCode,
            versionNumber: fxRate.versionNumber,
            outputSummary: "API 确认汇率版本，可被预检查和算薪快照引用",
          },
        },
      }),
    ]);

    return NextResponse.json({ fxRate: updated });
  });
}
