import {
  type CoverageScope,
  normalizeCoverageScope,
} from "@/domain/confirmation-packs/pack-coverage-service";
import {
  criticalStandardizedSourceCount,
  previousRunDifferenceItems,
  standardizedInputItems,
} from "@/domain/confirmation-packs/customer-confirmation-standardized-items";
import {
  type CustomerConfirmationPackDraft,
  type CustomerConfirmationPackItemCategory,
  type CustomerConfirmationPackItemDraft,
  type CustomerConfirmationPackItemStatus,
  type PackIssue,
  type PackRunSnapshot,
  type PackSourceSnapshot,
} from "@/domain/confirmation-packs/customer-confirmation-pack-types";

export {
  CUSTOMER_CONFIRMATION_PACK_ITEM_CATEGORIES,
  CUSTOMER_CONFIRMATION_PACK_ITEM_STATUSES,
  CUSTOMER_CONFIRMATION_PACK_STATUSES,
} from "@/domain/confirmation-packs/customer-confirmation-pack-types";
export type {
  CustomerConfirmationPackDraft,
  CustomerConfirmationPackItemCategory,
  CustomerConfirmationPackItemDraft,
  CustomerConfirmationPackItemStatus,
  CustomerConfirmationPackStatus,
  PackIssue,
  PackLedgerEntry,
  PackQuestion,
  PackRunSnapshot,
  PackSourceSnapshot,
} from "@/domain/confirmation-packs/customer-confirmation-pack-types";

const BLOCKING_STATUSES = new Set(["PENDING", "SENT_TO_CUSTOMER", "WAITING_CUSTOMER_REPLY"]);

export function buildCustomerConfirmationPackDraft(
  snapshot: PackSourceSnapshot,
): CustomerConfirmationPackDraft {
  const items = [
    ...ledgerItems(snapshot),
    ...standardizedInputItems(snapshot),
    ...previousRunDifferenceItems(snapshot),
    ...questionItems(snapshot),
    ...issueItems(snapshot, snapshot.blockingIssues, "EXCEPTION"),
    ...issueItems(snapshot, snapshot.highRiskIssues, "CONFIRMATION_REQUIRED"),
    ...invalidConfirmationItems(snapshot),
  ].sort((left, right) => left.sortOrder - right.sortOrder);

  const sourceSnapshot = {
    runStatus: snapshot.run.status,
    ledgerEntryCount: snapshot.ledgerEntries.length,
    standardizedInputCount: snapshot.standardizedInputs.length,
    previousRunDifferenceCount: previousRunDifferenceItems(snapshot).length,
    openQuestionCount: snapshot.questions.filter((question) => BLOCKING_STATUSES.has(question.status)).length,
    blockingIssueCount: snapshot.blockingIssues.length,
    highRiskIssueCount: snapshot.highRiskIssues.length,
    invalidConfirmationCount: snapshot.invalidConfirmations.length,
    resultVersionRef: snapshot.run.resultVersionRef ?? null,
    exportPreviewVersionRef: snapshot.run.exportPreviewVersionRef ?? null,
    previousRunRef: snapshot.run.previousRunRef ?? null,
  };

  return {
    runId: snapshot.run.id,
    clientId: snapshot.run.clientId,
    status: "DRAFT",
    dataVersionRef: snapshot.run.dataVersionRef,
    resultVersionRef: snapshot.run.resultVersionRef ?? null,
    exportPreviewVersionRef: snapshot.run.exportPreviewVersionRef ?? null,
    sourceSnapshot,
    generatedMessage: buildSuggestedWechatMessage(snapshot, items),
    items: [
      ...items,
      {
        category: "SUGGESTED_MESSAGE",
        status: "OPEN",
        title: "建议企业微信话术",
        detail: buildSuggestedWechatMessage(snapshot, items),
        riskLevel: criticalItemCount(items) > 0 ? "R2" : "R1",
        isCritical: false,
        isSystemRequired: false,
        coverageScope: fullRunCoverage(snapshot.run),
        evidenceRefs: [],
        sortOrder: 900,
      },
    ],
  };
}

