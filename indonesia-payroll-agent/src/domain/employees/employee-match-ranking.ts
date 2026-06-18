import {
  type EmployeeIdentityRecord,
  type EmployeeMatchCandidateRecord,
  type EmployeeMatchMethod,
  type EmployeeMatchRow,
} from "@/domain/employees/employee-matching-service";
import { type ConfidenceBand } from "@/domain/changes/change-review-policy";

export function rankEmployeeMatch(
  row: EmployeeMatchRow,
  employees: EmployeeIdentityRecord[],
): Pick<
  EmployeeMatchCandidateRecord,
  "employeeId" | "matchMethod" | "confidence" | "status" | "conflictSummary" | "reason"
> {
  return (
    uniqueBy("EMPLOYEE_CODE", row.employeeCodeRaw, employees, (employee) => employee.employeeCode) ??
    uniqueBy("NIK_OR_PASSPORT", row.nikOrPassportRaw, employees, (employee) => employee.nikOrPassport) ??
    uniqueBy("NPWP", row.npwpRaw, employees, (employee) => employee.npwp) ??
    nameWithContext(row, employees) ??
    nameOnly(row, employees) ?? {
      employeeId: null,
      matchMethod: "UNMATCHED",
      confidence: "CONFLICT",
      status: "BLOCKED",
      conflictSummary: { searchedName: row.fullNameRaw },
      reason: "无法匹配员工主档，正式算薪前必须阻断并人工处理。",
    }
  );
}

function uniqueBy(
  method: Extract<EmployeeMatchMethod, "EMPLOYEE_CODE" | "NIK_OR_PASSPORT" | "NPWP">,
  rawValue: string | null | undefined,
  employees: EmployeeIdentityRecord[],
  pick: (employee: EmployeeIdentityRecord) => string | null | undefined,
) {
  const value = normalize(rawValue);
  if (!value) {
    return null;
  }
  const matches = employees.filter((employee) => normalize(pick(employee)) === value);
  return candidateFromMatches(method, matches, "HIGH");
}

function nameWithContext(row: EmployeeMatchRow, employees: EmployeeIdentityRecord[]) {
  const name = normalize(row.fullNameRaw);
  const store = normalize(row.storeCode);
  if (!name || !store) {
    return null;
  }
  const matches = employees.filter(
    (employee) => normalize(employee.fullName) === name && normalize(employee.workCity) === store,
  );
  return candidateFromMatches("NAME_WITH_CONTEXT", matches, "MEDIUM");
}

function nameOnly(row: EmployeeMatchRow, employees: EmployeeIdentityRecord[]) {
  const name = normalize(row.fullNameRaw);
  if (!name) {
    return null;
  }
  const matches = employees.filter((employee) => normalize(employee.fullName) === name);
  return candidateFromMatches("NAME_ONLY", matches, "LOW");
}

function candidateFromMatches(
  method: EmployeeMatchMethod,
  matches: EmployeeIdentityRecord[],
  uniqueConfidence: Exclude<ConfidenceBand, "CONFLICT">,
) {
  if (matches.length === 1) {
    return {
      employeeId: matches[0].id,
      matchMethod: method,
      confidence: uniqueConfidence,
      status: "CANDIDATE" as const,
      conflictSummary: {},
      reason:
        method === "NAME_ONLY"
          ? "仅姓名唯一匹配，必须人工确认后才能用于标准化数据。"
          : `按 ${method} 唯一匹配。`,
    };
  }
  if (matches.length > 1) {
    return {
      employeeId: null,
      matchMethod: method,
      confidence: "CONFLICT" as const,
      status: "BLOCKED" as const,
      conflictSummary: { matchIds: matches.map((match) => match.id) },
      reason: "员工匹配出现多候选冲突，必须人工选择。",
    };
  }
  return null;
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}
