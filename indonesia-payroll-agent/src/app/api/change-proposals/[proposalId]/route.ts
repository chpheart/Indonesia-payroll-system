import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { handleApi } from "@/app/api/_utils/errors";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import {
  assertProposalCanBeApproved,
  CONFIDENCE_BANDS,
} from "@/domain/changes/change-review-policy";
import {
  assertRelatedProposalScope,
  CLOSE_CHANGE_PROPOSAL_ACTIONS,
  CLOSE_CHANGE_PROPOSAL_STATUS,
  closeActionRequiresRelatedProposalLookup,
  formalObjectReferenceForProposal,
} from "@/domain/changes/change-review-workflow";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject, toInputJsonValue } from "@/lib/json/input-json";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ proposalId: string }>;
};

const approveSchema = z.object({
  action: z.literal("approve"),
  reviewNote: z.string().min(1).max(1000),
  proposedValue: z.record(z.string(), z.unknown()).optional(),
  evidenceRefs: z.array(z.string().min(1)).optional(),
  confidence: z.enum(CONFIDENCE_BANDS).optional(),
  formalObjectType: z.string().max(80).optional(),
  formalObjectId: z.string().max(120).optional(),
  formalObjectVersionRef: z.string().max(160).optional(),
});

const closeSchema = z.object({
  action: z.enum(CLOSE_CHANGE_PROPOSAL_ACTIONS),
  reviewNote: z.string().min(1).max(1000),
  relatedProposalIds: z.array(z.string().min(1)).optional(),
});

const patchSchema = z.discriminatedUnion("action", [approveSchema, closeSchema]);

