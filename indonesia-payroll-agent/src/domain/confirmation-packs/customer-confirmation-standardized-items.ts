import {
  type CoverageScope,
  normalizeCoverageScope,
} from "@/domain/confirmation-packs/pack-coverage-service";
import {
  type CustomerConfirmationPackItemDraft,
  type PackRunSnapshot,
  type PackSourceSnapshot,
  type PackStandardizedInput,
} from "@/domain/confirmation-packs/customer-confirmation-pack-types";

export function standardizedInputItems(snapshot: PackSourceSnapshot): CustomerConfirmationPackItemDraft[] {
  const covered = ledgerCoverageKeys(snapshot);
  const previousDiffs = previousDifferenceKeys(snapshot);

  return snapshot.standardizedInputs
    .filter((input) => !covered.has(standardizedInputKey(input)))
    .filter((input) => !previousDiffs.has(standardizedInputKey(input)))
    .filter((input) => input.status === "BLOCKED" || input.evidenceStatus !== "VALID" || isCriticalField(input.standardField))
    .map((input, index) => {
      const critical = isCriticalField(input.standardField) || input.status === "BLOCKED";
      return {
        category: "MONTHLY_CHANGE",
        status: "OPEN",
        sourceObjectType: "STANDARDIZED_PAYROLL_INPUT",
        sourceObjectId: input.id,
        targetEmployeeId: input.employeeId ?? null,
        targetField: input.standardField,
        title: `标准化输入需确认 · ${input.employeeLabel ?? "Run"} · ${input.standardField}`,
        detail: `标准化值 ${formatStandardizedValue(input)}；状态 ${input.status}；证据 ${input.evidenceStatus}${input.sourceLabel ? `；来源 ${input.sourceLabel}` : ""}`,
        riskLevel: critical ? "R2" : "R1",
        isCritical: critical,
        isSystemRequired: critical,
        coverageScope: standardizedInputCoverage(snapshot.run, input),
        evidenceRefs: input.evidenceRefs,
        sortOrder: 200 + index,
      };
    });
}

export function previousRunDifferenceItems(snapshot: PackSourceSnapshot): CustomerConfirmationPackItemDraft[] {
  if (!snapshot.run.previousRunRef) {
    return [];
  }
  const covered = ledgerCoverageKeys(snapshot);
  const previousByKey = new Map(snapshot.previousStandardizedInputs.map((input) => [standardizedInputKey(input), input]));

  return snapshot.standardizedInputs
    .filter((input) => !covered.has(standardizedInputKey(input)))
    .map((input) => ({ input, previous: previousByKey.get(standardizedInputKey(input)) }))
    .filter(({ input, previous }) => previous && formatComparableValue(input) !== formatComparableValue(previous))
    .map(({ input, previous }, index) => {
      const critical = isCriticalField(input.standardField);
      return {
        category: "MONTHLY_CHANGE",
        status: "OPEN",
        sourceObjectType: "STANDARDIZED_PAYROLL_INPUT",
        sourceObjectId: input.id,
        targetEmployeeId: input.employeeId ?? null,
        targetField: input.standardField,
        title: `上月差异需确认 · ${input.employeeLabel ?? "Run"} · ${input.standardField}`,
        detail: `上月 ${formatStandardizedValue(previous!)} -> 本月 ${formatStandardizedValue(input)}；来源 ${snapshot.run.previousRunRef}`,
        riskLevel: critical ? "R3" : "R2",
        isCritical: true,
        isSystemRequired: true,
        coverageScope: standardizedInputCoverage(snapshot.run, input, previous),
        evidenceRefs: input.evidenceRefs,
        sortOrder: 240 + index,
      };
    });
}

export function criticalStandardizedSourceCount(
  source: Pick<PackSourceSnapshot, "ledgerEntries" | "standardizedInputs" | "previousStandardizedInputs">,
) {
  const covered = ledgerCoverageKeys(source);
  const previousDiffs = previousDifferenceKeys(source);
  const standardizedCount = source.standardizedInputs
    .filter((input) => !covered.has(standardizedInputKey(input)))
    .filter((input) => !previousDiffs.has(standardizedInputKey(input)))
    .filter((input) => input.status === "BLOCKED" || input.evidenceStatus !== "VALID" || isCriticalField(input.standardField)).length;

  return previousDiffs.size + standardizedCount;
}

function previousDifferenceKeys(snapshot: Pick<PackSourceSnapshot, "standardizedInputs" | "previousStandardizedInputs">) {
  const previousByKey = new Map(snapshot.previousStandardizedInputs.map((input) => [standardizedInputKey(input), input]));
  return new Set(
    snapshot.standardizedInputs
      .filter((input) => {
        const previous = previousByKey.get(standardizedInputKey(input));
        return previous && formatComparableValue(input) !== formatComparableValue(previous);
      })
      .map(standardizedInputKey),
  );
}

function ledgerCoverageKeys(snapshot: Pick<PackSourceSnapshot, "ledgerEntries">) {
  return new Set(snapshot.ledgerEntries.map((entry) => `${entry.targetEmployeeId ?? "RUN"}:${entry.targetField}`));
}

function standardizedInputKey(input: PackStandardizedInput) {
  return `${input.employeeId ?? "RUN"}:${input.standardField}`;
}

function standardizedInputCoverage(
  run: PackRunSnapshot,
  input: PackStandardizedInput,
  previous?: PackStandardizedInput | null,
): CoverageScope {
  return normalizeCoverageScope({
    type: "MIXED",
    runId: run.id,
    dataVersionRef: run.dataVersionRef,
    employeeIds: input.employeeId ? [input.employeeId] : [],
    fields: [input.standardField],
    sourceObjectRefs: [
      `STANDARDIZED_PAYROLL_INPUT:${input.id}`,
      ...(previous ? [`PREVIOUS_STANDARDIZED_PAYROLL_INPUT:${previous.id}`] : []),
    ],
  });
}

function formatStandardizedValue(input: PackStandardizedInput) {
  return input.amount ? `${input.amount} ${input.currencyCode}` : formatValue(input.value);
}

function formatComparableValue(input: PackStandardizedInput) {
  return input.amount ? `${input.amount}:${input.currencyCode}` : JSON.stringify(input.value);
}

function isCriticalField(field: string) {
  return /amount|salary|bank|bpjs|tax|npwp|ptkp|employee|template|fx|rate/i.test(field);
}

function formatValue(value: unknown) {
  return JSON.stringify(value).slice(0, 180);
}
