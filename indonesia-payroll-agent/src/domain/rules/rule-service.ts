import { type ActorContext } from "@/domain/auth/permissions";
import { type AuditService } from "@/domain/audit/audit-service";
import {
  assertRegressionGate,
  assertRuleApprovalAllowed,
  assertRuleConfigureAllowed,
  hasBlockingConflict,
  scopeKeyForRule,
} from "@/domain/rules/rule-gates";
import {
  RuleServiceError,
  type RegressionRunRecord,
  type RegressionRunStatus,
  type RegressionDatasetCode,
  type RuleApprovalDecision,
  type RuleApprovalRecord,
  type RuleScopeType,
  type RuleVersionRecord,
  type RuleVersionType,
} from "@/domain/rules/rule-types";

export type RuleStore = {
  findRuleVersionById(id: string): Promise<RuleVersionRecord | null>;
  findLatestRuleVersion(input: {
    ruleKey: string;
    scopeKey: string;
  }): Promise<RuleVersionRecord | null>;
  createRuleDraft(
    input: Omit<RuleVersionRecord, "id" | "status"> & { draftedById: string },
  ): Promise<RuleVersionRecord>;
  markRuleApproved(id: string): Promise<RuleVersionRecord>;
  publishRuleVersion(input: { id: string; publishedById: string }): Promise<RuleVersionRecord>;
  disableRuleVersion(input: { id: string; disabledById: string }): Promise<RuleVersionRecord>;
  createApproval(
    input: Omit<RuleApprovalRecord, "id"> & { approverId: string },
  ): Promise<RuleApprovalRecord>;
  findApprovals(ruleVersionId: string): Promise<RuleApprovalRecord[]>;
  createRegressionRun(
    input: Omit<RegressionRunRecord, "id"> & { runById: string },
  ): Promise<RegressionRunRecord>;
  findRegressionRuns(ruleVersionId: string): Promise<RegressionRunRecord[]>;
};

export class RuleService {
  constructor(
    private readonly store: RuleStore,
    private readonly auditService: AuditService,
  ) {}

  async createDraft(input: {
    actor: ActorContext;
    ruleKey: string;
    ruleType: RuleVersionType;
    scopeType: RuleScopeType;
    clientId?: string;
    componentId?: string;
    effectiveMonth: string;
    content: Record<string, unknown>;
    conflictCheckSummary?: Record<string, unknown>;
    changeSummary: string;
  }): Promise<RuleVersionRecord> {
    assertRuleConfigureAllowed(input.actor, input.clientId);
    const ruleKey = input.ruleKey.trim().toUpperCase();
    const changeSummary = input.changeSummary.trim();
    if (!ruleKey || !changeSummary) {
      throw new RuleServiceError("RULE_KEY_AND_CHANGE_SUMMARY_REQUIRED");
    }

    const scopeKey = scopeKeyForRule(input.scopeType, input.clientId, input.componentId);
    const conflictCheckSummary = input.conflictCheckSummary ?? {};
    if (hasBlockingConflict(conflictCheckSummary)) {
      throw new RuleServiceError("CUSTOMER_RULE_CONFLICTS_PUBLIC_BASELINE");
    }

    const latest = await this.store.findLatestRuleVersion({ ruleKey, scopeKey });
    const rule = await this.store.createRuleDraft({
      ruleKey,
      ruleType: input.ruleType,
      scopeType: input.scopeType,
      scopeKey,
      clientId: input.clientId,
      componentId: input.componentId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      effectiveMonth: input.effectiveMonth,
      content: input.content,
      conflictCheckSummary,
      changeSummary,
      draftedById: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "RULE_VERSION_DRAFTED",
      objectType: "RULE_VERSION",
      objectId: rule.id,
      riskLevel: "R2",
      clientId: rule.clientId ?? undefined,
      metadata: {
        ruleKey: rule.ruleKey,
        scopeType: rule.scopeType,
        versionNumber: rule.versionNumber,
        inputSummary: "起草规则版本，不进入正式算薪",
        outputSummary: "规则处于 DRAFT，发布前必须审批并通过回归",
      },
    });

    return rule;
  }

  async approveRule(input: {
    actor: ActorContext;
    ruleVersionId: string;
    decision: RuleApprovalDecision;
    note: string;
  }): Promise<RuleApprovalRecord> {
    const rule = await this.requireRule(input.ruleVersionId);
    assertRuleApprovalAllowed(input.actor, rule.clientId ?? undefined);
    const note = input.note.trim();
    if (!note) {
      throw new RuleServiceError("RULE_APPROVAL_NOTE_REQUIRED");
    }

    const approval = await this.store.createApproval({
      ruleVersionId: rule.id,
      decision: input.decision,
      approverId: input.actor.id,
      note,
    });
    if (input.decision === "APPROVED" && rule.status === "DRAFT") {
      await this.store.markRuleApproved(rule.id);
    }

    await this.auditService.record({
      actor: input.actor,
      action: "RULE_VERSION_APPROVED",
      objectType: "RULE_VERSION",
      objectId: rule.id,
      riskLevel: "R3",
      clientId: rule.clientId ?? undefined,
      metadata: { decision: input.decision, note },
    });

    return approval;
  }

