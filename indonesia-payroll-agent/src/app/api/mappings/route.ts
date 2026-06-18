import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed, isSystemAdmin } from "@/domain/auth/permissions";
import { CONFIDENCE_BANDS } from "@/domain/changes/change-review-policy";
import { FIELD_MAPPING_SOURCES } from "@/domain/mappings/mapping-service";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonArray } from "@/lib/json/input-json";

export const dynamic = "force-dynamic";

const createCandidateSchema = z.object({
  action: z.literal("createCandidate"),
  clientId: z.string().min(1),
  runId: z.string().min(1),
  rawInputItemId: z.string().min(1).optional(),
  fileVersionId: z.string().min(1).optional(),
  workbookParseId: z.string().min(1).optional(),
  sheetId: z.string().min(1).optional(),
  sourceAgentRunId: z.string().min(1).optional(),
  source: z.enum(FIELD_MAPPING_SOURCES).default("AGENT"),
  sourceSheetName: z.string().min(1).max(120),
  sourceColumnLabel: z.string().min(1).max(120),
  sourceColumnIndex: z.number().int().nonnegative().optional(),
  sampleValues: z.array(z.unknown()).default([]),
  targetField: z.string().min(1).max(120),
  fieldCategory: z.string().min(1).max(80).default("INPUT"),
  confidence: z.enum(CONFIDENCE_BANDS),
  rationale: z.string().min(1).max(1000),
  evidenceRefs: z.array(z.string().min(1)).default([]),
});

const confirmCandidateSchema = z.object({
  action: z.literal("confirmCandidate"),
  candidateId: z.string().min(1),
  targetField: z.string().min(1).max(120).optional(),
  fieldCategory: z.string().min(1).max(80).optional(),
  confidence: z.enum(CONFIDENCE_BANDS).optional(),
  rationale: z.string().min(1).max(1000),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  templateSourceRef: z.string().max(160).optional(),
});

const postSchema = z.discriminatedUnion("action", [createCandidateSchema, confirmCandidateSchema]);

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const runId = searchParams.get("runId")?.trim() || undefined;
    const clientId = searchParams.get("clientId")?.trim() || undefined;
    if (!runId && !clientId && !isSystemAdmin(actor)) {
      throw new Error("FIELD_MAPPING_SCOPE_REQUIRED");
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

    const [candidates, versions] = await Promise.all([
      prisma.fieldMappingCandidate.findMany({
        where: { runId, clientId },
        orderBy: [{ status: "asc" }, { confidence: "asc" }, { createdAt: "desc" }],
        take: 100,
      }),
      prisma.fieldMappingVersion.findMany({
        where: { runId, clientId },
        include: { confirmedBy: { select: { displayName: true, email: true } } },
        orderBy: [{ confirmedAt: "desc" }],
        take: 100,
      }),
    ]);

    return NextResponse.json({ candidates, versions });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = postSchema.parse(await request.json());

    if (body.action === "createCandidate") {
      const run = await requireWritableRun(body.runId, body.clientId);
      assertClientActionAllowed(actor, "updatePayrollRun", run.clientId);
      const candidate = await prisma.$transaction(async (tx) => {
        const created = await tx.fieldMappingCandidate.create({
          data: {
            clientId: body.clientId,
            runId: body.runId,
            rawInputItemId: body.rawInputItemId,
            fileVersionId: body.fileVersionId,
            workbookParseId: body.workbookParseId,
            sheetId: body.sheetId,
            sourceAgentRunId: body.sourceAgentRunId,
            source: body.source,
            sourceSheetName: body.sourceSheetName,
            sourceColumnLabel: body.sourceColumnLabel,
            sourceColumnIndex: body.sourceColumnIndex,
            sampleValues: toInputJsonArray(body.sampleValues),
            targetField: body.targetField,
            fieldCategory: body.fieldCategory,
            confidence: body.confidence,
            rationale: body.rationale,
            evidenceRefs: body.evidenceRefs,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "FIELD_MAPPING_CANDIDATE_CREATED",
            objectType: "FIELD_MAPPING_CANDIDATE",
            objectId: created.id,
            riskLevel: created.confidence === "HIGH" ? "R1" : "R2",
            ...auditFields,
            clientId: created.clientId,
            runId: created.runId,
            metadata: {
              source: created.source,
              confidence: created.confidence,
              inputSummary: "映射候选已创建，人工确认前不得生效",
            },
          },
        });
        return created;
      });
      return NextResponse.json({ candidate }, { status: 201 });
    }

    const candidate = await prisma.fieldMappingCandidate.findUnique({
      where: { id: body.candidateId },
      include: { payrollRun: { select: { clientId: true, status: true, lockedAt: true } } },
    });
    if (!candidate) {
      throw new Error("FIELD_MAPPING_CANDIDATE_NOT_FOUND");
    }
    await assertWritableRun(candidate.payrollRun);
    assertClientActionAllowed(actor, "updatePayrollRun", candidate.clientId);
    if (candidate.status !== "CANDIDATE") {
      throw new Error("FIELD_MAPPING_CANDIDATE_NOT_REVIEWABLE");
    }
    const confidence = body.confidence ?? candidate.confidence;
    if (confidence === "LOW" || confidence === "CONFLICT") {
      throw new Error("LOW_CONFIDENCE_MAPPING_REQUIRES_MANUAL_TARGET");
    }
    const targetField = body.targetField ?? candidate.targetField;

    const result = await prisma.$transaction(async (tx) => {
      const maxVersion = await tx.fieldMappingVersion.aggregate({
        where: {
          runId: candidate.runId,
          sourceSheetName: candidate.sourceSheetName,
          sourceColumnLabel: candidate.sourceColumnLabel,
        },
        _max: { versionNumber: true },
      });
      const version = await tx.fieldMappingVersion.create({
        data: {
          clientId: candidate.clientId,
          runId: candidate.runId,
          candidateId: candidate.id,
          fileVersionId: candidate.fileVersionId,
          sheetId: candidate.sheetId,
          versionNumber: (maxVersion._max.versionNumber ?? 0) + 1,
          source: "MANUAL",
          sourceSheetName: candidate.sourceSheetName,
          sourceColumnLabel: candidate.sourceColumnLabel,
          sourceColumnIndex: candidate.sourceColumnIndex,
          targetField,
          fieldCategory: body.fieldCategory ?? candidate.fieldCategory,
          confidence,
          rationale: body.rationale,
          evidenceRefs: body.evidenceRefs ?? candidate.evidenceRefs,
          templateSourceRef: body.templateSourceRef,
          confirmedById: auditFields.actorUserId,
        },
      });
      const updatedCandidate = await tx.fieldMappingCandidate.update({
        where: { id: candidate.id },
        data: { status: "CONFIRMED" },
      });
      await tx.auditLog.create({
        data: {
          action: "FIELD_MAPPING_VERSION_CONFIRMED",
          objectType: "FIELD_MAPPING_VERSION",
          objectId: version.id,
          riskLevel: "R2",
          ...auditFields,
          clientId: version.clientId,
          runId: version.runId,
          metadata: {
            candidateId: candidate.id,
            targetField: version.targetField,
            inputSummary: "人工确认生成 FieldMappingVersion；模板预填未自动生效",
          },
        },
      });
      return { candidate: updatedCandidate, version };
    });

    return NextResponse.json(result);
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
    throw new Error("FIELD_MAPPING_RUN_SCOPE_MISMATCH");
  }
  await assertWritableRun(run);
  return run;
}

async function assertWritableRun(run: { status: string; lockedAt?: Date | null }) {
  if (["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(run.status) || run.lockedAt) {
    throw new Error("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
  }
}
