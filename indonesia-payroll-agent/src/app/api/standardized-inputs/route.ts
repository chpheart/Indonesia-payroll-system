import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed, isSystemAdmin } from "@/domain/auth/permissions";
import {
  EVIDENCE_STATUSES,
  REVIEWABLE_STANDARDIZED_INPUT_STATUSES,
  assertReviewableStandardizedInputStatus,
  validateStandardizedInputReferences,
} from "@/domain/standardization/standardization-policy";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonArray, toInputJsonObject, toInputJsonValue } from "@/lib/json/input-json";

export const dynamic = "force-dynamic";

const createPreviewSchema = z.object({
  action: z.literal("createPreview"),
  clientId: z.string().min(1),
  runId: z.string().min(1),
  fieldMappingVersionId: z.string().min(1).optional(),
  employeeId: z.string().min(1).optional(),
  employeeMatchCandidateId: z.string().min(1).optional(),
  payrollComponentId: z.string().min(1).optional(),
  rawInputItemId: z.string().min(1).optional(),
  fileVersionId: z.string().min(1).optional(),
  sheetId: z.string().min(1).optional(),
  sourceCellId: z.string().min(1).optional(),
  standardField: z.string().min(1).max(120),
  componentCode: z.string().max(80).optional(),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  currencyCode: z.string().min(3).max(3).default("IDR"),
  value: z.record(z.string(), z.unknown()).default({}),
  sourceSheetName: z.string().max(120).optional(),
  sourceRowIndex: z.number().int().nonnegative().optional(),
  storeCode: z.string().max(80).optional(),
  storeName: z.string().max(120).optional(),
  evidenceStatus: z.enum(EVIDENCE_STATUSES).default("MISSING"),
  evidenceRefs: z.array(z.string().min(1)).default([]),
});