export async function GET(request: NextRequest, { params }: RouteProps) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { proposalId } = await params;
    const proposal = await prisma.changeProposal.findUnique({
      where: { id: proposalId },
      include: {
        rawInputItem: { select: { id: true, redactedSummary: true, evidenceCandidateRefs: true } },
        targetEmployee: { select: { id: true, employeeCode: true, fullName: true } },
        ledgerEntry: true,
      },
    });
    if (!proposal) {
      throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
    }
    assertClientActionAllowed(actor, "viewClient", proposal.clientId);

    return NextResponse.json({ proposal });
  });
}

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { proposalId } = await params;
    const body = patchSchema.parse(await request.json());
    const proposal = await prisma.changeProposal.findUnique({
      where: { id: proposalId },
      include: { payrollRun: { select: { clientId: true, status: true, lockedAt: true } } },
    });
    if (!proposal) {
      throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
    }
    if (proposal.status !== "PENDING_REVIEW") {
      throw new Error("CHANGE_PROPOSAL_ALREADY_REVIEWED");
    }
    if (
      ["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(proposal.payrollRun.status) ||
      proposal.payrollRun.lockedAt
    ) {
      throw new Error("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    assertClientActionAllowed(actor, "updatePayrollRun", proposal.clientId);

    if (body.action !== "approve") {
      const relatedProposalIds = body.relatedProposalIds ?? [];
      const relatedProposals = closeActionRequiresRelatedProposalLookup(body.action)
        ? await prisma.changeProposal.findMany({
            where: { id: { in: relatedProposalIds } },
            select: { id: true, clientId: true, runId: true },
          })
        : [];
      assertRelatedProposalScope({
        action: body.action,
        proposalId: proposal.id,
        clientId: proposal.clientId,
        runId: proposal.runId,
        relatedProposalIds,
        relatedProposals,
      });
      const updated = await prisma.$transaction(async (tx) => {
        const closedAt = new Date();
        const closeResult = await tx.changeProposal.updateMany({
          where: { id: proposal.id, status: "PENDING_REVIEW" },
          data: {
            status: CLOSE_CHANGE_PROPOSAL_STATUS[body.action],
            reviewedById: auditFields.actorUserId,
            reviewedAt: closedAt,
            reviewNote: body.reviewNote,
            relatedProposalIds,
          },
        });
        if (closeResult.count !== 1) {
          throw new Error("CHANGE_PROPOSAL_ALREADY_REVIEWED");
        }
        const caseItem =
          body.action === "convertToQuestion"
            ? await tx.caseItem.create({
                data: {
                  clientId: proposal.clientId,
                  runId: proposal.runId,
                  rawInputItemId: proposal.rawInputItemId,
                  type: "MISSING_INFORMATION",
                  riskLevel: proposal.riskLevel,
                  title: "ChangeProposal 转追问",
                  detail: body.reviewNote,
                  metadata: toInputJsonObject({
                    proposalId: proposal.id,
                    targetField: proposal.targetField,
                    source: "CHANGE_PROPOSAL_REVIEW",
                  }),
                },
              })
            : null;
        if (body.action === "convertToQuestion" && proposal.rawInputItemId) {
          await tx.rawInputItem.updateMany({
            where: { id: proposal.rawInputItemId },
            data: { status: "NEEDS_QUESTION" },
          });
        }
        if (body.action === "convertToQuestion") {
          await tx.payrollRun.update({
            where: { id: proposal.runId },
            data: { blockingIssueCount: { increment: 1 } },
          });
        }
        const closed = await tx.changeProposal.findUnique({ where: { id: proposal.id } });
        if (!closed) {
          throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
        }
        await tx.auditLog.create({
          data: {
            action: "CHANGE_PROPOSAL_REVIEWED",
            objectType: "CHANGE_PROPOSAL",
            objectId: proposal.id,
            riskLevel: proposal.riskLevel,
            ...auditFields,
            clientId: proposal.clientId,
            runId: proposal.runId,
            metadata: {
              action: body.action,
              status: closed.status,
              reviewNote: body.reviewNote,
              relatedProposalIds,
              caseItemId: caseItem?.id,
            },
          },
        });
        return closed;
      });
      return NextResponse.json({ proposal: updated });
    }

    const nextEvidenceRefs = body.evidenceRefs ?? proposal.evidenceRefs;
    const nextConfidence = body.confidence ?? proposal.confidence;
    const nextProposedValue = body.proposedValue ?? (proposal.proposedValue as Record<string, unknown>);
    assertProposalCanBeApproved({
      proposalType: proposal.proposalType,
      targetField: proposal.targetField,
      riskLevel: proposal.riskLevel,
      confidence: nextConfidence,
      evidenceRefs: nextEvidenceRefs,
      requiredEvidenceRefs: proposal.requiredEvidenceRefs,
    });

    const result = await prisma.$transaction(async (tx) => {
      const reviewedAt = new Date();
      const updateResult = await tx.changeProposal.updateMany({
        where: { id: proposal.id, status: "PENDING_REVIEW" },
        data: {
          status:
            body.proposedValue || body.evidenceRefs || body.confidence
              ? "APPROVED_WITH_MODIFICATION"
              : "APPROVED",
          reviewedById: auditFields.actorUserId,
          reviewedAt,
          reviewNote: body.reviewNote,
          proposedValue: toInputJsonObject(nextProposedValue),
          evidenceRefs: nextEvidenceRefs,
          confidence: nextConfidence,
        },
      });
      if (updateResult.count !== 1) {
        throw new Error("CHANGE_PROPOSAL_ALREADY_REVIEWED");
      }
      const updated = await tx.changeProposal.findUnique({ where: { id: proposal.id } });
      if (!updated) {
        throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
      }
      const formalObjectRef = formalObjectReferenceForProposal(proposal, body);
      const ledgerEntry = await tx.changeLedgerEntry.create({
        data: {
          proposalId: proposal.id,
          clientId: proposal.clientId,
          runId: proposal.runId,
          reviewedById: auditFields.actorUserId,
          targetEmployeeId: proposal.targetEmployeeId,
          entryType: proposal.proposalType,
          targetObjectType: proposal.targetObjectType,
          targetObjectId: proposal.targetObjectId,
          targetField: proposal.targetField,
          previousValue: toInputJsonValue(proposal.previousValue) ?? {},
          newValue: toInputJsonObject(nextProposedValue),
          effectiveFrom: proposal.effectiveFrom,
          effectiveTo: proposal.effectiveTo,
          riskLevel: proposal.riskLevel,
          evidenceRefs: nextEvidenceRefs,
          formalObjectType: formalObjectRef.formalObjectType,
          formalObjectId: formalObjectRef.formalObjectId,
          formalObjectVersionRef: formalObjectRef.formalObjectVersionRef,
          reviewNote: body.reviewNote,
          reviewedAt,
        },
      });
      await tx.auditLog.createMany({
        data: [
          {
            action: "CHANGE_PROPOSAL_REVIEWED",
            objectType: "CHANGE_PROPOSAL",
            objectId: proposal.id,
            riskLevel: proposal.riskLevel,
            ...auditFields,
            clientId: proposal.clientId,
            runId: proposal.runId,
            metadata: { status: updated.status, reviewNote: body.reviewNote },
          },
          {
            action: "CHANGE_LEDGER_ENTRY_CREATED",
            objectType: "CHANGE_LEDGER_ENTRY",
            objectId: ledgerEntry.id,
            riskLevel: ledgerEntry.riskLevel,
            ...auditFields,
            clientId: proposal.clientId,
            runId: proposal.runId,
            metadata: {
              proposalId: proposal.id,
              targetField: proposal.targetField,
              inputSummary: "人工审核后追加 ChangeLedgerEntry；未审核 proposal 无法生效",
            },
          },
        ],
      });
      return { proposal: updated, ledgerEntry };
    });

    return NextResponse.json(result);
  });
}
