import { NextResponse, type NextRequest } from "next/server";
import { handleApi } from "@/app/api/_utils/errors";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { assertClientActionAllowed } from "@/domain/auth/permissions";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { getObject } from "@/lib/storage/local-file-store";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ evidenceId: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const { evidenceId } = await context.params;
    const evidence = await prisma.evidence.findUnique({
      where: { id: evidenceId },
      select: {
        id: true,
        clientId: true,
        runId: true,
        kind: true,
        redactedSummary: true,
        attachmentKey: true,
        attachmentMimeType: true,
        attachmentFileName: true,
      },
    });
    if (!evidence || !evidence.attachmentKey) {
      throw new Error("EVIDENCE_FILE_NOT_FOUND");
    }
    assertClientActionAllowed(actor, "viewSensitive", evidence.clientId);

    const file = await getObject(evidence.attachmentKey);
    await prisma.auditLog.create({
      data: {
        action: "EVIDENCE_FILE_VIEWED",
        objectType: "EVIDENCE",
        objectId: evidence.id,
        riskLevel: "R1",
        ...auditFields,
        clientId: evidence.clientId,
        runId: evidence.runId,
        metadata: {
          kind: evidence.kind,
          redactedSummary: evidence.redactedSummary,
          attachmentFileName: evidence.attachmentFileName ?? "",
          attachmentMimeType: evidence.attachmentMimeType ?? "",
        },
      },
    });
    const body = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "content-type": evidence.attachmentMimeType ?? "application/octet-stream",
        "content-disposition": `inline; filename="${encodeURIComponent(evidence.attachmentFileName ?? "evidence")}"`,
        "cache-control": "private, max-age=60",
      },
    });
  });
}
