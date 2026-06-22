export const COVERAGE_SCOPE_TYPES = [
  "FULL_RUN",
  "EMPLOYEES",
  "FIELDS",
  "CLIENT_SCOPE",
  "FILES",
  "EXPORT_PREVIEW",
  "RESULT_VERSION",
  "MIXED",
] as const;

export type CoverageScopeType = (typeof COVERAGE_SCOPE_TYPES)[number];

export type CoverageScope = {
  type: CoverageScopeType;
  runId?: string;
  dataVersionRef?: string;
  resultVersionRef?: string;
  exportPreviewVersionRef?: string;
  employeeIds?: string[];
  fields?: string[];
  clientScopeKeys?: string[];
  fileVersionIds?: string[];
  sourceObjectRefs?: string[];
  note?: string;
};

export type ChangeImpactScope = {
  runId: string;
  targetEmployeeId?: string | null;
  targetField?: string | null;
  dataVersionRef?: string | null;
  resultVersionRef?: string | null;
  exportPreviewVersionRef?: string | null;
};

export function normalizeCoverageScope(input: Partial<CoverageScope>): CoverageScope {
  const scope: CoverageScope = {
    type: input.type ?? "MIXED",
    employeeIds: cleanList(input.employeeIds),
    fields: cleanList(input.fields),
    clientScopeKeys: cleanList(input.clientScopeKeys),
    fileVersionIds: cleanList(input.fileVersionIds),
    sourceObjectRefs: cleanList(input.sourceObjectRefs),
  };

  if (input.runId) scope.runId = input.runId;
  if (input.dataVersionRef) scope.dataVersionRef = input.dataVersionRef;
  if (input.resultVersionRef) scope.resultVersionRef = input.resultVersionRef;
  if (input.exportPreviewVersionRef) scope.exportPreviewVersionRef = input.exportPreviewVersionRef;
  if (input.note?.trim()) scope.note = input.note.trim();

  return scope;
}

export function parseCoverageScopeJson(value: unknown): CoverageScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("COVERAGE_SCOPE_REQUIRED");
  }
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" && isCoverageScopeType(record.type) ? record.type : "MIXED";

  return normalizeCoverageScope({
    type,
    runId: stringValue(record.runId),
    dataVersionRef: stringValue(record.dataVersionRef),
    resultVersionRef: stringValue(record.resultVersionRef),
    exportPreviewVersionRef: stringValue(record.exportPreviewVersionRef),
    employeeIds: stringList(record.employeeIds),
    fields: stringList(record.fields),
    clientScopeKeys: stringList(record.clientScopeKeys),
    fileVersionIds: stringList(record.fileVersionIds),
    sourceObjectRefs: stringList(record.sourceObjectRefs),
    note: stringValue(record.note),
  });
}

export function assertExplicitCoverage(scope: CoverageScope): void {
  const normalized = normalizeCoverageScope(scope);

  switch (normalized.type) {
    case "FULL_RUN":
      if (normalized.runId || normalized.dataVersionRef || normalized.resultVersionRef || normalized.exportPreviewVersionRef) {
        return;
      }
      break;
    case "EMPLOYEES":
      if (hasItems(normalized.employeeIds)) return;
      break;
    case "FIELDS":
      if (hasItems(normalized.fields)) return;
      break;
    case "CLIENT_SCOPE":
      if (hasItems(normalized.clientScopeKeys)) return;
      break;
    case "FILES":
      if (hasItems(normalized.fileVersionIds)) return;
      break;
    case "EXPORT_PREVIEW":
      if (normalized.exportPreviewVersionRef) return;
      break;
    case "RESULT_VERSION":
      if (normalized.resultVersionRef) return;
      break;
    case "MIXED":
      if (
        hasItems(normalized.employeeIds) ||
        hasItems(normalized.fields) ||
        hasItems(normalized.clientScopeKeys) ||
        hasItems(normalized.fileVersionIds) ||
        hasItems(normalized.sourceObjectRefs) ||
        normalized.resultVersionRef ||
        normalized.exportPreviewVersionRef
      ) {
        return;
      }
      break;
  }

  throw new Error("CONFIRMATION_COVERAGE_SCOPE_REQUIRED");
}

export function assertConfirmationReplyHasCoverage(input: {
  confirmationText: string;
  coverageScope: CoverageScope;
}): void {
  if (!input.confirmationText.trim()) {
    throw new Error("CUSTOMER_CONFIRMATION_TEXT_REQUIRED");
  }

  assertExplicitCoverage(input.coverageScope);
}

