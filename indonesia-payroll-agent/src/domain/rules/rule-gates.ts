import {
  type ActorContext,
  actorHasPermission,
  assertClientActionAllowed,
  PermissionDeniedError,
} from "@/domain/auth/permissions";
import {
  REQUIRED_REGRESSION_DATASETS,
  RuleServiceError,
  type RuleScopeType,
} from "@/domain/rules/rule-types";

type RegressionGateRun = {
  datasetCode: "BLUE_FOCUS" | "SANFU";
  status: "PASSED" | "WARNING" | "FAILED" | "BLOCKED";
  maxDiffIdr: unknown;
  blockingThresholdIdr: unknown;
};

export function scopeKeyForRule(
  scopeType: RuleScopeType,
  clientId?: string,
  componentId?: string,
): string {
  if (scopeType === "PUBLIC") {
    return "PUBLIC";
  }
  if (scopeType === "CUSTOMER" && clientId) {
    return `CLIENT:${clientId}`;
  }
  if (scopeType === "COMPONENT" && componentId) {
    return `COMPONENT:${componentId}`;
  }
  throw new RuleServiceError("RULE_SCOPE_TARGET_REQUIRED");
}

export function assertRuleConfigureAllowed(actor: ActorContext, clientId?: string): void {
  if (clientId) {
    assertClientActionAllowed(actor, "configureRules", clientId);
    return;
  }
  if (!actorHasPermission(actor, "rules.configure")) {
    throw new PermissionDeniedError("ROLE_MISSING_PERMISSION");
  }
}

export function assertRuleApprovalAllowed(actor: ActorContext, clientId?: string): void {
  if (clientId) {
    assertClientActionAllowed(actor, "approveRules", clientId);
    return;
  }
  if (!actorHasPermission(actor, "rules.approve")) {
    throw new PermissionDeniedError("ROLE_MISSING_PERMISSION");
  }
}

export function hasBlockingConflict(summary: Record<string, unknown>): boolean {
  return summary.hasBlockingConflict === true || summary.blocking === true;
}

export function assertRuleCanRecordRegression(status: string): void {
  if (status === "PUBLISHED") {
    throw new RuleServiceError("PUBLISHED_RULE_REGRESSION_IS_IMMUTABLE");
  }
}

export function regressionStatusFor(input: {
  expectedEmployeeCount: number;
  actualEmployeeCount: number;
  maxDiffIdr: number;
}) {
  if (
    input.expectedEmployeeCount !== input.actualEmployeeCount ||
    Math.abs(input.maxDiffIdr) > 10_000
  ) {
    return "BLOCKED" as const;
  }
  if (Math.abs(input.maxDiffIdr) > 1_000) {
    return "WARNING" as const;
  }
  return "PASSED" as const;
}

export function assertRegressionGate(regressionRuns: RegressionGateRun[]): void {
  for (const dataset of REQUIRED_REGRESSION_DATASETS) {
    if (!regressionRuns.some((run) => run.datasetCode === dataset)) {
      throw new RuleServiceError("REQUIRED_REGRESSION_DATASET_MISSING");
    }
  }

  const blockingRun = regressionRuns.find(
    (run) =>
      run.status === "FAILED" ||
      run.status === "BLOCKED" ||
      Math.abs(Number(run.maxDiffIdr)) > Number(run.blockingThresholdIdr),
  );
  if (blockingRun) {
    throw new RuleServiceError("RULE_REGRESSION_BLOCKED_PUBLISH");
  }
}
