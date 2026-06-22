import { NextResponse, type NextRequest } from "next/server";
import { handleApi } from "@/app/api/_utils/errors";
import { evidenceFromRequest } from "@/app/api/evidence/route-form";
import { assertEvidenceCreateScope } from "@/app/api/evidence/route-guards";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed, isSystemAdmin } from "@/domain/auth/permissions";
import { parseCoverageScopeJson } from "@/domain/confirmation-packs/pack-coverage-service";
import { assertEvidenceHasContent } from "@/domain/evidence/evidence-service";
import { hashRawInputContent, summarizeRawInput } from "@/domain/intake/raw-input-redaction";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject } from "@/lib/json/input-json";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const runId = searchParams.get("runId")?.trim() || undefined;
    const clientId = searchParams.get("clientId")?.trim() || undefined;

    if (!runId && !clientId && !isSystemAdmin(actor)) {
      throw new Error("EVIDENCE_SCOPE_REQUIRED");
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

    const evidence = await prisma.evidence.findMany({
      where: { clientId, runId },
      select: {
        id: true,
        clientId: true,
        runId: true,
        rawInputItemId: true,
        fileVersionId: true,
        kind: true,
        sourceChannel: true,
        status: true,
        redactedSummary: true,
        attachmentKey: true,
        attachmentFileName: true,
        attachmentMimeType: true,
        attachmentSizeBytes: true,
        contentHash: true,
        applicableMonth: true,
        sourceLabel: true,
        coverageScopeType: true,
        coverageScope: true,
        notes: true,
        uploadedById: true,
        confirmedById: true,
        confirmedAt: true,
        voidedAt: true,
        createdAt: true,
        updatedAt: true,
        links: { orderBy: { linkedAt: "desc" } },
        uploadedBy: { select: { displayName: true, email: true } },
        confirmedBy: { select: { displayName: true, email: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 100,
    });

    return NextResponse.json({ evidence });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = await evidenceFromRequest(request);
    const run = body.runId
      ? await prisma.payrollRun.findUnique({
          where: { id: body.runId },
          select: { clientId: true, payrollMonth: true, status: true, lockedAt: true },
        })
      : null;

    if (body.runId && !run) {
      throw new Error("PAYROLL_RUN_NOT_FOUND");
    }
    if (run && run.clientId !== body.clientId) {
      throw new Error("EVIDENCE_RUN_SCOPE_MISMATCH");
    }
    if (run && (["LOCKED", "EXPORTED", "ARCHIVED", "VOIDED", "CORRECTED"].includes(run.status) || run.lockedAt)) {
      throw new Error("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    }
    assertClientActionAllowed(actor, "updatePayrollRun", body.clientId);
    assertEvidenceHasContent(body);

    const coverageScope = parseCoverageScopeJson(body.coverageScope);
    const links = body.links.map((link) => ({
      ...link,
      clientId: link.clientId || body.clientId,
      runId: link.runId || body.runId,
      coverageScope: parseCoverageScopeJson(link.coverageScope),
    }));
    await assertEvidenceCreateScope({
      db: prisma,
      clientId: body.clientId,
      runId: body.runId,
      rawInputItemId: body.rawInputItemId,
      fileVersionId: body.fileVersionId,
      coverageScope,
      links,
    });
    const created = await prisma.$transaction(async (tx) => {
      const evidence = await tx.evidence.create({
        data: {
          clientId: body.clientId,
          runId: body.runId,
          rawInputItemId: body.rawInputItemId,
          fileVersionId: body.fileVersionId,
          kind: body.kind,
          sourceChannel: body.sourceChannel,
          redactedSummary:
            body.redactedSummary ??
            summarizeRawInput(body.contentText ?? body.attachmentFileName ?? body.sourceLabel),
          contentText: body.contentText,
          attachmentKey: body.attachmentKey,
          attachmentFileName: body.attachmentFileName,
          attachmentMimeType: body.attachmentMimeType,
          attachmentSizeBytes: body.attachmentSizeBytes,
          contentHash: body.contentHash ?? (body.contentText ? hashRawInputContent(body.contentText) : undefined),
          applicableMonth: body.applicableMonth ?? run?.payrollMonth,
          sourceLabel: body.sourceLabel,
          coverageScopeType: coverageScope.type,
          coverageScope: toInputJsonObject(coverageScope),
          notes: body.notes,
          uploadedById: auditFields.actorUserId,
        },
      });
      const evidenceLinks = await Promise.all(
        links.map((link) =>
          tx.evidenceLink.create({
            data: {
              evidenceId: evidence.id,
              clientId: link.clientId,
              runId: link.runId,
              objectType: link.objectType,
              objectId: link.objectId,
              objectLabel: link.objectLabel,
              targetField: link.targetField,
              coverageScopeType: link.coverageScope.type,
              coverageScope: toInputJsonObject(link.coverageScope),
              linkedById: auditFields.actorUserId,
            },
          }),
        ),
      );
      await tx.auditLog.create({
        data: {
          action: "EVIDENCE_CREATED",
          objectType: "EVIDENCE",
          objectId: evidence.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: evidence.clientId,
          runId: evidence.runId,
          metadata: {
            kind: evidence.kind,
            sourceLabel: evidence.sourceLabel,
            linkCount: evidenceLinks.length,
            inputSummary: "证据已保存并关联对象，不自动改写工资结果或客户结论",
          },
        },
      });
      await tx.auditLog.createMany({
        data: evidenceLinks.map((link) => ({
          action: "EVIDENCE_LINKED" as const,
          objectType: "EVIDENCE_LINK" as const,
          objectId: link.id,
          riskLevel: "R1" as const,
          ...auditFields,
          clientId: link.clientId,
          runId: link.runId,
          metadata: {
            evidenceId: evidence.id,
            objectType: link.objectType,
            objectId: link.objectId,
            targetField: link.targetField ?? "",
          },
        })),
      });
      return { evidence, links: evidenceLinks };
    });

    return NextResponse.json(created, { status: 201 });
  });
}
