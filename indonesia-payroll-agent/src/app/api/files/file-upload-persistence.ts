import {
  assertClientActionAllowed,
  isSystemAdmin,
  PermissionDeniedError,
  type ActorContext,
} from "@/domain/auth/permissions";
import { hasBlockingSafetyIssue } from "@/domain/excel/excel-safety-policy";
import { type ParsedWorkbook } from "@/domain/excel/excel-parser";
import { type requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export async function nextReplacementVersionNumber(input: {
  replacesFileId: string;
  actor: ActorContext;
  binding: { clientId: string | null; payrollMonth: string | null; runId: string | null };
}): Promise<number> {
  const replaced = await prisma.uploadedFileVersion.findUnique({
    where: { id: input.replacesFileId },
    select: {
      versionNumber: true,
      clientId: true,
      payrollMonth: true,
      runId: true,
      uploadedById: true,
    },
  });
  if (!replaced) {
    throw new Error("REPLACED_FILE_NOT_FOUND");
  }

  if (replaced.clientId) {
    assertClientActionAllowed(input.actor, "updatePayrollRun", replaced.clientId);
  } else if (!isSystemAdmin(input.actor) && replaced.uploadedById !== input.actor.id) {
    throw new PermissionDeniedError("FILE_REPLACEMENT_SOURCE_NOT_AUTHORIZED");
  }

  if (
    replaced.clientId !== input.binding.clientId ||
    replaced.payrollMonth !== input.binding.payrollMonth ||
    replaced.runId !== input.binding.runId
  ) {
    throw new Error("FILE_REPLACEMENT_SCOPE_MISMATCH");
  }

  return replaced.versionNumber + 1;
}

export async function persistParsedWorkbook(input: {
  parsed: ParsedWorkbook;
  fileVersionId: string;
  clientId: string | null;
  runId: string | null;
  auditFields: Awaited<ReturnType<typeof requestAuditFields>>;
}) {
  const blocking = input.parsed.status === "BLOCKED" || hasBlockingSafetyIssue(input.parsed.issues);
  await prisma.$transaction(async (tx) => {
    const workbookParse = await tx.workbookParse.create({
      data: {
        fileVersionId: input.fileVersionId,
        parserVersion: input.parsed.parserVersion,
        status: input.parsed.status,
        workbookName: input.parsed.workbookName,
        sheetCount: input.parsed.sheetCount,
        formulaCellCount: input.parsed.formulaCellCount,
        mergedRangeCount: input.parsed.mergedRangeCount,
        externalLinkCount: input.parsed.externalLinkCount,
        dangerousContentFlags: input.parsed.dangerousContentFlags,
        errorCode: blocking
          ? input.parsed.issues.find((issue) => issue.severity === "blocking")?.code
          : null,
        errorMessage: blocking
          ? input.parsed.issues.find((issue) => issue.severity === "blocking")?.message
          : null,
        completedAt: new Date(),
      },
    });

    for (const sheet of input.parsed.sheets) {
      const workbookSheet = await tx.workbookSheet.create({
        data: {
          workbookParseId: workbookParse.id,
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
        },
      });
      const cells = input.parsed.cells.filter((cell) => cell.sheetName === sheet.sheetName);
      for (const chunk of chunkRecords(cells, 1000)) {
        await tx.workbookCell.createMany({
          data: chunk.map((cell) => ({
            workbookParseId: workbookParse.id,
            sheetId: workbookSheet.id,
            sheetName: cell.sheetName,
            address: cell.address,
            rowIndex: cell.rowIndex,
            columnIndex: cell.columnIndex,
            rawValue: cell.rawValue,
            displayValue: cell.displayValue,
            formulaText: cell.formulaText,
            numberFormat: cell.numberFormat,
            mergedRange: cell.mergedRange,
            isHeader: cell.isHeader,
          })),
        });
      }
    }

    await tx.uploadedFileVersion.update({
      where: { id: input.fileVersionId },
      data: {
        parseStatus: blocking ? "BLOCKED" : "PARSED",
        parseErrorCode: blocking
          ? input.parsed.issues.find((issue) => issue.severity === "blocking")?.code
          : null,
        parseErrorMessage: blocking
          ? input.parsed.issues.find((issue) => issue.severity === "blocking")?.message
          : null,
        riskFlags: Array.from(
          new Set([
            ...input.parsed.dangerousContentFlags,
            ...input.parsed.issues.map((issue) => issue.code),
          ]),
        ),
      },
    });

    if (blocking) {
      await tx.caseItem.create({
        data: {
          clientId: input.clientId,
          runId: input.runId,
          fileVersionId: input.fileVersionId,
          type: "FILE_PARSE_BLOCKER",
          riskLevel: "R2",
          title: "Excel 文件解析阻断",
          detail:
            input.parsed.issues.find((issue) => issue.severity === "blocking")?.message ??
            "Excel 文件无法进入后续映射流程。",
          metadata: { issues: input.parsed.issues },
        },
      });

      if (input.runId) {
        await tx.payrollRun.update({
          where: { id: input.runId },
          data: { blockingIssueCount: { increment: 1 } },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        action: blocking ? "FILE_PARSE_BLOCKED" : "FILE_PARSE_COMPLETED",
        objectType: "WORKBOOK_PARSE",
        objectId: workbookParse.id,
        riskLevel: blocking ? "R2" : "R1",
        ...input.auditFields,
        clientId: input.clientId,
        runId: input.runId,
        metadata: {
          fileVersionId: input.fileVersionId,
          sheetCount: input.parsed.sheetCount,
          formulaCellCount: input.parsed.formulaCellCount,
          mergedRangeCount: input.parsed.mergedRangeCount,
          externalLinkCount: input.parsed.externalLinkCount,
          dangerousContentFlags: input.parsed.dangerousContentFlags,
          status: input.parsed.status,
        },
      },
    });
  });
}

function chunkRecords<T>(records: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < records.length; index += size) {
    chunks.push(records.slice(index, index + size));
  }

  return chunks;
}
