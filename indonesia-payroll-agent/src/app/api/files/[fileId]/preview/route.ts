import { NextResponse, type NextRequest } from "next/server";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import {
  assertClientActionAllowed,
  isSystemAdmin,
  PermissionDeniedError,
} from "@/domain/auth/permissions";
import { handleApi } from "@/app/api/_utils/errors";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

type RouteProps = {
  params: Promise<{ fileId: string }>;
};

export async function GET(request: NextRequest, { params }: RouteProps) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { fileId } = await params;
    const fileVersion = await prisma.uploadedFileVersion.findUnique({
      where: { id: fileId },
      include: {
        client: { select: { id: true, code: true, name: true } },
        payrollRun: { select: { id: true, clientId: true, payrollMonth: true } },
        rawInputItem: {
          select: { id: true, redactedSummary: true, status: true, createdById: true },
        },
        workbookParses: {
          orderBy: { startedAt: "desc" },
          take: 1,
          include: {
            sheets: { orderBy: { sheetIndex: "asc" } },
            cells: {
              where: { formulaText: { not: null } },
              orderBy: [{ sheetName: "asc" }, { rowIndex: "asc" }, { columnIndex: "asc" }],
              take: 50,
            },
          },
        },
      },
    });

    if (!fileVersion) {
      throw new Error("FILE_VERSION_NOT_FOUND");
    }

    const clientId = fileVersion.clientId ?? fileVersion.payrollRun?.clientId;
    if (clientId) {
      assertClientActionAllowed(actor, "viewClient", clientId);
    } else if (
      !isSystemAdmin(actor) &&
      fileVersion.uploadedById !== actor.id &&
      fileVersion.rawInputItem?.createdById !== actor.id
    ) {
      throw new PermissionDeniedError("FILE_PREVIEW_UNASSIGNED_NOT_OWNED");
    }

    const latestParse = fileVersion.workbookParses[0];
    return NextResponse.json({
      file: {
        id: fileVersion.id,
        rawInputItemId: fileVersion.rawInputItemId,
        fileName: fileVersion.fileName,
        purpose: fileVersion.purpose,
        versionNumber: fileVersion.versionNumber,
        parseStatus: fileVersion.parseStatus,
        parseErrorCode: fileVersion.parseErrorCode,
        parseErrorMessage: fileVersion.parseErrorMessage,
        riskFlags: fileVersion.riskFlags,
        sha256: fileVersion.sha256,
        sizeBytes: fileVersion.sizeBytes,
        client: fileVersion.client,
        payrollRun: fileVersion.payrollRun,
        rawInputItem: fileVersion.rawInputItem
          ? {
              id: fileVersion.rawInputItem.id,
              redactedSummary: fileVersion.rawInputItem.redactedSummary,
              status: fileVersion.rawInputItem.status,
            }
          : null,
      },
      preview: latestParse
        ? {
            id: latestParse.id,
            status: latestParse.status,
            parserVersion: latestParse.parserVersion,
            workbookName: latestParse.workbookName,
            sheetCount: latestParse.sheetCount,
            formulaCellCount: latestParse.formulaCellCount,
            mergedRangeCount: latestParse.mergedRangeCount,
            externalLinkCount: latestParse.externalLinkCount,
            dangerousContentFlags: latestParse.dangerousContentFlags,
            errorCode: latestParse.errorCode,
            errorMessage: latestParse.errorMessage,
            sheets: latestParse.sheets.map((sheet) => ({
              id: sheet.id,
              sheetName: sheet.sheetName,
              sheetIndex: sheet.sheetIndex,
              rowCount: sheet.rowCount,
              columnCount: sheet.columnCount,
              effectiveRange: sheet.effectiveRange,
              headerRowIndex: sheet.headerRowIndex,
              headerValues: sheet.headerValues,
              sampleRows: sheet.sampleRows,
              mergedRanges: sheet.mergedRanges,
              hasHeader: sheet.hasHeader,
              formulaCells: latestParse.cells
                .filter((cell) => cell.sheetId === sheet.id)
                .map((cell) => ({
                  address: cell.address,
                  displayValue: cell.displayValue,
                  formulaText: cell.formulaText,
                })),
            })),
          }
        : null,
    });
  });
}