export function assertPackItemCanChangeVisibility(input: {
  item: Pick<CustomerConfirmationPackItemDraft, "isCritical" | "isSystemRequired" | "title">;
  nextStatus: CustomerConfirmationPackItemStatus;
  handlingReason?: string | null;
}): void {
  if (input.nextStatus === "CONFIRMED" && (input.item.isCritical || input.item.isSystemRequired)) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_CRITICAL_ITEM_REQUIRES_CUSTOMER_CONFIRMATION");
  }
  if (input.nextStatus === "INVALIDATED" && (input.item.isCritical || input.item.isSystemRequired)) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_CRITICAL_ITEM_CANNOT_BE_INVALIDATED_MANUALLY");
  }
  const hiding = input.nextStatus === "INTERNAL_HANDLING" || input.nextStatus === "NOT_CUSTOMER_FACING";
  if (!hiding) {
    return;
  }
  if (!input.handlingReason?.trim()) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_HANDLING_REASON_REQUIRED");
  }
  if (input.item.isCritical || input.item.isSystemRequired) {
    throw new Error("CUSTOMER_CONFIRMATION_PACK_CRITICAL_ITEM_CANNOT_BE_HIDDEN");
  }
}

export function assertPackHasNoCriticalOmissions(input: {
  items: CustomerConfirmationPackItemDraft[];
  source: Pick<
    PackSourceSnapshot,
    | "ledgerEntries"
    | "questions"
    | "standardizedInputs"
    | "previousStandardizedInputs"
    | "blockingIssues"
    | "highRiskIssues"
    | "invalidConfirmations"
  >;
}): void {
  const criticalSourceCount =
    input.source.ledgerEntries.filter((entry) => isHighRisk(entry.riskLevel) || isCriticalField(entry.targetField)).length +
    criticalStandardizedSourceCount(input.source) +
    input.source.blockingIssues.length +
    input.source.highRiskIssues.length +
    input.source.invalidConfirmations.length +
    input.source.questions.filter((question) => question.blockingIssueRef || isHighRisk(question.riskLevel)).length;
  const criticalItemCountValue = criticalItemCount(input.items);

  if (criticalItemCountValue < criticalSourceCount) {
    throw new Error("CONFIRMATION_PACK_CRITICAL_OMISSION");
  }
}

function ledgerItems(snapshot: PackSourceSnapshot): CustomerConfirmationPackItemDraft[] {
  return snapshot.ledgerEntries.map((entry, index) => ({
    category: "MONTHLY_CHANGE",
    status: "OPEN",
    sourceObjectType: "CHANGE_LEDGER_ENTRY",
    sourceObjectId: entry.id,
    targetEmployeeId: entry.targetEmployeeId ?? null,
    targetField: entry.targetField,
    title: `${entry.employeeLabel ?? "Run"} · ${entry.targetField}`,
    detail: `${entry.entryType}: ${formatValue(entry.previousValue)} -> ${formatValue(entry.newValue)}`,
    riskLevel: entry.riskLevel,
    isCritical: isHighRisk(entry.riskLevel) || isCriticalField(entry.targetField),
    isSystemRequired: isHighRisk(entry.riskLevel) || isCriticalField(entry.targetField),
    coverageScope: normalizeCoverageScope({
      type: entry.targetEmployeeId ? "MIXED" : "FULL_RUN",
      runId: snapshot.run.id,
      dataVersionRef: snapshot.run.dataVersionRef,
      employeeIds: entry.targetEmployeeId ? [entry.targetEmployeeId] : [],
      fields: [entry.targetField],
    }),
    evidenceRefs: entry.evidenceRefs,
    sortOrder: 100 + index,
  }));
}

function questionItems(snapshot: PackSourceSnapshot): CustomerConfirmationPackItemDraft[] {
  return snapshot.questions
    .filter((question) => BLOCKING_STATUSES.has(question.status))
    .map((question, index) => ({
      category: "MISSING_INFORMATION",
      status: "OPEN",
      sourceObjectType: "QUESTION_ITEM",
      sourceObjectId: question.id,
      targetField: question.targetField ?? null,
      title: question.title,
      detail: `${question.detail}\n原因：${question.reason}`,
      riskLevel: question.riskLevel,
      isCritical: Boolean(question.blockingIssueRef) || isHighRisk(question.riskLevel),
      isSystemRequired: Boolean(question.blockingIssueRef) || isHighRisk(question.riskLevel),
      coverageScope: normalizeCoverageScope({
        type: "MIXED",
        runId: snapshot.run.id,
        dataVersionRef: snapshot.run.dataVersionRef,
        fields: question.targetField ? [question.targetField] : [],
        sourceObjectRefs: [`QUESTION_ITEM:${question.id}`],
      }),
      evidenceRefs: question.evidenceRefs,
      sortOrder: 300 + index,
    }));
}

