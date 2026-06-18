import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { type ActorContext } from "@/domain/auth/permissions";
import { rankEmployeeMatch } from "@/domain/employees/employee-match-ranking";
import { type EmployeeIdentityRecord, type EmployeeMatchRow } from "@/domain/employees/employee-matching-service";
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

    await expect(service.confirmCandidate({ actor, candidateId: candidate.id, rationale: "低置信不能直接确认" })).rejects.toThrow(
      "LOW_CONFIDENCE_MAPPING_REQUIRES_MANUAL_TARGET",
    );
    expect(store.versions).toHaveLength(0);
  });

  it("blocks stale mapping candidate confirmation before creating a version", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new MemoryMappingStore();
    const service = new MappingService(store, new AuditService(auditStore));
    const candidate = await service.createCandidate({ actor, candidate: mappingCandidate() });
    store.forceStaleConfirmation = true;

    await expect(service.confirmCandidate({ actor, candidateId: candidate.id, rationale: "并发确认必须失败" })).rejects.toThrow(
      "FIELD_MAPPING_CANDIDATE_NOT_REVIEWABLE",
    );
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
      draft: standardInputDraft({
        standardField: "bpjsHealthNumber",
        value: { value: "BPJS-123" },
        amount: null,
        evidenceStatus: "MISSING",
        evidenceRefs: [],
      }),
    });

    expect(preview.status).toBe("BLOCKED");
    await expect(
      service.confirmInput({ actor, inputId: preview.id, expectedLockVersion: preview.optimisticLockVersion }),
    ).rejects.toThrow("STANDARDIZED_INPUT_BLOCKING_ISSUES");
  });

  it("blocks standardized input when mapping or employee match is missing", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new MemoryStandardizationStore();
    const service = new StandardizationService(store, new AuditService(auditStore));

    const preview = await service.createPreview({
      actor,
      draft: standardInputDraft({
        fieldMappingVersionId: undefined,
        employeeMatchCandidateId: undefined,
      }),
    });

    expect(preview.status).toBe("BLOCKED");
    expect(preview.validationIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["FIELD_MAPPING_REQUIRED", "EMPLOYEE_MATCH_REQUIRED"]),
    );
    await expect(
      service.confirmInput({ actor, inputId: preview.id, expectedLockVersion: preview.optimisticLockVersion }),
    ).rejects.toThrow("STANDARDIZED_INPUT_BLOCKING_ISSUES");
  });

  it("blocks confirming an already confirmed standardized input", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new MemoryStandardizationStore();
    const service = new StandardizationService(store, new AuditService(auditStore));
    const preview = await service.createPreview({ actor, draft: standardInputDraft() });
    const confirmed = await service.confirmInput({
      actor,
      inputId: preview.id,
      expectedLockVersion: preview.optimisticLockVersion,
    });

    await expect(
      service.confirmInput({
        actor,
        inputId: confirmed.id,
        expectedLockVersion: confirmed.optimisticLockVersion,
        amount: 999,
      }),
    ).rejects.toThrow("STANDARDIZED_INPUT_NOT_REVIEWABLE");
  });

  it("blocks standardized input confirmation when the atomic update loses the optimistic lock", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new MemoryStandardizationStore();
    const service = new StandardizationService(store, new AuditService(auditStore));
    const preview = await service.createPreview({ actor, draft: standardInputDraft() });
    store.forceStaleUpdate = true;

    await expect(
      service.confirmInput({ actor, inputId: preview.id, expectedLockVersion: preview.optimisticLockVersion }),
    ).rejects.toThrow("STANDARDIZED_INPUT_STALE_VERSION");
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

function standardInputDraft(
  overrides: Partial<Parameters<StandardizationService["createPreview"]>[0]["draft"]> = {},
) {
  return {
    clientId: "client-a",
    runId: "run-a",
    fieldMappingVersionId: "mapping-a",
    employeeMatchCandidateId: "match-a",
    employeeId: "emp-a",
    standardField: "grossSalaryAmount",
    currencyCode: "IDR",
    amount: 12000000,
    value: { amount: 12000000 },
    evidenceStatus: "VALID" as const,
    evidenceRefs: ["evidence:gross"],
    ...overrides,
  };
}

class MemoryMappingStore implements FieldMappingStore {
  candidates = new Map<string, FieldMappingCandidateRecord>();
  versions: FieldMappingVersionRecord[] = [];
  forceStaleConfirmation = false;

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
  async confirmCandidateWithVersion(input: Parameters<FieldMappingStore["confirmCandidateWithVersion"]>[0]) {
    const candidate = this.candidates.get(input.candidateId);
    if (!candidate) throw new Error("FIELD_MAPPING_CANDIDATE_NOT_FOUND");
    if (this.forceStaleConfirmation || candidate.status !== input.expectedStatus) {
      return null;
    }
    const version = { ...input.version, versionNumber: this.versions.length + 1 };
    this.versions.push(structuredClone(version));
    this.candidates.set(input.candidateId, { ...candidate, status: "CONFIRMED" });
    return structuredClone(version);
  }
}

class MemoryStandardizationStore implements StandardizationStore {
  inputs = new Map<string, StandardizedPayrollInputRecord>();
  forceStaleUpdate = false;

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
      ? {
          id,
          clientId: "client-a",
          runId: "run-a",
          employeeId: "emp-a",
          status: "CONFIRMED" as const,
          confidence: "HIGH" as const,
        }
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
    if (
      this.forceStaleUpdate ||
      current.optimisticLockVersion !== input.expectedLockVersion ||
      !input.reviewableStatuses.includes(current.status)
    ) {
      return null;
    }
    const updated = {
      ...current,
      status: input.status,
      evidenceStatus: input.evidenceStatus ?? current.evidenceStatus,
      evidenceRefs: input.evidenceRefs ?? current.evidenceRefs,
      value: input.value ?? current.value,
      amount: input.amount ?? current.amount,
      validationIssues: input.validationIssues ?? current.validationIssues,
      optimisticLockVersion: input.optimisticLockVersion,
      modifiedById: input.modifiedById,
      confirmedById: input.confirmedById,
      confirmedAt: input.confirmedAt,
      updatedAt: new Date(),
    };
    this.inputs.set(input.id, structuredClone(updated));
    return structuredClone(updated);
  }
}
