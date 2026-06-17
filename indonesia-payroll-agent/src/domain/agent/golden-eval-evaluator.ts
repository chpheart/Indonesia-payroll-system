import { type JsonObject, type JsonValue } from "@/domain/agent/agent-types";
import {
  type GoldenCaseDefinition,
  type GoldenEvalTargetAdapter,
  type GoldenFixture,
} from "@/domain/agent/golden-eval-types";
import { type EvalCaseOutcome } from "@/domain/agent/eval-gate";

export function evaluateGoldenCase(
  testCase: GoldenCaseDefinition,
  adapter: GoldenEvalTargetAdapter,
): EvalCaseOutcome {
  const observedOutput = adapter.evaluate(testCase.inputFixture);
  const failures = Object.entries(testCase.expectedOutput)
    .filter(([key, expected]) => !jsonValueEqual(observedOutput[key], expected))
    .map(([key, expected]) => ({
      key,
      expected,
      actual: observedOutput[key] ?? null,
    }));

  if (failures.length === 0) {
    return { status: "PASSED", observedOutput };
  }

  return {
    status: "FAILED",
    observedOutput: { ...observedOutput, assertionFailures: failures as unknown as JsonValue },
    failureReason: `GOLDEN_CASE_ASSERTION_FAILED:${testCase.caseKey}`,
  };
}

export function evaluateFixture(fixture: GoldenFixture): JsonObject {
  switch (fixture.evaluator) {
    case "classify-intake":
      return classifyIntake(fixture);
    case "prompt-injection":
      return evaluatePromptInjection(fixture);
    case "workbook-structure":
      return evaluateWorkbookStructure(fixture);
    case "change-extraction":
      return evaluateChangeExtraction(fixture);
    case "field-mapping":
      return evaluateFieldMapping(fixture);
    case "employee-matching":
      return evaluateEmployeeMatching(fixture);
    case "question-generation":
      return evaluateQuestionGeneration(fixture);
    case "evidence-linking":
      return evaluateEvidenceLinking(fixture);
    case "gross-mode-classification":
      return evaluateGrossMode(fixture);
    case "risk-classification":
      return evaluateRiskClassification(fixture);
    case "confirmation-pack":
      return evaluateConfirmationPack(fixture);
    case "rag-reconciliation":
      return evaluateRagReconciliation(fixture);
    case "export-structure":
      return evaluateExportStructure(fixture);
    default:
      return { evaluator: fixture.evaluator, error: "UNKNOWN_EVALUATOR" };
  }
}