function issueItems(
  snapshot: PackSourceSnapshot,
  issues: PackIssue[],
  category: Extract<CustomerConfirmationPackItemCategory, "EXCEPTION" | "CONFIRMATION_REQUIRED">,
): CustomerConfirmationPackItemDraft[] {
  return issues.map((issue, index) => ({
    category,
    status: "OPEN",
    sourceObjectType: issue.sourceObjectType,
    sourceObjectId: issue.sourceObjectId ?? issue.id,
    title: issue.title,
    detail: issue.detail,
    riskLevel: issue.riskLevel,
    isCritical: true,
    isSystemRequired: true,
    coverageScope: normalizeCoverageScope({
      type: "FULL_RUN",
      runId: snapshot.run.id,
      dataVersionRef: snapshot.run.dataVersionRef,
      sourceObjectRefs: [`${issue.sourceObjectType}:${issue.sourceObjectId ?? issue.id}`],
    }),
    evidenceRefs: [],
    sortOrder: category === "EXCEPTION" ? 500 + index : 600 + index,
  }));
}

function invalidConfirmationItems(snapshot: PackSourceSnapshot): CustomerConfirmationPackItemDraft[] {
  return snapshot.invalidConfirmations.map((confirmation, index) => ({
    category: "CONFIRMATION_REQUIRED",
    status: "OPEN",
    sourceObjectType: "CUSTOMER_CONFIRMATION",
    sourceObjectId: confirmation.id,
    title: "旧客户确认已失效",
    detail: confirmation.invalidationReason,
    riskLevel: "R2",
    isCritical: true,
    isSystemRequired: true,
    coverageScope: normalizeCoverageScope(confirmation.coverageScope),
    evidenceRefs: [],
    sortOrder: 700 + index,
  }));
}

function buildSuggestedWechatMessage(
  snapshot: PackSourceSnapshot,
  items: CustomerConfirmationPackItemDraft[],
) {
  const grouped = groupCount(items);
  return [
    `${snapshot.run.clientName} ${snapshot.run.payrollMonth} 薪资核对材料如下。`,
    `本月变更 ${grouped.MONTHLY_CHANGE ?? 0} 项，缺失信息 ${grouped.MISSING_INFORMATION ?? 0} 项，异常/高风险 ${
      (grouped.EXCEPTION ?? 0) + (grouped.CONFIRMATION_REQUIRED ?? 0)
    } 项。`,
    "请按列出的员工、字段和附件范围确认；若只回复“确认无误”，我方仍需回填实际覆盖范围。",
  ].join("\n");
}

function fullRunCoverage(run: PackRunSnapshot): CoverageScope {
  return normalizeCoverageScope({
    type: "FULL_RUN",
    runId: run.id,
    dataVersionRef: run.dataVersionRef,
    resultVersionRef: run.resultVersionRef ?? undefined,
    exportPreviewVersionRef: run.exportPreviewVersionRef ?? undefined,
  });
}

function criticalItemCount(items: CustomerConfirmationPackItemDraft[]) {
  return items.filter((item) => item.isCritical || item.isSystemRequired).length;
}

function groupCount(items: CustomerConfirmationPackItemDraft[]) {
  return items.reduce<Partial<Record<CustomerConfirmationPackItemCategory, number>>>((acc, item) => {
    acc[item.category] = (acc[item.category] ?? 0) + 1;
    return acc;
  }, {});
}

function isHighRisk(riskLevel: string) {
  return riskLevel === "R2" || riskLevel === "R3" || riskLevel === "R4";
}

function isCriticalField(field: string) {
  return /amount|salary|bank|bpjs|tax|npwp|ptkp|employee|template|fx|rate/i.test(field);
}

function formatValue(value: unknown) {
  return JSON.stringify(value).slice(0, 180);
}
