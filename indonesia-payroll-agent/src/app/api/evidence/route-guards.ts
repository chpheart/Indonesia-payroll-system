import { type PrismaClient } from "@/generated/prisma/client";
import {
  type CoverageScope,
  assertCoverageScopeBelongsToRun,
  assertExplicitCoverage,
} from "@/domain/confirmation-packs/pack-coverage-service";
import { type EvidenceLinkObjectType } from "@/domain/evidence/evidence-service";

type EvidenceScopeDb = Pick<
  PrismaClient,
  | "client"
  | "payrollRun"
  | "employee"
  | "employeeMasterVersion"
  | "rawInputItem"
  | "uploadedFileVersion"
  | "workbookCell"
  | "changeProposal"
  | "changeLedgerEntry"
  | "questionItem"
  | "customerConfirmationPack"
  | "customerConfirmationPackItem"
  | "customerConfirmation"
  | "fieldMappingVersion"
  | "standardizedPayrollInput"
  | "ruleVersion"
  | "fXRateVersion"
  | "caseItem"
>;

export type EvidenceRouteLink = {
  clientId: string;
  runId?: string;
  objectType: EvidenceLinkObjectType;
  objectId: string;
  coverageScope: CoverageScope;
};

export async function assertEvidenceCreateScope(input: {
  db: EvidenceScopeDb;
  clientId: string;
  runId?: string;
  rawInputItemId?: string;
  fileVersionId?: string;
  coverageScope: CoverageScope;
  links: EvidenceRouteLink[];
}) {
  assertExplicitCoverage(input.coverageScope);
  if (input.runId) {
    assertCoverageScopeBelongsToRun({
      coverageScope: input.coverageScope,
      runId: input.runId,
      errorCode: "EVIDENCE_COVERAGE_SCOPE_MISMATCH",
    });
  }
  await assertEvidenceProvenanceScope(input.db, input.clientId, input.runId, {
    rawInputItemId: input.rawInputItemId,
    fileVersionId: input.fileVersionId,
  });

  for (const link of input.links) {
    assertExplicitCoverage(link.coverageScope);
    if (link.clientId !== input.clientId) {
      throw new Error("EVIDENCE_LINK_SCOPE_MISMATCH");
    }
    if (input.runId && link.runId !== input.runId) {
      throw new Error("EVIDENCE_LINK_SCOPE_MISMATCH");
    }
    if (input.runId) {
      assertCoverageScopeBelongsToRun({
        coverageScope: link.coverageScope,
        runId: input.runId,
        errorCode: "EVIDENCE_LINK_COVERAGE_SCOPE_MISMATCH",
      });
    }
    await assertEvidenceLinkObjectScope(input.db, input.clientId, input.runId, link);
  }
}

async function assertEvidenceProvenanceScope(
  db: EvidenceScopeDb,
  clientId: string,
  runId: string | undefined,
  input: { rawInputItemId?: string; fileVersionId?: string },
) {
  if (input.rawInputItemId) {
    const item = await db.rawInputItem.findUnique({
      where: { id: input.rawInputItemId },
      select: { clientId: true, runId: true },
    });
    if (!item || item.clientId !== clientId || (runId && item.runId !== runId)) {
      throw new Error("EVIDENCE_PROVENANCE_SCOPE_MISMATCH");
    }
  }
  if (input.fileVersionId) {
    const file = await db.uploadedFileVersion.findUnique({
      where: { id: input.fileVersionId },
      select: { clientId: true, runId: true },
    });
    if (!file || file.clientId !== clientId || (runId && file.runId !== runId)) {
      throw new Error("EVIDENCE_PROVENANCE_SCOPE_MISMATCH");
    }
  }
}