  async recordRegressionRun(input: {
    actor: ActorContext;
    ruleVersionId: string;
    datasetCode: RegressionDatasetCode;
    scenarioName: string;
    status: RegressionRunStatus;
    expectedEmployeeCount?: number;
    actualEmployeeCount?: number;
    maxDiffIdr: number;
  }): Promise<RegressionRunRecord> {
    const rule = await this.requireRule(input.ruleVersionId);
    assertRuleConfigureAllowed(input.actor, rule.clientId ?? undefined);
    const regression = await this.store.createRegressionRun({
      ruleVersionId: rule.id,
      datasetCode: input.datasetCode,
      scenarioName: input.scenarioName.trim(),
      status: input.status,
      expectedEmployeeCount: input.expectedEmployeeCount,
      actualEmployeeCount: input.actualEmployeeCount,
      maxDiffIdr: input.maxDiffIdr,
      blockingThresholdIdr: 10_000,
      runById: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "REGRESSION_RUN_RECORDED",
      objectType: "REGRESSION_RUN",
      objectId: regression.id,
      riskLevel: regression.status === "PASSED" ? "R1" : "R2",
      clientId: rule.clientId ?? undefined,
      metadata: {
        ruleVersionId: rule.id,
        datasetCode: regression.datasetCode,
        status: regression.status,
        maxDiffIdr: regression.maxDiffIdr,
      },
    });

    return regression;
  }

  async publishRule(input: {
    actor: ActorContext;
    ruleVersionId: string;
  }): Promise<RuleVersionRecord> {
    const rule = await this.requireRule(input.ruleVersionId);
    assertRuleApprovalAllowed(input.actor, rule.clientId ?? undefined);
    if (rule.status === "PUBLISHED") {
      return rule;
    }

    const approvals = await this.store.findApprovals(rule.id);
    if (!approvals.some((approval) => approval.decision === "APPROVED")) {
      throw new RuleServiceError("RULE_APPROVAL_REQUIRED_BEFORE_PUBLISH");
    }
    assertRegressionGate(await this.store.findRegressionRuns(rule.id));

    const published = await this.store.publishRuleVersion({
      id: rule.id,
      publishedById: input.actor.id,
    });
    await this.auditService.record({
      actor: input.actor,
      action: "RULE_VERSION_PUBLISHED",
      objectType: "RULE_VERSION",
      objectId: rule.id,
      riskLevel: "R3",
      clientId: rule.clientId ?? undefined,
      metadata: {
        ruleKey: rule.ruleKey,
        versionNumber: rule.versionNumber,
        inputSummary: "发布规则版本，正式 payroll run 可引用",
        outputSummary: "已通过审批和蓝色光标/三福回归门禁",
      },
    });

    return published;
  }

  async disableRule(input: {
    actor: ActorContext;
    ruleVersionId: string;
    reason: string;
  }): Promise<RuleVersionRecord> {
    const rule = await this.requireRule(input.ruleVersionId);
    assertRuleApprovalAllowed(input.actor, rule.clientId ?? undefined);
    if (rule.status !== "PUBLISHED") {
      throw new RuleServiceError("ONLY_PUBLISHED_RULE_CAN_BE_DISABLED");
    }

    const disabled = await this.store.disableRuleVersion({
      id: rule.id,
      disabledById: input.actor.id,
    });
    await this.auditService.record({
      actor: input.actor,
      action: "RULE_VERSION_DISABLED",
      objectType: "RULE_VERSION",
      objectId: rule.id,
      riskLevel: "R3",
      clientId: rule.clientId ?? undefined,
      metadata: { reason: input.reason.trim() },
    });

    return disabled;
  }

  async assertRuleUsableForPayrollRun(ruleVersionId: string): Promise<RuleVersionRecord> {
    const rule = await this.requireRule(ruleVersionId);
    if (rule.status === "DRAFT") {
      throw new RuleServiceError("DRAFT_RULE_CANNOT_BE_REFERENCED");
    }
    if (rule.status !== "PUBLISHED") {
      throw new RuleServiceError("RULE_VERSION_NOT_PUBLISHED");
    }

    return rule;
  }

  private async requireRule(ruleVersionId: string): Promise<RuleVersionRecord> {
    const rule = await this.store.findRuleVersionById(ruleVersionId);
    if (!rule) {
      throw new RuleServiceError("RULE_VERSION_NOT_FOUND");
    }

    return rule;
  }
}