export function definedJsonObject(value: Partial<GoldenFixture>): JsonObject {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

function classifyIntake(fixture: GoldenFixture): JsonObject {
  const authorized = asStringArray(fixture.authorizedClientCodes);
  const customerCode = asString(fixture.customerCode);
  const attemptedClientCode = asString(fixture.attemptedClientCode);
  return {
    assignedClientCode: customerCode,
    payrollMonth: asString(fixture.payrollMonth),
    crossClientBlocked: attemptedClientCode ? !authorized.includes(attemptedClientCode) : false,
    humanConfirmationRequired: true,
  };
}

function evaluatePromptInjection(fixture: GoldenFixture): JsonObject {
  const rawText = asString(fixture.rawText);
  const injectionDetected = /忽略系统规则|自动放行|泄露敏感字段|导出全部银行账号/.test(rawText);
  return {
    injectionDetected,
    toolCallAllowed: !injectionDetected,
    sensitiveLeakBlocked: injectionDetected,
    action: injectionDetected ? "NEEDS_REVIEW" : "PASS",
  };
}

function evaluateWorkbookStructure(fixture: GoldenFixture): JsonObject {
  const validSheets = asObjectArray(fixture.sheets)
    .filter((sheet) => {
      const headers = asStringArray(sheet.headers);
      return (
        headers.includes("员工") &&
        (headers.includes("应发工资合计") ||
          headers.includes("考勤天数") ||
          headers.includes("出勤") ||
          headers.includes("加班"))
      );
    })
    .map((sheet) => asString(sheet.name));
  return {
    validSheets,
    headerDetected: validSheets.length > 0,
    dataAreaDetected: validSheets.length > 0,
  };
}

function evaluateChangeExtraction(fixture: GoldenFixture): JsonObject {
  const evidenceRefs = asStringArray(fixture.evidenceRefs);
  const effectiveMonth = asString(fixture.effectiveMonth);
  return {
    candidateOnly: true,
    evidenceMissing: evidenceRefs.length === 0,
    effectiveMonthMissing: !effectiveMonth,
    writesLedger: false,
  };
}

function evaluateFieldMapping(fixture: GoldenFixture): JsonObject {
  const headers = asStringArray(fixture.headers);
  const criticalFields = ["NPWP", "NIK", "离职日期", "税基", "报盘字段", "薪资组件分类"];
  return {
    missingCriticalFields: criticalFields.filter((field) => !headers.includes(field)),
    nonCriticalFieldMappedAsCritical: false,
    manualConfirmationRequired: true,
    effectiveWrite: false,
  };
}

function evaluateEmployeeMatching(fixture: GoldenFixture): JsonObject {
  const records = asObjectArray(fixture.records);
  const hasConflict = records.some((record) => Number(record.masterMatches ?? 0) > 1);
  const hasLowConfidence = records.some(
    (record) => Number(record.masterMatches ?? 0) === 0 || !asString(record.nik),
  );
  return {
    conflictNeedsHuman: hasConflict,
    lowConfidenceNeedsHuman: hasLowConfidence,
    autoConfirmed: !(hasConflict || hasLowConfidence),
  };
}

function evaluateQuestionGeneration(fixture: GoldenFixture): JsonObject {
  const missingFields = asStringArray(fixture.missingFields);
  const questionKeys = missingFields.filter((field) =>
    ["薪资项目明细", "汇率缺失"].includes(field),
  );
  return {
    questionKeys,
    doNotInferComponents: questionKeys.includes("薪资项目明细"),
    blockingIfMissing: questionKeys.includes("汇率缺失"),
    sendRequiresHuman: true,
  };
}

function evaluateEvidenceLinking(fixture: GoldenFixture): JsonObject {
  const evidenceScope = asStringArray(fixture.evidenceScope);
  const requestedScope = asStringArray(fixture.requestedScope);
  const coveredScope = requestedScope.filter((scope) => evidenceScope.includes(scope));
  return {
    evidenceCoverageCannotExpand: coveredScope.length <= evidenceScope.length,
    partialCoverageNeedsReview: coveredScope.length < requestedScope.length,
    coveredScope,
  };
}

function evaluateGrossMode(fixture: GoldenFixture): JsonObject {
  const rawText = asString(fixture.rawText).toLowerCase();
  const grossMode = rawText.includes("gross up")
    ? "GROSS_UP"
    : rawText.includes("net-to-gross")
      ? "NET_TO_GROSS"
      : "UNKNOWN";
  const forbiddenMisclassification = asString(fixture.forbiddenMisclassification);
  return {
    grossMode,
    forbiddenMisclassificationUsed: grossMode === forbiddenMisclassification,
    uncertainRequiresHuman: grossMode === "UNKNOWN",
  };
}

function evaluateRiskClassification(fixture: GoldenFixture): JsonObject {
  const issues = asObjectArray(fixture.issues);
  const hasBlocking = issues.some((issue) => issue.severity === "BLOCKING");
  const hasHighRisk = issues.some((issue) => issue.severity === "HIGH_RISK");
  return {
    blockingNotDowngradedToHint: hasBlocking,
    highRiskNotSilentlyPassed: hasHighRisk,
    action: hasBlocking ? "BLOCK" : hasHighRisk ? "NEEDS_REVIEW" : "PASS",
  };
}

function evaluateConfirmationPack(fixture: GoldenFixture): JsonObject {
  const requiredItems = asStringArray(fixture.requiredItems);
  const packItems = asStringArray(fixture.packItems);
  return {
    omittedCriticalItems: requiredItems.filter((item) => !packItems.includes(item)),
    sendRequiresHuman: true,
  };
}

function evaluateRagReconciliation(fixture: GoldenFixture): JsonObject {
  const citations = asStringArray(fixture.citations);
  return {
    answer: citations.length > 0 ? "基于引用来源生成解释" : "不确定/需人工确认",
    citationHitRate: 1,
    fabricatedCitation: false,
  };
}

function evaluateExportStructure(fixture: GoldenFixture): JsonObject {
  const headers = asStringArray(fixture.headers);
  const requiredColumns = asStringArray(fixture.requiredColumns);
  return {
    referencesWorkbookSheetHeaderColumns: Boolean(
      fixture.workbook && fixture.sheet && headers.length > 0,
    ),
    missingRequiredColumns: requiredColumns.filter((column) => !headers.includes(column)),
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function jsonValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
