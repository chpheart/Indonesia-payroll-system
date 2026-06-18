import { type EvalCaseType } from "@/generated/prisma/client";
import { type AuditRiskLevel } from "@/domain/audit/audit-service";
import { type AgentNodeType, type JsonObject } from "@/domain/agent/agent-types";

export type GoldenFixture = JsonObject & {
  evaluator: string;
};

export type GoldenExpected = JsonObject;

export type GoldenCaseDefinition = {
  caseKey: string;
  nodeType: AgentNodeType;
  caseType: EvalCaseType;
  riskLevel: AuditRiskLevel;
  inputFixture: GoldenFixture;
  expectedOutput: GoldenExpected;
  sourceRefs: string[];
};

export type GoldenEvalTargetAdapter = {
  targetType: string;
  targetRef: string;
  policy: "CANDIDATE_ONLY" | "READ_ONLY" | "UNRESTRICTED";
  sourceRefs: string[];
  canGenerateQuestions: boolean;
  canFallbackWhenNoSource: boolean;
  canClassifyGrossMode: boolean;
  canBlockHighRisk: boolean;
  canMapCriticalFields: boolean;
  traceIncludesSensitiveData: boolean;
  previewBeforeWrite: boolean;
  evaluate: (fixture: GoldenFixture) => JsonObject;
};

export type GoldenEvalTargetConfig = Omit<GoldenEvalTargetAdapter, "evaluate">;
