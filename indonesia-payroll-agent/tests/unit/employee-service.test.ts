import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { type ActorContext } from "@/domain/auth/permissions";
import {
  assertCriticalFieldEvidence,
  EmployeeService,
  EmployeeServiceError,
  maskEmployeeSensitiveFields,
  type EmployeeMasterVersionDraft,
  type EmployeeRecord,
  type EmployeeStore,
} from "@/domain/employees/employee-service";

const actor: ActorContext = {
  id: "user-delivery",
  email: "delivery@example.local",
  roleCodes: ["DELIVERY_SPECIALIST"],
  authorizedClientIds: ["client-a"],
};

const employee: EmployeeRecord = {
  id: "employee-a",
  clientId: "client-a",
  employeeCode: "E-001",
  fullName: "Budi Santoso",
  status: "ACTIVE",
  hasHistoricalPayroll: true,
  nikOrPassport: "3174010101010001",
  npwp: "091234567890000",
  bpjsHealthNumber: "0001234567890",
  bpjsEmploymentNumber: "TK123456789",
  bankAccountNumber: "1234567890123456",
};

class FakeEmployeeStore implements EmployeeStore {
  masterVersions: EmployeeMasterVersionDraft[] = [];

  async findEmployeeById(id: string) {
    return id === employee.id ? employee : null;
  }

  async createEmployee() {
    return employee;
  }

  async disableEmployee() {
    return { ...employee, status: "DISABLED" as const };
  }

  async createMasterVersion(input: EmployeeMasterVersionDraft) {
    this.masterVersions.push(input);
    return input;
  }
}

describe("employee service", () => {
  it("masks sensitive employee fields by default", () => {
    const masked = maskEmployeeSensitiveFields(employee);

    expect(masked.nikOrPassport).toBe("************0001");
    expect(masked.npwp).toBe("***********0000");
    expect(masked.bankAccountNumber).toBe("************3456");
  });

  it("requires evidence when critical employee fields change", () => {
    expect(() =>
      assertCriticalFieldEvidence({ bankAccountNumber: "9999" }, []),
    ).toThrow(EmployeeServiceError);
    expect(() =>
      assertCriticalFieldEvidence({ status: { from: "ACTIVE", to: "TERMINATED" } }, []),
    ).toThrow(EmployeeServiceError);
    expect(() => assertCriticalFieldEvidence({ ptkpStatus: "K/1" }, [])).toThrow(
      EmployeeServiceError,
    );

    expect(() =>
      assertCriticalFieldEvidence({ status: { from: "ACTIVE", to: "TERMINATED" } }, ["evidence-1"]),
    ).not.toThrow();
  });

  it("records audit when sensitive fields are revealed", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const service = new EmployeeService(
      new FakeEmployeeStore(),
      new AuditService(auditStore),
    );

    const value = await service.revealSensitiveField({
      actor,
      employee,
      field: "npwp",
      purpose: "validate tax profile before payroll",
    });
    const logs = await auditStore.listAuditLogs();

    expect(value).toBe(employee.npwp);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe("SENSITIVE_FIELD_REVEALED");
    expect(logs[0]?.purpose).toBe("validate tax profile before payroll");
  });

  it("rejects physical delete when an employee has historical payroll", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const service = new EmployeeService(
      new FakeEmployeeStore(),
      new AuditService(auditStore),
    );

    await expect(
      service.assertEmployeeCanBePhysicallyDeleted({ actor, employeeId: employee.id }),
    ).rejects.toThrow(EmployeeServiceError);
    expect((await auditStore.listAuditLogs())[0]?.action).toBe("EMPLOYEE_DELETE_REJECTED");
  });
});
