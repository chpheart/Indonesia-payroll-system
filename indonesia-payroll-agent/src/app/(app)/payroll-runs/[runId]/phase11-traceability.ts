type TraceabilityRun = {
  ruleVersionSnapshot: unknown;
  changeLedgerEntries: {
    id: string;
    entryType: string;
    targetEmployeeId: string | null;
    targetObjectType: string;
    targetField: string;
    riskLevel: string;
    reviewedAt: Date;
    evidenceRefs: string[];
  }[];
  fieldMappingVersions: {
    id: string;
    sourceSheetName: string;
    sourceColumnLabel: string;
    targetField: string;
    confidence: string;
    evidenceRefs: string[];
  }[];
  standardizedInputs: {
    id: string;
    employeeId: string | null;
    standardField: string;
    sourceSheetName: string | null;
    sourceRowIndex: number | null;
    sourceCellId: string | null;
    evidenceRefs: string[];
  }[];
  rawInputItems: {
    id: string;
    sourceChannel: string;
    inputType: string;
    redactedSummary: string;
    attachmentFileName: string | null;
    securityFlags: string[];
  }[];
  uploadedFileVersions: {
    id: string;
    fileName: string;
    purpose: string;
    versionNumber: number;
    parseStatus: string;
  }[];
};

export function buildPhase11Traceability(run: TraceabilityRun) {
  return {
    changeLedgerEntries: run.changeLedgerEntries.map((entry) => ({
      id: entry.id,
      entryType: entry.entryType,
      targetEmployeeId: entry.targetEmployeeId,
      targetObjectType: entry.targetObjectType,
      targetField: entry.targetField,
      riskLevel: entry.riskLevel,
      reviewedAt: entry.reviewedAt.toISOString(),
      evidenceRefs: entry.evidenceRefs,
    })),
    fieldMappings: run.fieldMappingVersions.map((mapping) => ({
      id: mapping.id,
      sourceSheetName: mapping.sourceSheetName,
      sourceColumnLabel: mapping.sourceColumnLabel,
      targetField: mapping.targetField,
      confidence: mapping.confidence,
      evidenceRefs: mapping.evidenceRefs,
    })),
    standardizedInputs: run.standardizedInputs.map((input) => ({
      id: input.id,
      employeeId: input.employeeId,
      standardField: input.standardField,
      sourceSheetName: input.sourceSheetName,
      sourceRowIndex: input.sourceRowIndex,
      sourceCellId: input.sourceCellId,
      evidenceRefs: input.evidenceRefs,
    })),
    rawInputItems: run.rawInputItems.map((item) => ({
      id: item.id,
      sourceChannel: item.sourceChannel,
      inputType: item.inputType,
      redactedSummary: item.redactedSummary,
      attachmentFileName: item.attachmentFileName,
      securityFlags: item.securityFlags,
    })),
    uploadedFiles: run.uploadedFileVersions.map((file) => ({
      id: file.id,
      fileName: file.fileName,
      purpose: file.purpose,
      versionNumber: file.versionNumber,
      parseStatus: file.parseStatus,
    })),
    ruleVersionSnapshot: run.ruleVersionSnapshot,
    correctionDeltas: [],
  };
}
