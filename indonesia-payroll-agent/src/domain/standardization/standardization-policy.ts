export const STANDARDIZED_INPUT_STATUSES = ["PREVIEW", "CONFIRMED", "BLOCKED", "INVALIDATED"] as const;
export const EVIDENCE_STATUSES = ["VALID", "MISSING", "STALE"] as const;
export const REVIEWABLE_STANDARDIZED_INPUT_STATUSES = ["PREVIEW", "BLOCKED"] as const;

export type StandardizedInputStatus = (typeof STANDARDIZED_INPUT_STATUSES)[number];
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export type StandardizationIssue = {
  code: string;
  severity: "INFO" | "WARNING" | "BLOCKING";
  message: string;
};

type ConfirmedMappingRef = {
  clientId: string;
  runId: string;
  status: "CONFIRMED" | "CANDIDATE" | "REJECTED" | "SUPERSEDED";
  confidence: "LOW" | "MEDIUM" | "HIGH" | "CONFLICT";
} | null;

type EmployeeMatchRef = {
  clientId: string;
  runId: string;
  employeeId?: string | null;
  status: "CANDIDATE" | "CONFIRMED" | "REJECTED" | "BLOCKED";
} | null;

export function validateStandardizedInputReferences(input: {
  clientId: string;
  runId: string;
  fieldMappingVersionId?: string | null;
  employeeMatchCandidateId?: string | null;
  standardField: string;
  evidenceRefs: string[];
  evidenceStatus: EvidenceStatus;
  fieldMappingVersion: ConfirmedMappingRef;
  employeeMatchCandidate: EmployeeMatchRef;
}): StandardizationIssue[] {
  const issues: StandardizationIssue[] = [];
  validateMapping(input, issues);
  validateEmployeeMatch(input, issues);
  if (isCriticalStandardField(input.standardField) && input.evidenceRefs.length === 0) {
    issues.push({
      code: "CRITICAL_FIELD_EVIDENCE_MISSING",
      severity: "BLOCKING",
      message: "关键算薪字段缺证据，不能保存为生效版本。",
    });
  }
  if (input.evidenceStatus !== "VALID") {
    issues.push({ code: "EVIDENCE_NOT_VALID", severity: "WARNING", message: "证据状态未验证。" });
  }
  return issues;
}

function validateMapping(
  input: Parameters<typeof validateStandardizedInputReferences>[0],
  issues: StandardizationIssue[],
) {
  if (!input.fieldMappingVersionId) {
    issues.push({
      code: "FIELD_MAPPING_REQUIRED",
      severity: "BLOCKING",
      message: "标准化输入必须绑定已人工确认的字段映射版本。",
    });
    return;
  }
  const mapping = input.fieldMappingVersion;
  if (
    !mapping ||
    mapping.clientId !== input.clientId ||
    mapping.runId !== input.runId ||
    mapping.status !== "CONFIRMED" ||
    ["LOW", "CONFLICT"].includes(mapping.confidence)
  ) {
    issues.push({
      code: "FIELD_MAPPING_NOT_CONFIRMED",
      severity: "BLOCKING",
      message: "标准化输入只能来自已人工确认且非低置信/冲突的映射版本。",
    });
  }
}

function validateEmployeeMatch(
  input: Parameters<typeof validateStandardizedInputReferences>[0],
  issues: StandardizationIssue[],
) {
  if (!input.employeeMatchCandidateId) {
    issues.push({
      code: "EMPLOYEE_MATCH_REQUIRED",
      severity: "BLOCKING",
      message: "标准化输入必须绑定已人工确认的员工匹配。",
    });
    return;
  }
  const match = input.employeeMatchCandidate;
  if (
    !match ||
    match.clientId !== input.clientId ||
    match.runId !== input.runId ||
    match.status !== "CONFIRMED" ||
    !match.employeeId
  ) {
    issues.push({
      code: "EMPLOYEE_MATCH_NOT_CONFIRMED",
      severity: "BLOCKING",
      message: "员工匹配未确认，不能进入正式标准化输入。",
    });
  }
}

export function isCriticalStandardField(field: string) {
  return /(salary|amount|gross|net|bpjs|tax|npwp|nik|passport|bank|termination|join|fx)/i.test(field);
}

export function assertReviewableStandardizedInputStatus(status: string) {
  if (!REVIEWABLE_STANDARDIZED_INPUT_STATUSES.includes(status as "PREVIEW" | "BLOCKED")) {
    throw new Error("STANDARDIZED_INPUT_NOT_REVIEWABLE");
  }
}
