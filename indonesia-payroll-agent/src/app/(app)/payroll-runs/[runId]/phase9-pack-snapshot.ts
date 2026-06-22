import {
  type PackSourceSnapshot,
} from "@/domain/confirmation-packs/customer-confirmation-pack-service";
import { parseCoverageScopeJson } from "@/domain/confirmation-packs/pack-coverage-service";
import { prisma } from "@/lib/db/prisma";

export async function loadRunForConfirmationPack(runId: string) {
  const run = await prisma.payrollRun.findUnique({
    where: { id: runId },
    include: {
      client: { select: { id: true, code: true, name: true, hasHistoricalPayroll: true } },
      changeLedgerEntries: {
        include: { targetEmployee: { select: { id: true, employeeCode: true, fullName: true } } },
        orderBy: { reviewedAt: "asc" },
      },
      questionItems: { orderBy: { createdAt: "asc" } },
      standardizedInputs: {
        where: { status: { not: "INVALIDATED" } },
        include: { employee: { select: { id: true, employeeCode: true, fullName: true } } },
        orderBy: [{ employeeId: "asc" }, { standardField: "asc" }, { createdAt: "asc" }],
      },
      caseItems: { where: { status: "OPEN" }, orderBy: { createdAt: "asc" } },
      customerConfirmations: { where: { status: "STALE" }, orderBy: { invalidatedAt: "desc" } },
    },
  });
  if (!run) {
    return null;
  }

  const previousRun = await prisma.payrollRun.findFirst({
    where: {
      clientId: run.clientId,
      payrollMonth: { lt: run.payrollMonth },
    },
    orderBy: { payrollMonth: "desc" },
    select: {
      id: true,
      payrollMonth: true,
      status: true,
      updatedAt: true,
      exportedAt: true,
      standardizedInputs: {
        where: { status: { not: "INVALIDATED" } },
        include: { employee: { select: { id: true, employeeCode: true, fullName: true } } },
        orderBy: [{ employeeId: "asc" }, { standardField: "asc" }, { createdAt: "asc" }],
      },
    },
  });

  return { ...run, previousRun };
}