export function assertCoverageScopeBelongsToRun(input: {
  coverageScope: CoverageScope;
  runId: string;
  resultVersionRef?: string | null;
  exportPreviewVersionRef?: string | null;
  errorCode?: string;
}): void {
  const normalized = normalizeCoverageScope(input.coverageScope);
  const errorCode = input.errorCode ?? "COVERAGE_SCOPE_RUN_MISMATCH";

  if (normalized.runId !== input.runId) {
    throw new Error(errorCode);
  }
  if (normalized.resultVersionRef && normalized.resultVersionRef !== input.resultVersionRef) {
    throw new Error(errorCode);
  }
  if (normalized.exportPreviewVersionRef && normalized.exportPreviewVersionRef !== input.exportPreviewVersionRef) {
    throw new Error(errorCode);
  }
}

export function assertCoverageScopeCovers(input: {
  evidenceScope: CoverageScope;
  requestedScope: CoverageScope;
  errorCode?: string;
}): void {
  if (coverageScopeCovers(input)) {
    return;
  }

  throw new Error(input.errorCode ?? "COVERAGE_SCOPE_NOT_COVERED_BY_EVIDENCE");
}

export function coverageScopeCovers(input: {
  evidenceScope: CoverageScope;
  requestedScope: CoverageScope;
}): boolean {
  const evidenceScope = normalizeCoverageScope(input.evidenceScope);
  const requestedScope = normalizeCoverageScope(input.requestedScope);

  if (requestedScope.runId && evidenceScope.runId !== requestedScope.runId) {
    return false;
  }
  if (!requestedScope.runId && evidenceScope.runId) {
    return false;
  }
  if (evidenceScope.type === "FULL_RUN") {
    return true;
  }
  if (requestedScope.type === "FULL_RUN") {
    return false;
  }
  if (
    !coversList(evidenceScope.employeeIds, requestedScope.employeeIds) ||
    !coversList(evidenceScope.fields, requestedScope.fields) ||
    !coversList(evidenceScope.clientScopeKeys, requestedScope.clientScopeKeys) ||
    !coversList(evidenceScope.fileVersionIds, requestedScope.fileVersionIds) ||
    !coversList(evidenceScope.sourceObjectRefs, requestedScope.sourceObjectRefs)
  ) {
    return false;
  }
  if (requestedScope.resultVersionRef && evidenceScope.resultVersionRef !== requestedScope.resultVersionRef) {
    return false;
  }
  if (requestedScope.exportPreviewVersionRef && evidenceScope.exportPreviewVersionRef !== requestedScope.exportPreviewVersionRef) {
    return false;
  }
  if (!requestedScope.resultVersionRef && evidenceScope.resultVersionRef) {
    return false;
  }
  if (!requestedScope.exportPreviewVersionRef && evidenceScope.exportPreviewVersionRef) {
    return false;
  }
  return true;
}

export function coverageIntersectsChange(scope: CoverageScope, change: ChangeImpactScope): boolean {
  const normalized = normalizeCoverageScope(scope);
  const employeeIds = normalized.employeeIds ?? [];
  const fields = normalized.fields ?? [];

  if (normalized.type === "FULL_RUN") {
    return !normalized.runId || normalized.runId === change.runId;
  }

  if (normalized.runId && normalized.runId !== change.runId) {
    return false;
  }

  if (change.targetEmployeeId && hasItems(employeeIds)) {
    return employeeIds.includes(change.targetEmployeeId);
  }

  if (change.targetField && hasItems(fields)) {
    return fields.includes(change.targetField);
  }

  if (change.resultVersionRef && normalized.resultVersionRef) {
    return normalized.resultVersionRef === change.resultVersionRef;
  }

  if (change.exportPreviewVersionRef && normalized.exportPreviewVersionRef) {
    return normalized.exportPreviewVersionRef === change.exportPreviewVersionRef;
  }

  return normalized.type === "MIXED" && (hasItems(employeeIds) || hasItems(fields));
}

export function isCoverageScopeType(value: string): value is CoverageScopeType {
  return COVERAGE_SCOPE_TYPES.includes(value as CoverageScopeType);
}

function cleanList(values?: string[]) {
  return values?.map((value) => value.trim()).filter(Boolean) ?? [];
}

function hasItems(values?: string[]) {
  return Boolean(values && values.length > 0);
}

function coversList(evidenceValues?: string[], requestedValues?: string[]) {
  const requested = requestedValues ?? [];
  const evidence = evidenceValues ?? [];
  if (evidence.length === 0) {
    return true;
  }
  if (requested.length === 0) {
    return false;
  }
  const evidenceSet = new Set(evidence);
  return requested.every((value) => evidenceSet.has(value));
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
