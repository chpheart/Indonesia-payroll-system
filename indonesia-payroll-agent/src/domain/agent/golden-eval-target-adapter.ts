import { type JsonObject } from "@/domain/agent/agent-types";
import { evaluateFixture } from "@/domain/agent/golden-eval-evaluator";
import {
  type GoldenEvalTargetAdapter,
  type GoldenEvalTargetConfig,
  type GoldenFixture,
} from "@/domain/agent/golden-eval-types";

export function createGoldenEvalTargetAdapter(
  input: GoldenEvalTargetConfig,
): GoldenEvalTargetAdapter {
  return {
    ...input,
    evaluate: (fixture) => evaluateFixtureWithTarget(fixture, input),
  };
}

function evaluateFixtureWithTarget(
  fixture: GoldenFixture,
  target: GoldenEvalTargetConfig,
): JsonObject {
  const observed = evaluateFixture(fixture);
  if (target.policy !== "CANDIDATE_ONLY") {
    if ("candidateOnly" in observed) {
      observed.candidateOnly = false;
    }
    if ("writesLedger" in observed) {
      observed.writesLedger = true;
    }
    if ("effectiveWrite" in observed) {
      observed.effectiveWrite = true;
    }
  }
  if (!target.previewBeforeWrite) {
    if ("manualConfirmationRequired" in observed) {
      observed.manualConfirmationRequired = false;
    }
    if ("sendRequiresHuman" in observed) {
      observed.sendRequiresHuman = false;
    }
  }
  if (!target.canGenerateQuestions && "questionKeys" in observed) {
    observed.questionKeys = [];
  }
  if (!target.canFallbackWhenNoSource && fixture.evaluator === "rag-reconciliation") {
    observed.answer = "基于缺失来源生成解释";
    observed.fabricatedCitation = true;
  }
  if (!target.canClassifyGrossMode && fixture.evaluator === "gross-mode-classification") {
    observed.grossMode = "NET_TO_GROSS";
    observed.forbiddenMisclassificationUsed = true;
  }
  if (!target.canBlockHighRisk && fixture.evaluator === "risk-classification") {
    observed.blockingNotDowngradedToHint = false;
    observed.highRiskNotSilentlyPassed = false;
    observed.action = "PASS";
  }
  if (!target.canMapCriticalFields && fixture.evaluator === "field-mapping") {
    observed.missingCriticalFields = ["NPWP", "NIK", "离职日期", "税基", "报盘字段", "薪资组件分类"];
  }
  if (target.traceIncludesSensitiveData) {
    observed.sensitiveTraceBlocked = false;
  }
  observed.evaluatedTargetType = target.targetType;
  observed.evaluatedTargetRef = target.targetRef;
  return observed;
}