export function packSnapshotFromRun(
  run: NonNullable<Awaited<ReturnType<typeof loadRunForConfirmationPack>>>,
): PackSourceSnapshot {
  const dataVersionRef = `run:${run.id}:updated:${run.updatedAt.toISOString()}`;
  const previousRunRef = run.previousRun
    ? `run:${run.previousRun.id}:updated:${run.previousRun.updatedAt.toISOString()}`
    : null;
  const exportPreviewVersionRef = run.exportedAt
    ? `export-preview:${run.id}:exported:${run.exportedAt.toISOString()}`
    : null;
  const blockingIssues = run.caseItems
    .filter((item) => ["R2", "R3", "R4"].includes(item.riskLevel))
    .map((item) => ({
      id: item.id,
      title: item.title,
      detail: item.detail,
      riskLevel: item.riskLevel,
      sourceObjectType: "CASE_ITEM",
      sourceObjectId: item.id,
    }));
  const syntheticBlockingIssues =
    run.blockingIssueCount > blockingIssues.length
      ? [
          {
            id: `${run.id}:blocking-summary`,
            title: "Run 仍有阻断项",
            detail: `当前阻断计数 ${run.blockingIssueCount}，确认包必须保留为异常项。`,
            riskLevel: "R3" as const,
            sourceObjectType: "PAYROLL_RUN",
            sourceObjectId: run.id,
          },
        ]
      : [];
  const syntheticHighRiskIssues =
    run.highRiskIssueCount > 0
      ? [
          {
            id: `${run.id}:high-risk-summary`,
            title: "Run 仍有高风险项",
            detail: `当前高风险计数 ${run.highRiskIssueCount}，客户确认包不得遗漏。`,
            riskLevel: "R3" as const,
            sourceObjectType: "PAYROLL_RUN",
            sourceObjectId: run.id,
          },
        ]
      : [];
  const missingSourceIssues = [
    ...(!exportPreviewVersionRef
      ? [
          {
            id: `${run.id}:export-preview-missing`,
            title: "导出预览版本缺失",
            detail: "当前 run 尚无导出预览版本；确认包只能作为草稿/核对材料，不能作为正式交付闭环。",
            riskLevel: "R2" as const,
            sourceObjectType: "PAYROLL_RUN",
            sourceObjectId: run.id,
          },
        ]
      : []),
    ...(run.client.hasHistoricalPayroll && !run.previousRun
      ? [
          {
            id: `${run.id}:previous-run-missing`,
            title: "上月 run 差异来源缺失",
            detail: "客户标记为有历史薪资，但未找到上月 run；需人工确认上月差异来源。",
            riskLevel: "R2" as const,
            sourceObjectType: "PAYROLL_RUN",
            sourceObjectId: run.id,
          },
        ]
      : []),
  ];

  return {
    run: {
      id: run.id,
      clientId: run.clientId,
      clientCode: run.client.code,
      clientName: run.client.name,
      payrollMonth: run.payrollMonth,
      status: run.status,
      dataVersionRef,
      resultVersionRef: null,
      exportPreviewVersionRef,
      previousRunRef,
    },
    ledgerEntries: run.changeLedgerEntries.map((entry) => ({
      id: entry.id,
      entryType: entry.entryType,
      targetEmployeeId: entry.targetEmployeeId,
      employeeLabel: entry.targetEmployee
        ? `${entry.targetEmployee.employeeCode} · ${entry.targetEmployee.fullName}`
        : null,
      targetField: entry.targetField,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      riskLevel: entry.riskLevel,
      evidenceRefs: entry.evidenceRefs,
    })),
    questions: run.questionItems.map((question) => ({
      id: question.id,
      title: question.title,
      detail: question.detail,
      reason: question.reason,
      status: question.status,
      riskLevel: question.riskLevel,
      targetObjectType: question.targetObjectType,
      targetObjectId: question.targetObjectId,
      targetField: question.targetField,
      blockingIssueRef: question.blockingIssueRef,
      evidenceRefs: question.evidenceRefs,
    })),
    standardizedInputs: run.standardizedInputs.map((input) => ({
      id: input.id,
      employeeId: input.employeeId,
      employeeLabel: input.employee ? `${input.employee.employeeCode} · ${input.employee.fullName}` : null,
      standardField: input.standardField,
      value: input.value,
      amount: input.amount?.toString() ?? null,
      currencyCode: input.currencyCode,
      status: input.status,
      evidenceStatus: input.evidenceStatus,
      evidenceRefs: input.evidenceRefs,
      sourceLabel: input.sourceSheetName
        ? `${input.sourceSheetName}${input.sourceRowIndex ? ` #${input.sourceRowIndex}` : ""}`
        : null,
    })),
    previousStandardizedInputs: (run.previousRun?.standardizedInputs ?? []).map((input) => ({
      id: input.id,
      employeeId: input.employeeId,
      employeeLabel: input.employee ? `${input.employee.employeeCode} · ${input.employee.fullName}` : null,
      standardField: input.standardField,
      value: input.value,
      amount: input.amount?.toString() ?? null,
      currencyCode: input.currencyCode,
      status: input.status,
      evidenceStatus: input.evidenceStatus,
      evidenceRefs: input.evidenceRefs,
      sourceLabel: previousRunRef,
      previousRunRef,
    })),
    blockingIssues: [...blockingIssues, ...syntheticBlockingIssues],
    highRiskIssues: [...syntheticHighRiskIssues, ...missingSourceIssues],
    invalidConfirmations: run.customerConfirmations.map((confirmation) => ({
      id: confirmation.id,
      invalidationReason: confirmation.invalidationReason ?? "客户确认已失效，需要重新确认覆盖范围",
      coverageScope: parseCoverageScopeJson(confirmation.coverageScope),
    })),
  };
}
