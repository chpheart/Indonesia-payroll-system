import { type ActorContext, isRoleCode, type RoleCode } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

type HeaderReader = {
  get(name: string): string | null;
};

const DEFAULT_ACTOR: ActorContext = {
  id: "anonymous",
  email: "anonymous@example.local",
  roleCodes: [],
  authorizedClientIds: [],
};

type DatabaseActorLookup =
  | { status: "found"; actor: ActorContext }
  | { status: "disabled" }
  | { status: "missing" }
  | { status: "unavailable" };

export function actorFromHeaders(headers: HeaderReader): ActorContext {
  const requestedActorId = developmentActorIdFromHeaders(headers);
  return actorFromTrustedRegistry(requestedActorId);
}

export async function actorFromHeadersWithDatabase(headers: HeaderReader): Promise<ActorContext> {
  const requestedActorId = developmentActorIdFromHeaders(headers);

  if (requestedActorId) {
    const databaseLookup = await actorFromDatabaseUser(requestedActorId);

    if (databaseLookup.status === "found") {
      return databaseLookup.actor;
    }

    if (databaseLookup.status === "disabled") {
      return DEFAULT_ACTOR;
    }
  }

  return actorFromTrustedRegistry(requestedActorId);
}

export function actorFromSearchParams(searchParams: URLSearchParams): ActorContext {
  const requestedActorId = isDevelopmentActorMode() ? searchParams.get("userId")?.trim() : null;
  return actorFromTrustedRegistry(requestedActorId);
}

export function actorFromTrustedRegistry(actorId?: string | null): ActorContext {
  if (!isDevelopmentActorMode()) {
    return DEFAULT_ACTOR;
  }

  const registry = loadTrustedActorRegistry();
  const selectedActor = actorId ? registry[actorId] : undefined;
  const fallbackActor = registry[process.env.DEV_DEFAULT_ACTOR_ID ?? ""];

  return selectedActor ?? fallbackActor ?? DEFAULT_ACTOR;
}

function developmentActorIdFromHeaders(headers: HeaderReader): string | null {
  if (!isDevelopmentActorMode()) {
    return null;
  }

  return headers.get("x-user-id")?.trim() || process.env.DEV_DEFAULT_ACTOR_ID || null;
}

function isDevelopmentActorMode(): boolean {
  return process.env.NODE_ENV !== "production";
}

async function actorFromDatabaseUser(userId: string): Promise<DatabaseActorLookup> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: true } },
        clientAccesses: {
          where: { status: "ACTIVE" },
          select: { clientId: true },
        },
      },
    });

    if (!user) {
      return { status: "missing" };
    }

    if (user.status !== "ACTIVE") {
      return { status: "disabled" };
    }

    return {
      status: "found",
      actor: {
        id: user.id,
        email: user.email,
        roleCodes: user.userRoles.map((userRole) => userRole.role.code),
        authorizedClientIds: user.clientAccesses.map((access) => access.clientId),
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

function loadTrustedActorRegistry(): Record<string, ActorContext> {
  const raw = process.env.DEV_ACTOR_REGISTRY_JSON;
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([id, value]) => parseActorRegistryEntry(id, value))
        .filter((entry): entry is [string, ActorContext] => Boolean(entry)),
    );
  } catch {
    return {};
  }
}

function parseActorRegistryEntry(
  id: string,
  value: unknown,
): [string, ActorContext] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const email = typeof candidate.email === "string" ? candidate.email : null;
  const roleCodes = Array.isArray(candidate.roleCodes)
    ? candidate.roleCodes.filter((roleCode): roleCode is RoleCode =>
        typeof roleCode === "string" && isRoleCode(roleCode),
      )
    : [];
  const authorizedClientIds = Array.isArray(candidate.authorizedClientIds)
    ? candidate.authorizedClientIds.filter((clientId): clientId is string =>
        typeof clientId === "string",
      )
    : [];

  if (!email) {
    return null;
  }

  return [id, { id, email, roleCodes, authorizedClientIds }];
}

export function roleLabel(roleCode: RoleCode): string {
  const labels: Record<RoleCode, string> = {
    DELIVERY_SPECIALIST: "客服/交付专员",
    PAYROLL_SPECIALIST: "算薪人",
    PAYROLL_LEAD: "算薪负责人/交付主管",
    RULE_ADMIN: "规则管理员",
    SYSTEM_ADMIN: "系统管理员",
  };

  return labels[roleCode];
}
