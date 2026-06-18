import {
  type ActorContext,
  actorHasPermission,
  assertClientActionAllowed,
  PermissionDeniedError,
} from "@/domain/auth/permissions";
import { type AuditService } from "@/domain/audit/audit-service";

export type PayrollComponentType =
  | "EARNING"
  | "DEDUCTION"
  | "TAX_ALLOWANCE"
  | "BENEFIT"
  | "EMPLOYER_COST"
  | "MEMO";

export type PayrollComponentStatus = "ACTIVE" | "DISABLED";
export type ComponentAliasStatus = "DRAFT" | "EFFECTIVE" | "SUPERSEDED" | "DISABLED";

export type PayrollComponentAttributes = {
  taxableCash: boolean;
  bpjsHealthBase: boolean;
  bpjsEmploymentBase: boolean;
  paidOut: boolean;
  affectsNetPay: boolean;
  affectsEmployerCost: boolean;
};

export type PayrollComponentRecord = PayrollComponentAttributes & {
  id: string;
  code: string;
  name: string;
  componentType: PayrollComponentType;
  status: PayrollComponentStatus;
  effectiveMonth?: string | null;
};

export type ClientComponentAliasRecord = {
  id: string;
  clientId: string;
  componentId: string;
  sourceLabel: string;
  normalizedLabel: string;
  versionNumber: number;
  effectiveMonth: string;
  status: ComponentAliasStatus;
  evidenceRefs: string[];
  changeReason: string;
};

export type ComponentStore = {
  findPayrollComponentById(id: string): Promise<PayrollComponentRecord | null>;
  findPayrollComponentByCode(code: string): Promise<PayrollComponentRecord | null>;
  createPayrollComponent(
    input: Omit<PayrollComponentRecord, "id" | "status"> & { createdById: string },
  ): Promise<PayrollComponentRecord>;
  findLatestAliasVersion(input: {
    clientId: string;
    normalizedLabel: string;
  }): Promise<ClientComponentAliasRecord | null>;
  createAliasVersion(
    input: Omit<ClientComponentAliasRecord, "id" | "status"> & { createdById: string },
  ): Promise<ClientComponentAliasRecord>;
};

export class ComponentService {
  constructor(
    private readonly store: ComponentStore,
    private readonly auditService: AuditService,
  ) {}

  async createPayrollComponent(input: {
    actor: ActorContext;
    code: string;
    name: string;
    componentType: PayrollComponentType;
    attributes: PayrollComponentAttributes;
    effectiveMonth?: string;
  }): Promise<PayrollComponentRecord> {
    if (!actorHasPermission(input.actor, "rules.configure")) {
      throw new PermissionDeniedError("ROLE_MISSING_PERMISSION");
    }

    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (!code || !name) {
      throw new ComponentServiceError("PAYROLL_COMPONENT_CODE_AND_NAME_REQUIRED");
    }

    const existing = await this.store.findPayrollComponentByCode(code);
    if (existing) {
      throw new ComponentServiceError("PAYROLL_COMPONENT_CODE_ALREADY_EXISTS");
    }

    const component = await this.store.createPayrollComponent({
      code,
      name,
      componentType: input.componentType,
      ...input.attributes,
      effectiveMonth: input.effectiveMonth,
      createdById: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "PAYROLL_COMPONENT_CREATED",
      objectType: "PAYROLL_COMPONENT",
      objectId: component.id,
      riskLevel: "R2",
      metadata: {
        code: component.code,
        componentType: component.componentType,
        inputSummary: "新增系统级薪资组件字典项",
        outputSummary: "组件属性由系统字典固定，客户别名不得覆盖",
      },
    });

    return component;
  }

  async createClientAliasVersion(input: {
    actor: ActorContext;
    clientId: string;
    componentId: string;
    sourceLabel: string;
    effectiveMonth: string;
    evidenceRefs: string[];
    changeReason: string;
    attemptedAttributeOverrides?: Partial<PayrollComponentAttributes>;
  }): Promise<ClientComponentAliasRecord> {
    assertClientActionAllowed(input.actor, "configureRules", input.clientId);
    assertNoComponentAttributeOverrides(input.attemptedAttributeOverrides);

    const sourceLabel = input.sourceLabel.trim();
    const changeReason = input.changeReason.trim();
    if (!sourceLabel || !changeReason) {
      throw new ComponentServiceError("CLIENT_COMPONENT_ALIAS_LABEL_AND_REASON_REQUIRED");
    }

    const component = await this.store.findPayrollComponentById(input.componentId);
    if (!component || component.status !== "ACTIVE") {
      throw new ComponentServiceError("ACTIVE_PAYROLL_COMPONENT_REQUIRED");
    }

    const normalizedLabel = normalizeComponentAlias(sourceLabel);
    const latest = await this.store.findLatestAliasVersion({
      clientId: input.clientId,
      normalizedLabel,
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const alias = await this.store.createAliasVersion({
      clientId: input.clientId,
      componentId: component.id,
      sourceLabel,
      normalizedLabel,
      versionNumber,
      effectiveMonth: input.effectiveMonth,
      evidenceRefs: input.evidenceRefs,
      changeReason,
      createdById: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CLIENT_COMPONENT_ALIAS_VERSION_CREATED",
      objectType: "CLIENT_COMPONENT_ALIAS",
      objectId: alias.id,
      riskLevel: "R2",
      clientId: alias.clientId,
      metadata: {
        sourceLabel: alias.sourceLabel,
        componentCode: component.code,
        versionNumber: alias.versionNumber,
        inputSummary: "创建客户组件别名草稿版本",
        outputSummary: "别名只预填标准组件映射，不改变入税、BPJS、发放或成本属性",
        evidenceRefs: alias.evidenceRefs,
      },
    });

    return alias;
  }
}

export function normalizeComponentAlias(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function assertNoComponentAttributeOverrides(
  attemptedOverrides?: Partial<PayrollComponentAttributes>,
): void {
  if (attemptedOverrides && Object.keys(attemptedOverrides).length > 0) {
    throw new ComponentServiceError("CLIENT_ALIAS_CANNOT_OVERRIDE_COMPONENT_ATTRIBUTES");
  }
}

export class ComponentServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ComponentServiceError";
  }
}
