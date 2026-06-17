export const ROLE_CODES = [
  "DELIVERY_SPECIALIST",
  "PAYROLL_SPECIALIST",
  "PAYROLL_LEAD",
  "RULE_ADMIN",
  "SYSTEM_ADMIN",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const PERMISSION_CODES = [
  "client.view",
  "client.edit",
  "employee.view",
  "employee.edit",
  "sensitive.view",
  "export.download",
  "calculation.execute",
  "payroll.lock",
  "highRisk.release",
  "rules.configure",
  "rules.approve",
  "audit.view",
  "users.manage",
] as const;

export type PermissionCode = (typeof PERMISSION_CODES)[number];

export type ActorContext = {
  id: string;
  email: string;
  roleCodes: RoleCode[];
  authorizedClientIds: string[];
};

export type ClientScopedAction =
  | "viewClient"
  | "editClient"
  | "viewEmployee"
  | "editEmployee"
  | "viewSensitive"
  | "downloadExport"
  | "executeCalculation"
  | "lockPayroll"
  | "releaseHighRisk"
  | "configureRules"
  | "approveRules"
  | "viewAudit";

const ROLE_PERMISSION_MATRIX: Record<RoleCode, PermissionCode[]> = {
  DELIVERY_SPECIALIST: [
    "client.view",
    "employee.view",
    "employee.edit",
    "sensitive.view",
    "export.download",
    "audit.view",
  ],
  PAYROLL_SPECIALIST: [
    "client.view",
    "employee.view",
    "sensitive.view",
    "export.download",
    "calculation.execute",
    "payroll.lock",
    "audit.view",
  ],
  PAYROLL_LEAD: [
    "client.view",
    "employee.view",
    "sensitive.view",
    "export.download",
    "calculation.execute",
    "payroll.lock",
    "highRisk.release",
    "rules.approve",
    "audit.view",
  ],
  RULE_ADMIN: ["client.view", "rules.configure", "audit.view"],
  SYSTEM_ADMIN: [
    "client.view",
    "client.edit",
    "employee.view",
    "sensitive.view",
    "export.download",
    "audit.view",
    "users.manage",
  ],
};

const ACTION_PERMISSION_MAP: Record<ClientScopedAction, PermissionCode> = {
  viewClient: "client.view",
  editClient: "client.edit",
  viewEmployee: "employee.view",
  editEmployee: "employee.edit",
  viewSensitive: "sensitive.view",
  downloadExport: "export.download",
  executeCalculation: "calculation.execute",
  lockPayroll: "payroll.lock",
  releaseHighRisk: "highRisk.release",
  configureRules: "rules.configure",
  approveRules: "rules.approve",
  viewAudit: "audit.view",
};

const BUSINESS_APPROVAL_ACTIONS = new Set<ClientScopedAction>([
  "lockPayroll",
  "releaseHighRisk",
  "approveRules",
]);

export function isRoleCode(value: string): value is RoleCode {
  return ROLE_CODES.includes(value as RoleCode);
}

export function isSystemAdmin(actor: Pick<ActorContext, "roleCodes">): boolean {
  return actor.roleCodes.includes("SYSTEM_ADMIN");
}

export function actorHasPermission(
  actor: Pick<ActorContext, "roleCodes">,
  permission: PermissionCode,
): boolean {
  return actor.roleCodes.some((roleCode) =>
    ROLE_PERMISSION_MATRIX[roleCode].includes(permission),
  );
}

export function actorCanAccessClient(actor: ActorContext, clientId: string): boolean {
  return isSystemAdmin(actor) || actor.authorizedClientIds.includes(clientId);
}

export function canPerformClientAction(
  actor: ActorContext,
  action: ClientScopedAction,
  clientId: string,
): boolean {
  if (!actorCanAccessClient(actor, clientId)) {
    return false;
  }

  if (isSystemAdmin(actor) && BUSINESS_APPROVAL_ACTIONS.has(action)) {
    return false;
  }

  return actorHasPermission(actor, ACTION_PERMISSION_MAP[action]);
}

export function assertClientActionAllowed(
  actor: ActorContext,
  action: ClientScopedAction,
  clientId: string,
): void {
  if (!actorCanAccessClient(actor, clientId)) {
    throw new PermissionDeniedError("ACTOR_NOT_AUTHORIZED_FOR_CLIENT");
  }

  if (isSystemAdmin(actor) && BUSINESS_APPROVAL_ACTIONS.has(action)) {
    throw new PermissionDeniedError("SYSTEM_ADMIN_CANNOT_APPROVE_BUSINESS_ACTION");
  }

  if (!actorHasPermission(actor, ACTION_PERMISSION_MAP[action])) {
    throw new PermissionDeniedError("ROLE_MISSING_PERMISSION");
  }
}

export class PermissionDeniedError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PermissionDeniedError";
  }
}

export function visibleClientIdsForActor(
  actor: ActorContext,
  allClientIds: string[],
): string[] {
  if (isSystemAdmin(actor)) {
    return allClientIds;
  }

  const authorized = new Set(actor.authorizedClientIds);
  return allClientIds.filter((clientId) => authorized.has(clientId));
}
