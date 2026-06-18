import { describe, expect, it } from "vitest";
import {
  AuditLogImmutableError,
  AuditService,
  InMemoryAuditLogStore,
} from "@/domain/audit/audit-service";
import { type ActorContext } from "@/domain/auth/permissions";

const actor: ActorContext = {
  id: "user-auditor",
  email: "auditor@example.local",
  roleCodes: ["PAYROLL_LEAD"],
  authorizedClientIds: ["client-a"],
};

describe("audit service", () => {
  it("records immutable audit logs and appends corrections separately", async () => {
    const store = new InMemoryAuditLogStore();
    const service = new AuditService(store);
    const auditLog = await service.record({
      actor,
      action: "SENSITIVE_FIELD_REVEALED",
      objectType: "SENSITIVE_FIELD",
      objectId: "employee-a:npwp",
      riskLevel: "R1",
      clientId: "client-a",
      purpose: "monthly payroll validation",
    });

    const correction = await service.appendCorrection({
      actor,
      auditLogId: auditLog.id,
      note: "Purpose checked against ticket PAY-42.",
    });

    const stored = await store.findAuditLogById(auditLog.id);

    expect(correction.auditLogId).toBe(auditLog.id);
    expect(stored?.objectId).toBe("employee-a:npwp");
    expect(stored?.corrections).toHaveLength(1);
    expect(stored?.corrections[0]?.note).toBe("Purpose checked against ticket PAY-42.");
  });

  it("rejects empty correction notes", async () => {
    const store = new InMemoryAuditLogStore();
    const service = new AuditService(store);
    const auditLog = await service.record({
      actor,
      action: "EXPORT_CREATED",
      objectType: "EXPORT_FILE",
      objectId: "export-a",
      riskLevel: "R3",
      clientId: "client-a",
    });

    await expect(
      service.appendCorrection({ actor, auditLogId: auditLog.id, note: "   " }),
    ).rejects.toThrow(AuditLogImmutableError);
  });
});
