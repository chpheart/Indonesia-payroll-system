import {
  type ActorContext,
  actorHasPermission,
  assertClientActionAllowed,
  PermissionDeniedError,
} from "@/domain/auth/permissions";
import { type AuditService } from "@/domain/audit/audit-service";

export type ClientStatus = "ACTIVE" | "DISABLED";
export type ConfigVersionStatus = "DRAFT" | "EFFECTIVE" | "SUPERSEDED";

export type ClientRecord = {
  id: string;
  code: string;
  name: string;
  status: ClientStatus;
  hasHistoricalPayroll: boolean;
};

export type ClientConfigVersionDraft = {
  clientId: string;
  versionNumber: number;
  effectiveMonth: string;
  payrollDay?: number;
  templateCode?: string;
  grossUpDefault: boolean;
  bpjsConfig: Record<string, unknown>;
  ruleConfig: Record<string, unknown>;
  evidenceRefs: string[];
  changeReason: string;
  status: ConfigVersionStatus;
};

export type ClientStore = {
  findClientById(id: string): Promise<ClientRecord | null>;
  createClient(input: {
    code: string;
    name: string;
    legalEntityName?: string;
    actorId: string;
  }): Promise<ClientRecord>;
  disableClient(id: string): Promise<ClientRecord>;
  createConfigVersion(input: ClientConfigVersionDraft): Promise<ClientConfigVersionDraft>;
};

export class ClientService {
  constructor(
    private readonly store: ClientStore,
    private readonly auditService: AuditService,
  ) {}

  async createClient(input: {
    actor: ActorContext;
    code: string;
    name: string;
    legalEntityName?: string;
  }): Promise<ClientRecord> {
    if (!actorHasPermission(input.actor, "client.edit")) {
      throw new PermissionDeniedError("ROLE_MISSING_PERMISSION");
    }

    if (!input.code.trim() || !input.name.trim()) {
      throw new ClientServiceError("CLIENT_CODE_AND_NAME_REQUIRED");
    }

    const client = await this.store.createClient({
      code: input.code.trim(),
      name: input.name.trim(),
      legalEntityName: input.legalEntityName?.trim() || undefined,
      actorId: input.actor.id,
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CLIENT_CREATED",
      objectType: "CLIENT",
      objectId: client.id,
      riskLevel: "R1",
      clientId: client.id,
      metadata: { code: client.code },
    });

    return client;
  }

  async disableClient(input: { actor: ActorContext; clientId: string }): Promise<ClientRecord> {
    assertClientActionAllowed(input.actor, "editClient", input.clientId);

    const client = await this.requireClient(input.clientId);
    if (client.status === "DISABLED") {
      return client;
    }

    const disabled = await this.store.disableClient(input.clientId);
    await this.auditService.record({
      actor: input.actor,
      action: "CLIENT_DISABLED",
      objectType: "CLIENT",
      objectId: input.clientId,
      riskLevel: "R1",
      clientId: input.clientId,
    });

    return disabled;
  }

  async assertClientCanBePhysicallyDeleted(input: {
    actor: ActorContext;
    clientId: string;
  }): Promise<void> {
    assertClientActionAllowed(input.actor, "editClient", input.clientId);

    const client = await this.requireClient(input.clientId);
    if (client.hasHistoricalPayroll) {
      await this.auditService.record({
        actor: input.actor,
        action: "CLIENT_DELETE_REJECTED",
        objectType: "CLIENT",
        objectId: input.clientId,
        riskLevel: "R1",
        clientId: input.clientId,
        metadata: { reason: "HAS_HISTORICAL_PAYROLL" },
      });
      throw new ClientServiceError("CLIENT_WITH_HISTORY_CANNOT_BE_DELETED");
    }
  }

  async createConfigVersion(input: {
    actor: ActorContext;
    draft: ClientConfigVersionDraft;
  }): Promise<ClientConfigVersionDraft> {
    assertClientActionAllowed(input.actor, "editClient", input.draft.clientId);

    if (!input.draft.changeReason.trim()) {
      throw new ClientServiceError("CLIENT_CONFIG_CHANGE_REASON_REQUIRED");
    }

    const created = await this.store.createConfigVersion({
      ...input.draft,
      changeReason: input.draft.changeReason.trim(),
    });

    await this.auditService.record({
      actor: input.actor,
      action: "CLIENT_CONFIG_VERSION_CREATED",
      objectType: "CLIENT_CONFIG_VERSION",
      objectId: `${created.clientId}:${created.versionNumber}`,
      riskLevel: "R2",
      clientId: created.clientId,
      metadata: {
        effectiveMonth: created.effectiveMonth,
        versionNumber: created.versionNumber,
      },
    });

    return created;
  }

  private async requireClient(clientId: string): Promise<ClientRecord> {
    const client = await this.store.findClientById(clientId);
    if (!client) {
      throw new ClientServiceError("CLIENT_NOT_FOUND");
    }

    return client;
  }
}

export class ClientServiceError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ClientServiceError";
  }
}
