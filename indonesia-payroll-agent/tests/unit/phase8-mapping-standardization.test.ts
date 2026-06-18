import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { type ActorContext } from "@/domain/auth/permissions";
import { rankEmployeeMatch } from "@/domain/employees/employee-match-ranking";
import {
  type EmployeeIdentityRecord,
  type EmployeeMatchRow,
} from "@/domain/employees/employee-matching-service";
import {
  MappingService,
  type FieldMappingCandidateRecord,
  type FieldMappingStore,
  type FieldMappingVersionRecord,
} from "@/domain/mappings/mapping-service";
import {
  StandardizationService,
  type StandardizationStore,
  type StandardizedPayrollInputRecord,
} from "@/domain/standardization/standardization-service";

const actor: ActorContext = {
  id: "delivery-1",
  email: "delivery@example.local",
  roleCodes: ["DELIVERY_SPECIALIST"],
  authorizedClientIds: ["client-a"],
};

describe("phase 8 mapping and standardization", () => {
  it("keeps low-confidence mapping candidates from becoming effective versions", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new MemoryMappingStore();
    const service = new MappingService(store, new AuditService(auditStore));
    const candidate = await service.createCandidate({
      actor,
      candidate: mappingCandidate({ confidence: "LOW", targetField: "grossSalaryAmount" }),
    });

    await expect(
      service.confirmCandidate({
        actor,
        candidateId: candidate.id,
        rationale: "低置信不能直接确认",
      }),
    ).rejects.toThrow("LOW_CONFIDENCE_MAPPING_REQUIRES_MANUAL_TARGET");
    expect(store.versions).toHaveLength(0);
  });

  it("marks name-only employee matches as low confidence and conflicts as blocking", () => {
    const employees: EmployeeIdentityRecord[] = [
      { id: "emp-a", clientId: "client-a", employeeCode: "A1", fullName: "Andi", workCity: "Jakarta" },
      { id: "emp-b", clientId: "client-a", employeeCode: "B1", fullName: "Budi" },
      { id: "emp-c", clientId: "client-a", employeeCode: "C1", fullName: "Budi" },
    ];

    expect(rankEmployeeMatch(matchRow({ fullNameRaw: "Andi" }), employees)).toMatchObject({
      employeeId: "emp-a",
      matchMethod: "NAME_ONLY",
      confidence: "LOW",
      status: "CANDIDATE",
    });
    expect(rankEmployeeMatch(matchRow({ fullNameRaw: "Budi" }), employees)).toMatchObject({
      matchMethod: "NAME_ONLY",
      confidence: "CONFLICT",
      status: "BLOCKED",
    });
  });

  it("blocks standardized input confirmation when critical evidence is missing", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new MemoryStandardizationStore();
    const service = new StandardizationService(store, new AuditService(auditStore));

    const preview = await service.createPreview({
      actor,
      draft: {
        clientId: "client-a",
        runId: "run-a",
        fieldMappingVersionId: "mapping-a",
        employeeMatchCandidateId: "match-a",
        employeeId: "emp-a",
        standardField: "bpjsHealthNumber",
        currencyCode: "IDR",
        value: { value: "BPJS-123" },
        evidenceStatus: "MISSING",
        evidenceRefs: [],
      },
    });

    expect(preview.status).toBe("BLOCKED");
    await expect(
      service.confirmInput({
        actor,
        inputId: preview.id,
        expectedLockVersion: preview.optimisticLockVersion,
      }),
    ).rejects.toThrow("STANDARDIZED_INPUT_BLOCKING_ISSUES");
  });
});

function mappingCandidate(
  overrides: Partial<Omit<FieldMappingCandidateRecord, "id" | "status" | "createdAt" | "updatedAt">> = {},
) {
  return {
    clientId: "client-a",
    runId: "run-a",
    source: "AGENT" as const,
    sourceSheetName: "门店工资",
    sourceColumnLabel: "BPJS",
    sampleValues: ["123", "456"],
    targetField: "bpjsHealthNumber",
    fieldCategory: "INPUT",
    confidence: "HIGH" as const,
    rationale: "表头和样例匹配 BPJS 编号",
    evidenceRefs: [],
    ...overrides,
  };
}

function matchRow(overrides: Partial<EmployeeMatchRow> = {}): EmployeeMatchRow {
  return {
    clientId: "client-a",
    runId: "run-a",
    fullNameRaw: "Andi",
    evidenceRefs: [],
    ...overrides,
  };
}

class MemoryMappingStore implements FieldMappingStore {
  candidates = new Map<string, FieldMappingCandidateRecord>();
  versions: FieldMappingVersionRecord[] = [];

  async findRunById(id: string) {
    return id === "run-a" ? { id, clientId: "client-a", status: "DRAFT" as const } : null;
  }
  async createCandidate(input: FieldMappingCandidateRecord) {
    this.candidates.set(input.id, structuredClone(input));
    return structuredClone(input);
  }
  async findCandidateById(id: string) {
    return this.candidates.get(id) ?? null;
  }
  async updateCandidateStatus(id: string, status: FieldMappingCandidateRecord["status"]) {
    const candidate = this.candidates.get(id);
    if (!candidate) throw new Error("FIELD_MAPPING_CANDIDATE_NOT_FOUND");
    const updated = { ...candidate, status };
    this.candidates.set(id, updated);
    return updated;
  }
  async nextVersionNumber() {
    return this.versions.length + 1;
  }
  async createVersion(input: FieldMappingVersionRecord) {
    this.versions.push(structuredClone(input));
    return structuredClone(input);
  }
}

class MemoryStandardizationStore implements StandardizationStore {
  inputs = new Map<string, StandardizedPayrollInputRecord>();

  async findRunById(id: string) {
    return id === "run-a" ? { id, clientId: "client-a", status: "DRAFT" as const } : null;
  }
  async findMappingVersionById(id: string) {
    return id === "mapping-a"
      ? { id, clientId: "client-a", runId: "run-a", status: "CONFIRMED" as const, confidence: "HIGH" as const }
      : null;
  }
  async findEmployeeMatchCandidateById(id: string) {
    return id === "match-a"
      ? { id, employeeId: "emp-a", status: "CONFIRMED" as const, confidence: "HIGH" as const }
      : null;
  }
  async createInput(input: StandardizedPayrollInputRecord) {
    this.inputs.set(input.id, structuredClone(input));
    return structuredClone(input);
  }
  async findInputById(id: string) {
    return this.inputs.get(id) ?? null;
  }
  async updateInput(input: Parameters<StandardizationStore["updateInput"]>[0]) {
    const current = this.inputs.get(input.id);
    if (!current) throw new Error("STANDARDIZED_INPUT_NOT_FOUND");
    const updated = { ...current, ...input, updatedAt: new Date() };
    this.inputs.set(input.id, structuredClone(updated));
    return structuredClone(updated);
  }
}
