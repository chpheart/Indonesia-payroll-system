import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { type ActorContext } from "@/domain/auth/permissions";
import {
  ChangeLedgerService,
  type ChangeLedgerEntryRecord,
  type ChangeLedgerStore,
} from "@/domain/changes/change-ledger-service";
import {
  ChangeProposalService,
  type ChangeProposalDraft,
  type ChangeProposalRecord,
} from "@/domain/changes/change-proposal-service";

const actor: ActorContext = {
  id: "reviewer-1",
  email: "reviewer@example.local",
  roleCodes: ["DELIVERY_SPECIALIST"],
  authorizedClientIds: ["client-a"],
};

function draft(overrides: Partial<ChangeProposalDraft> = {}): ChangeProposalDraft {
  return {
    clientId: "client-a",
    runId: "run-a",
    rawInputItemId: "raw-a",
    source: "AI_EXTRACTION",
    proposalType: "SALARY_ADJUSTMENT",
    targetObjectType: "EmployeeMasterVersion",
    targetField: "salaryAmount",
    previousValue: { amount: 10_000_000 },
    proposedValue: { amount: 12_000_000 },
    effectiveFrom: "2026-06",
    riskLevel: "R3",
    confidence: "HIGH",
    reason: "客户确认调薪",
    differencePreview: { delta: 2_000_000 },
    evidenceRefs: ["raw-input:raw-a"],
    requiredEvidenceRefs: [],
    relatedProposalIds: [],
    ...overrides,
  };
}

describe("phase 8 change proposal services", () => {
  it("keeps created proposals out of the ledger until explicit approval", async () => {
    const { proposalService, store } = createServices();

    const proposal = await proposalService.createProposal({ actor, draft: draft() });

    expect(proposal.status).toBe("PENDING_REVIEW");
    expect(store.ledgerEntries).toHaveLength(0);
  });

  it("blocks low-confidence proposal approval and preserves proposal-before-commit", async () => {
    const { proposalService, ledgerService, store } = createServices();
    const proposal = await proposalService.createProposal({
      actor,
      draft: draft({ confidence: "LOW" }),
    });

    await expect(
      ledgerService.approveProposal({
        actor,
        proposalId: proposal.id,
        reviewNote: "不能直接采纳低置信候选",
      }),
    ).rejects.toThrow("LOW_CONFIDENCE_PROPOSAL_REQUIRES_MODIFICATION_OR_REJECTION");
    expect(store.ledgerEntries).toHaveLength(0);
    expect((await store.findProposalById(proposal.id))?.status).toBe("PENDING_REVIEW");
  });

  it("creates an immutable ledger entry only after evidence-backed human approval", async () => {
    const { proposalService, ledgerService, store, auditStore } = createServices();
    const proposal = await proposalService.createProposal({
      actor,
      draft: draft({ confidence: "LOW" }),
    });

    const result = await ledgerService.approveProposal({
      actor,
      proposalId: proposal.id,
      reviewNote: "人工确认证据和金额",
      confidence: "MEDIUM",
      evidenceRefs: ["raw-input:raw-a", "evidence:salary-confirmation"],
      formalObjectType: "EmployeeMasterVersion",
      formalObjectVersionRef: "employee-a:v2",
    });

    expect(result.proposal.status).toBe("APPROVED_WITH_MODIFICATION");
    expect(result.ledgerEntry).toMatchObject({
      proposalId: proposal.id,
      targetField: "salaryAmount",
      formalObjectVersionRef: "employee-a:v2",
    });
    expect(store.ledgerEntries).toHaveLength(1);
    expect((await auditStore.listAuditLogs()).map((log) => log.action)).toContain(
      "CHANGE_LEDGER_ENTRY_CREATED",
    );
  });
});

function createServices() {
  const auditStore = new InMemoryAuditLogStore();
  const store = new MemoryChangeStore();
  return {
    auditStore,
    store,
    proposalService: new ChangeProposalService(store, new AuditService(auditStore)),
    ledgerService: new ChangeLedgerService(store, new AuditService(auditStore)),
  };
}

class MemoryChangeStore implements ChangeLedgerStore {
  readonly proposals = new Map<string, ChangeProposalRecord>();
  readonly ledgerEntries: ChangeLedgerEntryRecord[] = [];

  async findRunById(id: string) {
    return id === "run-a"
      ? { id, clientId: "client-a", payrollMonth: "2026-06", status: "DRAFT" as const }
      : null;
  }

  async findRawInputById(id: string) {
    return id === "raw-a"
      ? {
          id,
          clientId: "client-a",
          payrollMonth: "2026-06",
          runId: "run-a",
          evidenceCandidateRefs: ["raw-input:raw-a"],
        }
      : null;
  }

  async createProposal(input: ChangeProposalRecord) {
    this.proposals.set(input.id, structuredClone(input));
    return structuredClone(input);
  }

  async findProposalById(id: string) {
    const proposal = this.proposals.get(id);
    return proposal ? structuredClone(proposal) : null;
  }

  async updateProposal(input: Parameters<ChangeLedgerStore["updateProposal"]>[0]) {
    const current = this.proposals.get(input.id);
    if (!current) {
      throw new Error("CHANGE_PROPOSAL_NOT_FOUND");
    }
    const updated = { ...current, ...input, updatedAt: new Date() };
    this.proposals.set(updated.id, structuredClone(updated));
    return structuredClone(updated);
  }

  async createLedgerEntry(input: ChangeLedgerEntryRecord) {
    this.ledgerEntries.push(structuredClone(input));
    return structuredClone(input);
  }

  async findLedgerEntryByProposalId(proposalId: string) {
    return this.ledgerEntries.find((entry) => entry.proposalId === proposalId) ?? null;
  }
}
