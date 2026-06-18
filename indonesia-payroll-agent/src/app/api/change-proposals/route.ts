import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import { AUDIT_RISK_LEVELS } from "@/domain/audit/audit-service";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed, isSystemAdmin } from "@/domain/auth/permissions";
import {
  CHANGE_PROPOSAL_SOURCES,
  CHANGE_PROPOSAL_STATUSES,
  CHANGE_PROPOSAL_TYPES,
  CONFIDENCE_BANDS,
} from "@/domain/changes/change-review-policy";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject } from "@/lib/json/input-json";

export const dynamic = "force-dynamic";

const createProposalSchema = z.object({
  clientId: z.string().min(1),
  runId: z.string().min(1),
  rawInputItemId: z.string().min(1).optional(),
  sourceAgentRunId: z.string().min(1).optional(),
  targetEmployeeId: z.string().min(1).optional(),
  source: z.enum(CHANGE_PROPOSAL_SOURCES),
  proposalType: z.enum(CHANGE_PROPOSAL_TYPES),
  targetObjectType: z.string().min(1).max(80),
  targetObjectId: z.string().max(120).optional(),
  targetField: z.string().min(1).max(120),
  previousValue: z.record(z.string(), z.unknown()).default({}),
  proposedValue: z.record(z.string(), z.unknown()),
  effectiveFrom: z.string().min(7).max(32),
  effectiveTo: z.string().max(32).optional(),
  riskLevel: z.enum(AUDIT_RISK_LEVELS),
  confidence: z.enum(CONFIDENCE_BANDS),
  reason: z.string().min(1).max(1000),
  differencePreview: z.record(z.string(), z.unknown()).default({}),
  evidenceRefs: z.array(z.string().min(1)).min(1),
  requiredEvidenceRefs: z.array(z.string().min(1)).default([]),
  relatedProposalIds: z.array(z.string().min(1)).default([]),
});

const statusSchema = z.enum(CHANGE_PROPOSAL_STATUSES);

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const runId = searchParams.get("runId")?.trim() || undefined;
    const clientId = searchParams.get("clientId")?.trim() || undefined;
    const statusValue = searchParams.get("status")?.trim() || undefined;
    const status = statusValue ? statusSchema.parse(statusValue) : undefined;

    if (!runId && !clientId && !isSystemAdmin(actor)) {
      throw new Error("CHANGE_PROPOSAL_SCOPE_REQUIRED");
    }

    if (runId) {
      const run = await prisma.payrollRun.findUnique({
        where: { id: runId },
        select: { clientId: true },
      });
      if (!run) {
        throw new Error("PAYROLL_RUN_NOT_FOUND");
      }
      assertClientActionAllowed(actor, "viewClient", run.clientId);
    }
    if (clientId) {
      assertClientActionAllowed(actor, "viewClient", clientId);
    }

    const proposals = await prisma.changeProposal.findMany({
      where: { runId, clientId, status },
      include: {
        rawInputItem: { select: { id: true, redactedSummary: true, sourceChannel: true } },
        targetEmployee: { select: { id: true, employeeCode: true, fullName: true } },
        ledgerEntry: { select: { id: true, reviewedAt: true, formalObjectVersionRef: true } },
      },
      orderBy: [{ riskLevel: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    return NextResponse.json({ proposals });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = createProposalSchema.parse(await request.json());
    const run = await prisma.payrollRun.findUnique({
      where: { id: body.runId },
      select: { id: true, clientId: true, status: true, lockedAt: true },
    });
    if (!run) {
      throw new Error("PAYROLL_RUN_NOT_FOUND");
    }
    if (run.clientId !== body.clientId) {
      throw new Error("CHANGE_PROPOSAL_RUN_SCOPE_MISMATCH");
    }
    if (["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(run.status) || run.lockedAt) {
      throw new Error("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    assertClientActionAllowed(actor, "updatePayrollRun", body.clientId);

    if (body.rawInputItemId) {
      const rawInput = await prisma.rawInputItem.findUnique({
        where: { id: body.rawInputItemId },
        select: { id: true, clientId: true, runId: true },
      });
      if (!rawInput) {
        throw new Error("RAW_INPUT_NOT_FOUND");
      }
      if (rawInput.clientId !== body.clientId || rawInput.runId !== body.runId) {
        throw new Error("CHANGE_PROPOSAL_RAW_INPUT_SCOPE_MISMATCH");
      }
    }

    const proposal = await prisma.$transaction(async (tx) => {
      const created = await tx.changeProposal.create({
        data: {
          clientId: body.clientId,
          runId: body.runId,
          rawInputItemId: body.rawInputItemId,
          sourceAgentRunId: body.sourceAgentRunId,
          createdById: auditFields.actorUserId,
          targetEmployeeId: body.targetEmployeeId,
          source: body.source,
          proposalType: body.proposalType,
          targetObjectType: body.targetObjectType,
          targetObjectId: body.targetObjectId,
          targetField: body.targetField,
          previousValue: toInputJsonObject(body.previousValue),
          proposedValue: toInputJsonObject(body.proposedValue),
          effectiveFrom: body.effectiveFrom,
          effectiveTo: body.effectiveTo,
          riskLevel: body.riskLevel,
          confidence: body.confidence,
          reason: body.reason,
          differencePreview: toInputJsonObject(body.differencePreview),
          evidenceRefs: body.evidenceRefs,
          requiredEvidenceRefs: body.requiredEvidenceRefs,
          relatedProposalIds: body.relatedProposalIds,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CHANGE_PROPOSAL_CREATED",
          objectType: "CHANGE_PROPOSAL",
          objectId: created.id,
          riskLevel: created.riskLevel,
          ...auditFields,
          clientId: created.clientId,
          runId: created.runId,
          metadata: {
            proposalType: created.proposalType,
            source: created.source,
            inputSummary: "ChangeProposal 候选已创建，未审核前不得写入正式 ledger",
          },
        },
      });
      return created;
    });

    return NextResponse.json({ proposal }, { status: 201 });
  });
}
