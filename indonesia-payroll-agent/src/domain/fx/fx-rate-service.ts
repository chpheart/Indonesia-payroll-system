import { type ActorContext, assertClientActionAllowed } from "@/domain/auth/permissions";
import { type AuditService } from "@/domain/audit/audit-service";
import { assertPayrollMonth } from "@/domain/payroll-runs/run-service";

export type FXRateVersionStatus = "DRAFT" | "CONFIRMED" | "SUPERSEDED";

export type EmployeeFXRateOverride = {
  employeeId: string;
  rate: number;
  evidenceRefs: string[];
  reason: string;
};

export type FXRateVersionRecord = {
  id: string;
  clientId: string;
  payrollMonth: string;
  currencyCode: string;
  versionNumber: number;
  rate: number;
  employeeOverrides: EmployeeFXRateOverride[];
  evidenceRefs: string[];
  sourceLabel: string;
  changeReason: string;
  status: FXRateVersionStatus;
};

export type FXRateStore = {
  findFXRateById(id: string): Promise<FXRateVersionRecord | null>;
  findLatestFXRateVersion(input: {
    clientId: string;
    payrollMonth: string;
    currencyCode: string;
  }): Promise<FXRateVersionRecord | null>;
  findConfirmedFXRate(input: {
    clientId: string;
    payrollMonth: string;
    currencyCode: string;
  }): Promise<FXRateVersionRecord | null>;
  createFXRateDraft(
    input: Omit<FXRateVersionRecord, "id" | "status"> & { createdById: string },
  ): Promise<FXRateVersionRecord>;
  confirmFXRateVersion(input: {
    id: string;
    confirmedById: string;
  }): Promise<FXRateVersionRecord>;
};

export class FXRateService {
  constructor(
    private readonly store: FXRateStore,
    private readonly auditService: AuditService,
  ) {}

  async createDraft(input: {
    actor: ActorContext;
    clientId: string;
    payrollMonth: string;
    currencyCode: string;
    rate: number;
    employeeOverrides?: EmployeeFXRateOverride[];
    evidenceRefs: string[];
    sourceLabel: string;
    changeReason: string;
  }): Promise<FXRateVersionRecord> {
    assertClientActionAllowed(input.actor, "configureRules", input.clientId);
    const normalized = normalizeCurrencyCode(input.currencyCode);
    assertPayrollMonth(input.payrollMonth);
    assertPositiveRate(input.rate);
    assertEvidence(input.evidenceRefs, "FX_RATE_EVIDENCE_REQUIRED");
    for (const override of input.employeeOverrides ?? []) {
      assertEmployeeOverride(override);
    }

    const latest = await this.store.findLatestFXRateVersion({
      clientId: input.clientId,
      payrollMonth: input.payrollMonth,
      currencyCode: normalized,
    });
    const fxRate = await this.store.createFXRateDraft({
      clientId: input.clientId,
      payrollMonth: input.payrollMonth,
      currencyCode: normalized,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      rate: input.rate,
      employeeOverrides: input.employeeOverrides ?? [],
      evidenceRefs: input.evidenceRefs,
      sourceLabel: input.sourceLabel.trim(),
      changeReason: input.changeReason.trim(),
      createdById: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "FX_RATE_VERSION_CREATED",
      objectType: "FX_RATE_VERSION",
      objectId: fxRate.id,
      riskLevel: "R2",
      clientId: fxRate.clientId,
      metadata: {
        payrollMonth: fxRate.payrollMonth,
        currencyCode: fxRate.currencyCode,
        versionNumber: fxRate.versionNumber,
        employeeOverrideCount: fxRate.employeeOverrides.length,
        inputSummary: "创建汇率草稿版本，不进入正式算薪",
        outputSummary: "待确认汇率版本已保存，未确认前预检查阻断",
      },
    });

    return fxRate;
  }

  async confirmRate(input: {
    actor: ActorContext;
    fxRateVersionId: string;
  }): Promise<FXRateVersionRecord> {
    const fxRate = await this.requireFXRate(input.fxRateVersionId);
    assertClientActionAllowed(input.actor, "approveRules", fxRate.clientId);
    if (fxRate.status === "CONFIRMED") {
      return fxRate;
    }
    assertEvidence(fxRate.evidenceRefs, "FX_RATE_EVIDENCE_REQUIRED");

    const confirmed = await this.store.confirmFXRateVersion({
      id: fxRate.id,
      confirmedById: input.actor.id,
    });
    await this.auditService.record({
      actor: input.actor,
      action: "FX_RATE_VERSION_CONFIRMED",
      objectType: "FX_RATE_VERSION",
      objectId: fxRate.id,
      riskLevel: "R2",
      clientId: fxRate.clientId,
      metadata: {
        payrollMonth: fxRate.payrollMonth,
        currencyCode: fxRate.currencyCode,
        versionNumber: fxRate.versionNumber,
        outputSummary: "汇率已确认，可被预检查和算薪快照引用",
      },
    });

    return confirmed;
  }

  async assertConfirmedRateForPayroll(input: {
    clientId: string;
    payrollMonth: string;
    currencyCode: string;
  }): Promise<FXRateVersionRecord> {
    const fxRate = await this.store.findConfirmedFXRate({
      clientId: input.clientId,
      payrollMonth: input.payrollMonth,
      currencyCode: normalizeCurrencyCode(input.currencyCode),
    });
    if (!fxRate) {
      throw new FXRateServiceError("FX_RATE_MISSING_OR_UNCONFIRMED");
    }

    return fxRate;
  }

  private async requireFXRate(id: string): Promise<FXRateVersionRecord> {
    const fxRate = await this.store.findFXRateById(id);
    if (!fxRate) {
      throw new FXRateServiceError("FX_RATE_VERSION_NOT_FOUND");
    }

    return fxRate;
  }
}

export function normalizeCurrencyCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new FXRateServiceError("FX_RATE_CURRENCY_CODE_INVALID");
  }
  return normalized;
}

function assertPositiveRate(rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new FXRateServiceError("FX_RATE_POSITIVE_RATE_REQUIRED");
  }
}

function assertEvidence(evidenceRefs: string[], errorCode: string): void {
  if (evidenceRefs.length === 0) {
    throw new FXRateServiceError(errorCode);
  }
}

function assertEmployeeOverride(override: EmployeeFXRateOverride): void {
  if (!override.employeeId.trim()) {
    throw new FXRateServiceError("FX_RATE_EMPLOYEE_OVERRIDE_EMPLOYEE_REQUIRED");
  }
  assertPositiveRate(override.rate);
  assertEvidence(override.evidenceRefs, "FX_RATE_EMPLOYEE_OVERRIDE_EVIDENCE_REQUIRED");
}

export class FXRateServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "FXRateServiceError";
  }
}