async function assertEvidenceLinkObjectScope(
  db: EvidenceScopeDb,
  clientId: string,
  runId: string | undefined,
  link: EvidenceRouteLink,
) {
  switch (link.objectType) {
    case "CLIENT":
    case "CLIENT_SCOPE": {
      const client = await db.client.findUnique({ where: { id: link.objectId }, select: { id: true } });
      if (!client || client.id !== clientId) throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      return;
    }
    case "PAYROLL_RUN": {
      const run = await db.payrollRun.findUnique({ where: { id: link.objectId }, select: { id: true, clientId: true } });
      if (!run || run.clientId !== clientId || (runId && run.id !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "EMPLOYEE": {
      const employee = await db.employee.findUnique({ where: { id: link.objectId }, select: { id: true, clientId: true } });
      if (!employee || employee.clientId !== clientId) throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      assertLinkedEmployeeCovered(link.coverageScope, employee.id);
      return;
    }
    case "EMPLOYEE_MASTER_VERSION": {
      const version = await db.employeeMasterVersion.findUnique({
        where: { id: link.objectId },
        select: { employeeId: true, employee: { select: { clientId: true } } },
      });
      if (!version || version.employee.clientId !== clientId) throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      assertLinkedEmployeeCovered(link.coverageScope, version.employeeId);
      return;
    }
    case "WORKBOOK_CELL": {
      const cell = await db.workbookCell.findUnique({
        where: { id: link.objectId },
        select: {
          workbookParse: {
            select: { fileVersion: { select: { clientId: true, runId: true } } },
          },
        },
      });
      const file = cell?.workbookParse.fileVersion;
      if (!file || file.clientId !== clientId || (runId && file.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "RAW_INPUT_ITEM": {
      const item = await db.rawInputItem.findUnique({ where: { id: link.objectId }, select: { clientId: true, runId: true } });
      if (!item || item.clientId !== clientId || (runId && item.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "UPLOADED_FILE_VERSION": {
      const file = await db.uploadedFileVersion.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!file || file.clientId !== clientId || (runId && file.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "CHANGE_PROPOSAL": {
      const proposal = await db.changeProposal.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!proposal || proposal.clientId !== clientId || (runId && proposal.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "CHANGE_LEDGER_ENTRY": {
      const entry = await db.changeLedgerEntry.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!entry || entry.clientId !== clientId || (runId && entry.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "QUESTION_ITEM": {
      const question = await db.questionItem.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!question || question.clientId !== clientId || (runId && question.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "CUSTOMER_CONFIRMATION_PACK_ITEM": {
      const item = await db.customerConfirmationPackItem.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!item || item.clientId !== clientId || (runId && item.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "CUSTOMER_CONFIRMATION": {
      const confirmation = await db.customerConfirmation.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!confirmation || confirmation.clientId !== clientId || (runId && confirmation.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "CUSTOMER_CONFIRMATION_PACK": {
      const pack = await db.customerConfirmationPack.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!pack || pack.clientId !== clientId || (runId && pack.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "FIELD_MAPPING_VERSION": {
      const mapping = await db.fieldMappingVersion.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!mapping || mapping.clientId !== clientId || (runId && mapping.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "STANDARDIZED_PAYROLL_INPUT": {
      const input = await db.standardizedPayrollInput.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!input || input.clientId !== clientId || (runId && input.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "RULE_VERSION": {
      const rule = await db.ruleVersion.findUnique({ where: { id: link.objectId }, select: { clientId: true } });
      if (!rule || (rule.clientId && rule.clientId !== clientId)) throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      return;
    }
    case "FX_RATE_VERSION": {
      const rate = await db.fXRateVersion.findUnique({ where: { id: link.objectId }, select: { clientId: true } });
      if (!rate || rate.clientId !== clientId) throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      return;
    }
    case "HIGH_RISK_ISSUE": {
      const issue = await db.caseItem.findUnique({
        where: { id: link.objectId },
        select: { clientId: true, runId: true },
      });
      if (!issue || issue.clientId !== clientId || (runId && issue.runId !== runId)) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    case "CORRECTION_RUN": {
      const correctionRun = await db.payrollRun.findUnique({
        where: { id: link.objectId },
        select: { clientId: true },
      });
      if (!correctionRun || correctionRun.clientId !== clientId) {
        throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_MISMATCH");
      }
      return;
    }
    default:
      throw new Error("EVIDENCE_LINK_OBJECT_SCOPE_UNVERIFIABLE");
  }
}

function assertLinkedEmployeeCovered(scope: CoverageScope, employeeId: string) {
  if (scope.employeeIds && scope.employeeIds.length > 0 && !scope.employeeIds.includes(employeeId)) {
    throw new Error("EVIDENCE_LINK_EMPLOYEE_SCOPE_MISMATCH");
  }
}
