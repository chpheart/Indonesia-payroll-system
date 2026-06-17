import { isSystemAdmin, type ActorContext } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

export async function loadRulesData(actor: ActorContext) {
  try {
    const clientWhere = isSystemAdmin(actor) ? undefined : { id: { in: actor.authorizedClientIds } };
    const scopedClientIds = isSystemAdmin(actor) ? undefined : actor.authorizedClientIds;
    const [clients, components, aliases, rules, fxRates] = await Promise.all([
      prisma.client.findMany({
        where: clientWhere,
        orderBy: { code: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.payrollComponent.findMany({ orderBy: { code: "asc" } }),
      prisma.clientComponentAlias.findMany({
        where: scopedClientIds ? { clientId: { in: scopedClientIds } } : undefined,
        include: {
          client: { select: { code: true, name: true } },
          component: { select: { code: true, name: true } },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 80,
      }),
      prisma.ruleVersion.findMany({
        where: scopedClientIds
          ? { OR: [{ scopeType: "PUBLIC" }, { clientId: { in: scopedClientIds } }] }
          : undefined,
        include: {
          client: { select: { code: true, name: true } },
          component: { select: { code: true, name: true } },
          approvals: { orderBy: { createdAt: "desc" }, take: 2 },
          regressionRuns: { orderBy: { createdAt: "desc" }, take: 4 },
        },
        orderBy: [{ createdAt: "desc" }],
        take: 80,
      }),
      prisma.fXRateVersion.findMany({
        where: scopedClientIds ? { clientId: { in: scopedClientIds } } : undefined,
        include: { client: { select: { code: true, name: true } } },
        orderBy: [{ payrollMonth: "desc" }, { createdAt: "desc" }],
        take: 80,
      }),
    ]);

    return { clients, components, aliases, rules, fxRates, error: null };
  } catch (error) {
    return {
      clients: [],
      components: [],
      aliases: [],
      rules: [],
      fxRates: [],
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}

export type ClientOption = {
  id: string;
  code: string;
  name: string;
};

export function statusClass(status: string) {
  if (["PUBLISHED", "CONFIRMED", "ACTIVE", "EFFECTIVE", "PASSED"].includes(status)) {
    return "active";
  }
  if (["FAILED", "BLOCKED", "DISABLED"].includes(status)) {
    return "terminated";
  }
  return "draft";
}

export function formatJsonKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "-";
  }
  const keys = Object.keys(value);
  return keys.length > 0 ? keys.slice(0, 5).join(" · ") : "{}";
}