const confirmSchema = z.object({
  action: z.literal("confirm"),
  inputId: z.string().min(1),
  expectedLockVersion: z.number().int().positive(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  value: z.record(z.string(), z.unknown()).optional(),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
});

const postSchema = z.discriminatedUnion("action", [createPreviewSchema, confirmSchema]);

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const runId = searchParams.get("runId")?.trim() || undefined;
    const clientId = searchParams.get("clientId")?.trim() || undefined;
    const status = searchParams.get("status")?.trim() || undefined;
    if (!runId && !clientId && !isSystemAdmin(actor)) {
      throw new Error("STANDARDIZED_INPUT_SCOPE_REQUIRED");
    }
    if (runId) {
      const run = await prisma.payrollRun.findUnique({ where: { id: runId }, select: { clientId: true } });
      if (!run) {
        throw new Error("PAYROLL_RUN_NOT_FOUND");
      }
      assertClientActionAllowed(actor, "viewClient", run.clientId);
    }
    if (clientId) {
      assertClientActionAllowed(actor, "viewClient", clientId);
    }

    const standardizedInputs = await prisma.standardizedPayrollInput.findMany({
      where: {
        runId,
        clientId,
        status: status as "PREVIEW" | "CONFIRMED" | "BLOCKED" | "INVALIDATED" | undefined,
      },
      include: {
        employee: { select: { id: true, employeeCode: true, fullName: true } },
        employeeMatchCandidate: { select: { id: true, matchMethod: true, confidence: true, status: true } },
        fieldMappingVersion: { select: { id: true, sourceColumnLabel: true, targetField: true } },
      },
      orderBy: [{ status: "asc" }, { sourceSheetName: "asc" }, { sourceRowIndex: "asc" }],
      take: 200,
    });

    return NextResponse.json({ standardizedInputs });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = postSchema.parse(await request.json());

	    if (body.action === "createPreview") {
	      const run = await requireWritableRun(body.runId, body.clientId);
	      assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);
	      const issues = await validateStandardizedInput({
	        clientId: body.clientId,
	        runId: body.runId,
	        fieldMappingVersionId: body.fieldMappingVersionId,
	        employeeMatchCandidateId: body.employeeMatchCandidateId,
	        standardField: body.standardField,
	        evidenceRefs: body.evidenceRefs,
	        evidenceStatus: body.evidenceStatus,
	      });
      const status = issues.some((issue) => issue.severity === "BLOCKING") ? "BLOCKED" : "PREVIEW";
      const created = await prisma.$transaction(async (tx) => {
        const input = await tx.standardizedPayrollInput.create({
          data: {
            clientId: body.clientId,
            runId: body.runId,
            fieldMappingVersionId: body.fieldMappingVersionId,
            employeeId: body.employeeId,
            employeeMatchCandidateId: body.employeeMatchCandidateId,
            payrollComponentId: body.payrollComponentId,
            rawInputItemId: body.rawInputItemId,
            fileVersionId: body.fileVersionId,
            sheetId: body.sheetId,
            sourceCellId: body.sourceCellId,
            status,
            standardField: body.standardField,
            componentCode: body.componentCode,
            amount: body.amount,
            currencyCode: body.currencyCode,
            value: toInputJsonObject(body.value),
            sourceSheetName: body.sourceSheetName,
            sourceRowIndex: body.sourceRowIndex,
            storeCode: body.storeCode,
            storeName: body.storeName,
            evidenceStatus: body.evidenceStatus,
            evidenceRefs: body.evidenceRefs,
            validationIssues: toInputJsonArray(issues),
            modifiedById: auditFields.actorUserId,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "STANDARDIZED_INPUT_PREVIEW_CREATED",
            objectType: "STANDARDIZED_PAYROLL_INPUT",
            objectId: input.id,
            riskLevel: status === "BLOCKED" ? "R3" : "R2",
            ...auditFields,
            clientId: input.clientId,
            runId: input.runId,
            metadata: { status, issueCodes: issues.map((issue) => issue.code) },
          },
        });
        return input;
      });
      return NextResponse.json({ standardizedInput: created }, { status: 201 });
    }

    const current = await prisma.standardizedPayrollInput.findUnique({
      where: { id: body.inputId },
      include: { payrollRun: { select: { clientId: true, status: true, lockedAt: true } } },
    });
    if (!current) {
      throw new Error("STANDARDIZED_INPUT_NOT_FOUND");
    }
    await assertWritableRun(current.payrollRun);
    assertClientActionAllowed(actor, "updatePayrollRun", current.clientId);
    assertReviewableStandardizedInputStatus(current.status);
    if (current.optimisticLockVersion !== body.expectedLockVersion) {
      throw new Error("STANDARDIZED_INPUT_STALE_VERSION");
    }
    const evidenceRefs = body.evidenceRefs ?? current.evidenceRefs;
    const evidenceStatus = evidenceRefs.length > 0 ? "VALID" : current.evidenceStatus;
    const issues = await validateStandardizedInput({
      clientId: current.clientId,
      runId: current.runId,
      fieldMappingVersionId: current.fieldMappingVersionId ?? undefined,
      employeeMatchCandidateId: current.employeeMatchCandidateId ?? undefined,
      standardField: current.standardField,
      evidenceRefs,
      evidenceStatus,
    });
    if (issues.some((issue) => issue.severity === "BLOCKING")) {
      throw new Error("STANDARDIZED_INPUT_BLOCKING_ISSUES");
    }

	    const updated = await prisma.$transaction(async (tx) => {
	      const updateResult = await tx.standardizedPayrollInput.updateMany({
	        where: {
	          id: current.id,
	          optimisticLockVersion: body.expectedLockVersion,
	          status: { in: [...REVIEWABLE_STANDARDIZED_INPUT_STATUSES] },
	        },
	        data: {
	          status: "CONFIRMED",
	          evidenceStatus,
          evidenceRefs,
          value: body.value ? toInputJsonObject(body.value) : toInputJsonValue(current.value) ?? {},
          amount: body.amount ?? current.amount,
          validationIssues: toInputJsonArray(issues),
          optimisticLockVersion: current.optimisticLockVersion + 1,
          modifiedById: auditFields.actorUserId,
          confirmedById: auditFields.actorUserId,
	          confirmedAt: new Date(),
	        },
	      });
	      if (updateResult.count !== 1) {
	        throw new Error("STANDARDIZED_INPUT_STALE_VERSION");
	      }
	      const input = await tx.standardizedPayrollInput.findUnique({ where: { id: current.id } });
	      if (!input) {
	        throw new Error("STANDARDIZED_INPUT_NOT_FOUND");
	      }
	      await tx.auditLog.create({
	        data: {
          action: "STANDARDIZED_INPUT_CONFIRMED",
          objectType: "STANDARDIZED_PAYROLL_INPUT",
          objectId: input.id,
          riskLevel: "R2",
          ...auditFields,
          clientId: input.clientId,
          runId: input.runId,
          metadata: {
            standardField: input.standardField,
            optimisticLockVersion: input.optimisticLockVersion,
          },
        },
      });
      return input;
    });

    return NextResponse.json({ standardizedInput: updated });
  });
}

async function validateStandardizedInput(input: {
  clientId: string;
  runId: string;
  fieldMappingVersionId?: string;
  employeeMatchCandidateId?: string;
  standardField: string;
  evidenceRefs: string[];
  evidenceStatus: "VALID" | "MISSING" | "STALE";
}) {
  const [mapping, match] = await Promise.all([
    input.fieldMappingVersionId
      ? prisma.fieldMappingVersion.findUnique({ where: { id: input.fieldMappingVersionId } })
      : null,
    input.employeeMatchCandidateId
      ? prisma.employeeMatchCandidate.findUnique({ where: { id: input.employeeMatchCandidateId } })
      : null,
  ]);
  return validateStandardizedInputReferences({
    ...input,
    fieldMappingVersion: mapping,
    employeeMatchCandidate: match,
  });
}

async function requireWritableRun(runId: string, expectedClientId: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    select: { id: true, clientId: true, status: true, lockedAt: true },
  });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  if (run.clientId !== expectedClientId) {
    throw new Error("STANDARDIZED_INPUT_RUN_SCOPE_MISMATCH");
  }
  await assertWritableRun(run);
  return run;
}

async function assertWritableRun(run: { status: string; lockedAt?: Date | null }) {
  if (["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(run.status) || run.lockedAt) {
    throw new Error("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
  }
}
