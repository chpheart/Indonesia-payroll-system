import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type AuditService } from "@/domain/audit/audit-service";

export const SENSITIVE_EMPLOYEE_FIELDS = [
  "nikOrPassport",
  "npwp",
  "bpjsHealthNumber",
  "bpjsEmploymentNumber",
  "bankAccountNumber",
] as const;

export const CRITICAL_EMPLOYEE_FIELDS = [
  ...SENSITIVE_EMPLOYEE_FIELDS,
  "status",
  "joinDate",
  "terminationDate",
  "employmentStartDate",
  "employmentEndDate",
  "ptkpStatus",
  "ptkp",
  "workCity",
  "salaryVersion",
  "grossUpOverride",
  "employeeFxRate",
] as const;

export type SensitiveEmployeeField = (typeof SENSITIVE_EMPLOYEE_FIELDS)[number];
export type CriticalEmployeeField = (typeof CRITICAL_EMPLOYEE_FIELDS)[number];
export type EmployeeStatus = "ACTIVE" | "TERMINATED" | "DISABLED";
export type EmployeeMasterVersionStatus = "DRAFT" | "EFFECTIVE" | "SUPERSEDED";

export type EmployeeRecord = {
  id: string;
  clientId: string;
  employeeCode: string;
  fullName: string;
  status: EmployeeStatus;
  hasHistoricalPayroll: boolean;
  nikOrPassport?: string | null;
  npwp?: string | null;
  bpjsHealthNumber?: string | null;
  bpjsEmploymentNumber?: string | null;
  bankAccountNumber?: string | null;
};

export type EmployeeMasterVersionDraft = {
  employeeId: string;
  clientId: string;
  versionNumber: number;
  effectiveMonth: string;
  status: EmployeeMasterVersionStatus;
  changedFields: Record<string, unknown>;
  snapshot: Record<string, unknown>;
  evidenceRefs: string[];
  changeReason: string;
};

export type EmployeeStore = {
  findEmployeeById(id: string): Promise<EmployeeRecord | null>;
  createEmployee(input: {
    clientId: string;
    employeeCode: string;
    fullName: string;
    actorId: string;
  }): Promise<EmployeeRecord>;
  disableEmployee(id: string): Promise<EmployeeRecord>;
  createMasterVersion(input: EmployeeMasterVersionDraft): Promise<EmployeeMasterVersionDraft>;
};

export type MaskedEmployee = Omit<
  EmployeeRecord,
  SensitiveEmployeeField
> & {
  nikOrPassport?: string | null;
  npwp?: string | null;
  bpjsHealthNumber?: string | null;
  bpjsEmploymentNumber?: string | null;
  bankAccountNumber?: string | null;
};

export class EmployeeService {
  constructor(
    private readonly store: EmployeeStore,
    private readonly auditService: AuditService,
  ) {}

  async createEmployee(input: {
    actor: ActorContext;
    clientId: string;
    employeeCode: string;
    fullName: string;
  }): Promise<EmployeeRecord> {
    assertClientActionAllowed(input.actor, "editEmployee", input.clientId);

    if (!input.employeeCode.trim() || !input.fullName.trim()) {
      throw new EmployeeServiceError("EMPLOYEE_CODE_AND_NAME_REQUIRED");
    }

    const employee = await this.store.createEmployee({
      clientId: input.clientId,
      employeeCode: input.employeeCode.trim(),
      fullName: input.fullName.trim(),
      actorId: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "EMPLOYEE_CREATED",
      objectType: "EMPLOYEE",
      objectId: employee.id,
      riskLevel: "R1",
      clientId: input.clientId,
      metadata: { employeeCode: employee.employeeCode },
    });

    return employee;
  }

  async disableEmployee(input: {
    actor: ActorContext;
    employeeId: string;
  }): Promise<EmployeeRecord> {
    const employee = await this.requireEmployee(input.employeeId);
    assertClientActionAllowed(input.actor, "editEmployee", employee.clientId);

    if (employee.status === "DISABLED") {
      return employee;
    }

    const disabled = await this.store.disableEmployee(input.employeeId);
    await this.auditService.record({
      actor: input.actor,
      action: "EMPLOYEE_DISABLED",
      objectType: "EMPLOYEE",
      objectId: input.employeeId,
      riskLevel: "R1",
      clientId: employee.clientId,
    });

    return disabled;
  }

