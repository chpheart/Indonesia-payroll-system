export type RuleVersionType =
  | "PPH21"
  | "BPJS"
  | "THR"
  | "GROSS_UP"
  | "FX"
  | "ROUNDING"
  | "CUSTOMER_POLICY"
  | "COMPONENT_CLASSIFICATION";
export type RuleScopeType = "PUBLIC" | "CUSTOMER" | "COMPONENT";
export type RuleVersionStatus = "DRAFT" | "APPROVED" | "PUBLISHED" | "DISABLED" | "SUPERSEDED";
export type RuleApprovalDecision = "APPROVED" | "REJECTED";
export type RegressionDatasetCode = "BLUE_FOCUS" | "SANFU";
export type RegressionRunStatus = "PASSED" | "WARNING" | "FAILED" | "BLOCKED";

export type RuleVersionRecord = {
  id: string;
  ruleKey: string;
  ruleType: RuleVersionType;
  scopeType: RuleScopeType;
  scopeKey: string;
  clientId?: string | null;
  componentId?: string | null;
  versionNumber: number;
  effectiveMonth: string;
  status: RuleVersionStatus;
  content: Record<string, unknown>;
  conflictCheckSummary: Record<string, unknown>;
  changeSummary: string;
};

export type RuleApprovalRecord = {
  id: string;
  ruleVersionId: string;
  decision: RuleApprovalDecision;
  approverId?: string | null;
  note: string;
};

export type RegressionRunRecord = {
  id: string;
  ruleVersionId: string;
  datasetCode: RegressionDatasetCode;
  scenarioName: string;
  status: RegressionRunStatus;
  expectedEmployeeCount?: number | null;
  actualEmployeeCount?: number | null;
  maxDiffIdr: number;
  blockingThresholdIdr: number;
};

export const REQUIRED_REGRESSION_DATASETS: RegressionDatasetCode[] = ["BLUE_FOCUS", "SANFU"];

export class RuleServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RuleServiceError";
  }
}
