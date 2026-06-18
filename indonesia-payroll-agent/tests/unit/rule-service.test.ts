import { describe, expect, it } from "vitest";
import { AuditService, InMemoryAuditLogStore } from "@/domain/audit/audit-service";
import { type ActorContext } from "@/domain/auth/permissions";
import { RuleService, type RuleStore } from "@/domain/rules/rule-service";
import {
  RuleServiceError,
  type RegressionRunRecord,
  type RuleApprovalRecord,
  type RuleVersionRecord,
} from "@/domain/rules/rule-types";

const ruleAdmin: ActorContext = {
  id: "rule-admin",
  email: "rule-admin@example.local",
  roleCodes: ["RULE_ADMIN"],
  authorizedClientIds: ["client-a"],
};

const payrollLead: ActorContext = {
  id: "payroll-lead",
  email: "lead@example.local",
  roleCodes: ["PAYROLL_LEAD"],
  authorizedClientIds: ["client-a"],
};

function baseRule(status: RuleVersionRecord["status"]): RuleVersionRecord {
  return {
    id: "rule-1",
    ruleKey: "PPH21_TER",
    ruleType: "PPH21",
    scopeType: "CUSTOMER",
    scopeKey: "CLIENT:client-a",
    clientId: "client-a",
    versionNumber: 1,
    effectiveMonth: "2026-06",
    status,
    content: {},
    conflictCheckSummary: {},
    changeSummary: "TER update",
  };
}

class FakeRuleStore implements RuleStore {
  rule: RuleVersionRecord = baseRule("DRAFT");
  approvals: RuleApprovalRecord[] = [];
  regressions: RegressionRunRecord[] = [];

  async findRuleVersionById(id: string) {
    return id === this.rule.id ? this.rule : null;
  }

  async findLatestRuleVersion() {
    return this.rule;
  }

  async createRuleDraft(input: Omit<RuleVersionRecord, "id" | "status">) {
    this.rule = { ...input, id: "rule-draft", status: "DRAFT" };
    return this.rule;
  }

  async markRuleApproved(id: string) {
    this.rule = { ...this.rule, id, status: "APPROVED" };
    return this.rule;
  }

  async publishRuleVersion() {
    this.rule = { ...this.rule, status: "PUBLISHED" };
    return this.rule;
  }

  async disableRuleVersion() {
    this.rule = { ...this.rule, status: "DISABLED" };
    return this.rule;
  }

  async createApproval(input: Omit<RuleApprovalRecord, "id">) {
    const approval = { ...input, id: `approval-${this.approvals.length + 1}` };
    this.approvals.push(approval);
    return approval;
  }

  async findApprovals() {
    return this.approvals;
  }

  async createRegressionRun(input: Omit<RegressionRunRecord, "id">) {
    const regression = { ...input, id: `regression-${this.regressions.length + 1}` };
    this.regressions.push(regression);
    return regression;
  }

  async findRegressionRuns() {
    return this.regressions;
  }
}

describe("rule service", () => {
  it("rejects draft rule references from formal payroll runs", async () => {
    const service = new RuleService(
      new FakeRuleStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(service.assertRuleUsableForPayrollRun("rule-1")).rejects.toThrow(
      "DRAFT_RULE_CANNOT_BE_REFERENCED",
    );
  });

  it("requires both blue focus and sanfu regression before publish", async () => {
    const store = new FakeRuleStore();
    store.rule = baseRule("APPROVED");
    store.approvals = [{ id: "a1", ruleVersionId: "rule-1", decision: "APPROVED", note: "ok" }];
    store.regressions = [
      {
        id: "r1",
        ruleVersionId: "rule-1",
        datasetCode: "BLUE_FOCUS",
        scenarioName: "THR",
        status: "PASSED",
        maxDiffIdr: 0,
        blockingThresholdIdr: 10_000,
      },
    ];
    const service = new RuleService(store, new AuditService(new InMemoryAuditLogStore()));

    await expect(
      service.publishRule({ actor: payrollLead, ruleVersionId: "rule-1" }),
    ).rejects.toThrow(RuleServiceError);
  });

  it("blocks publish when regression exceeds IDR 10000", async () => {
    const store = new FakeRuleStore();
    store.rule = baseRule("APPROVED");
    store.approvals = [{ id: "a1", ruleVersionId: "rule-1", decision: "APPROVED", note: "ok" }];
    store.regressions = ["BLUE_FOCUS", "SANFU"].map((datasetCode) => ({
      id: datasetCode,
      ruleVersionId: "rule-1",
      datasetCode: datasetCode as "BLUE_FOCUS" | "SANFU",
      scenarioName: "monthly",
      status: "PASSED" as const,
      maxDiffIdr: datasetCode === "SANFU" ? 10_001 : 0,
      blockingThresholdIdr: 10_000,
    }));
    const service = new RuleService(store, new AuditService(new InMemoryAuditLogStore()));

    await expect(
      service.publishRule({ actor: payrollLead, ruleVersionId: "rule-1" }),
    ).rejects.toThrow("RULE_REGRESSION_BLOCKED_PUBLISH");
  });

  it("publishes approved rules with complete regression evidence", async () => {
    const auditStore = new InMemoryAuditLogStore();
    const store = new FakeRuleStore();
    store.rule = baseRule("APPROVED");
    store.approvals = [{ id: "a1", ruleVersionId: "rule-1", decision: "APPROVED", note: "ok" }];
    store.regressions = ["BLUE_FOCUS", "SANFU"].map((datasetCode) => ({
      id: datasetCode,
      ruleVersionId: "rule-1",
      datasetCode: datasetCode as "BLUE_FOCUS" | "SANFU",
      scenarioName: "monthly",
      status: "PASSED" as const,
      maxDiffIdr: 0,
      blockingThresholdIdr: 10_000,
    }));
    const service = new RuleService(store, new AuditService(auditStore));

    const published = await service.publishRule({ actor: payrollLead, ruleVersionId: "rule-1" });

    expect(published.status).toBe("PUBLISHED");
    expect((await auditStore.listAuditLogs())[0]).toMatchObject({
      action: "RULE_VERSION_PUBLISHED",
      riskLevel: "R3",
    });
  });

  it("rejects customer rules that conflict with public baselines", async () => {
    const service = new RuleService(
      new FakeRuleStore(),
      new AuditService(new InMemoryAuditLogStore()),
    );

    await expect(
      service.createDraft({
        actor: ruleAdmin,
        ruleKey: "SANFU_SPLIT",
        ruleType: "CUSTOMER_POLICY",
        scopeType: "CUSTOMER",
        clientId: "client-a",
        effectiveMonth: "2026-06",
        content: {},
        conflictCheckSummary: { hasBlockingConflict: true },
        changeSummary: "try override public baseline",
      }),
    ).rejects.toThrow("CUSTOMER_RULE_CONFLICTS_PUBLIC_BASELINE");
  });
});