  async assertEmployeeCanBePhysicallyDeleted(input: {
    actor: ActorContext;
    employeeId: string;
  }): Promise<void> {
    const employee = await this.requireEmployee(input.employeeId);
    assertClientActionAllowed(input.actor, "editEmployee", employee.clientId);

    if (employee.hasHistoricalPayroll) {
      await this.auditService.record({
        actor: input.actor,
        action: "EMPLOYEE_DELETE_REJECTED",
        objectType: "EMPLOYEE",
        objectId: employee.id,
        riskLevel: "R1",
        clientId: employee.clientId,
        metadata: { reason: "HAS_HISTORICAL_PAYROLL" },
      });
      throw new EmployeeServiceError("EMPLOYEE_WITH_HISTORY_CANNOT_BE_DELETED");
    }
  }

  async createMasterVersion(input: {
    actor: ActorContext;
    draft: EmployeeMasterVersionDraft;
  }): Promise<EmployeeMasterVersionDraft> {
    assertClientActionAllowed(input.actor, "editEmployee", input.draft.clientId);
    assertCriticalFieldEvidence(input.draft.changedFields, input.draft.evidenceRefs);

    if (!input.draft.changeReason.trim()) {
      throw new EmployeeServiceError("EMPLOYEE_MASTER_CHANGE_REASON_REQUIRED");
    }

    const created = await this.store.createMasterVersion({
      ...input.draft,
      changeReason: input.draft.changeReason.trim(),
    });

    await this.auditService.record({
      actor: input.actor,
      action: "EMPLOYEE_MASTER_VERSION_CREATED",
      objectType: "EMPLOYEE_MASTER_VERSION",
      objectId: `${created.employeeId}:${created.versionNumber}`,
      riskLevel: "R2",
      clientId: created.clientId,
      metadata: {
        changedFieldNames: Object.keys(created.changedFields),
        effectiveMonth: created.effectiveMonth,
        versionNumber: created.versionNumber,
      },
    });

    return created;
  }

  async revealSensitiveField(input: {
    actor: ActorContext;
    employee: EmployeeRecord;
    field: SensitiveEmployeeField;
    purpose: string;
  }): Promise<string | null> {
    assertClientActionAllowed(input.actor, "viewSensitive", input.employee.clientId);

    const purpose = input.purpose.trim();
    if (!purpose) {
      throw new EmployeeServiceError("SENSITIVE_REVEAL_PURPOSE_REQUIRED");
    }

    await this.auditService.record({
      actor: input.actor,
      action: "SENSITIVE_FIELD_REVEALED",
      objectType: "SENSITIVE_FIELD",
      objectId: `${input.employee.id}:${input.field}`,
      riskLevel: "R1",
      clientId: input.employee.clientId,
      purpose,
      metadata: {
        employeeId: input.employee.id,
        employeeCode: input.employee.employeeCode,
        field: input.field,
      },
    });

    return input.employee[input.field] ?? null;
  }

  private async requireEmployee(employeeId: string): Promise<EmployeeRecord> {
    const employee = await this.store.findEmployeeById(employeeId);
    if (!employee) {
      throw new EmployeeServiceError("EMPLOYEE_NOT_FOUND");
    }

    return employee;
  }
}

export function maskSensitiveValue(value: string | null | undefined): string | null {
  if (!value) {
    return value ?? null;
  }

  const visibleTailLength = Math.min(4, value.length);
  const visibleTail = value.slice(-visibleTailLength);
  const maskedLength = Math.max(value.length - visibleTailLength, 4);
  return `${"*".repeat(maskedLength)}${visibleTail}`;
}

export function maskEmployeeSensitiveFields(employee: EmployeeRecord): MaskedEmployee {
  return {
    ...employee,
    nikOrPassport: maskSensitiveValue(employee.nikOrPassport),
    npwp: maskSensitiveValue(employee.npwp),
    bpjsHealthNumber: maskSensitiveValue(employee.bpjsHealthNumber),
    bpjsEmploymentNumber: maskSensitiveValue(employee.bpjsEmploymentNumber),
    bankAccountNumber: maskSensitiveValue(employee.bankAccountNumber),
  };
}

export function assertCriticalFieldEvidence(
  changedFields: Record<string, unknown>,
  evidenceRefs: string[],
): void {
  const changedCriticalFields = Object.keys(changedFields).filter((field) =>
    CRITICAL_EMPLOYEE_FIELDS.includes(field as CriticalEmployeeField),
  );

  if (changedCriticalFields.length > 0 && evidenceRefs.length === 0) {
    throw new EmployeeServiceError("CRITICAL_EMPLOYEE_FIELD_EVIDENCE_REQUIRED");
  }
}

export class EmployeeServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "EmployeeServiceError";
  }
}
