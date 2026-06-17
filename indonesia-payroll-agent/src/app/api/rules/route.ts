import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import {
  actorHasPermission,
  assertClientActionAllowed,
  isSystemAdmin,
  type ActorContext,
} from "@/domain/auth/permissions";
import { handleApi } from "@/app/api/_utils/errors";
import {
  assertRegressionGate,
  hasBlockingConflict,
  scopeKeyForRule,
} from "@/domain/rules/rule-gates";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";
import { toInputJsonObject } from "@/lib/json/input-json";

export const dynamic = "force-dynamic";

const ruleSchema = z.object({
  ruleKey: z.string().min(1).max(80),
  ruleType: z.enum([
    "PPH21",
    "BPJS",
    "THR",
    "GROSS_UP",
    "FX",
    "ROUNDING",
    "CUSTOMER_POLICY",
    "COMPONENT_CLASSIFICATION",
  ]),
  scopeType: z.enum(["PUBLIC", "CUSTOMER", "COMPONENT"]),
  clientId: z.string().min(1).optional(),
  componentId: z.string().min(1).optional(),
  effectiveMonth: z.string().min(7).max(7),
  content: z.record(z.string(), z.unknown()).default({}),
  conflictCheckSummary: z.record(z.string(), z.unknown()).default({}),
  changeSummary: z.string().min(1).max(1000),
});

const approveSchema = z.object({
  action: z.literal("approve"),
  ruleVersionId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: z.string().min(1).max(1000),
});

const publishSchema = z.object({
  action: z.literal("publish"),
  ruleVersionId: z.string().min(1),
  confirmationText: z.literal("PUBLISH"),
});

const disableSchema = z.object({
  action: z.literal("disable"),
  ruleVersionId: z.string().min(1),
  reason: z.string().min(1).max(1000),
});

const patchSchema = z.discriminatedUnion("action", [
  approveSchema,
  publishSchema,
  disableSchema,
]);

function readableRuleWhere(actor: ActorContext, clientId?: string) {
  if (clientId) {
    assertClientActionAllowed(actor, "viewClient", clientId);
    return { OR: [{ scopeType: "PUBLIC" as const }, { clientId }] };
  }
  if (isSystemAdmin(actor)) {
    return undefined;
  }
  return {
    OR: [{ scopeType: "PUBLIC" as const }, { clientId: { in: actor.authorizedClientIds } }],
  };
}

function assertRuleDraftAllowed(actor: ActorContext, clientId?: string) {
  if (clientId) {
    assertClientActionAllowed(actor, "configureRules", clientId);
    return;
  }
  if (!actorHasPermission(actor, "rules.configure")) {
    throw new Error("ROLE_MISSING_PERMISSION");
  }
}

function assertRuleApproveAllowed(actor: ActorContext, clientId?: string | null) {
  if (clientId) {
    assertClientActionAllowed(actor, "approveRules", clientId);
    return;
  }
  if (!actorHasPermission(actor, "rules.approve")) {
    throw new Error("ROLE_MISSING_PERMISSION");
  }
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const clientId = request.nextUrl.searchParams.get("clientId")?.trim() || undefined;
    const rules = await prisma.ruleVersion.findMany({
      where: readableRuleWhere(actor, clientId),
      include: {
        client: { select: { code: true, name: true } },
        component: { select: { code: true, name: true } },
        approvals: { orderBy: { createdAt: "desc" }, take: 3 },
        regressionRuns: { orderBy: { createdAt: "desc" }, take: 4 },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    });

    return NextResponse.json({ rules });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = ruleSchema.parse(await request.json());
    assertRuleDraftAllowed(actor, body.clientId);
    if (hasBlockingConflict(body.conflictCheckSummary)) {
      throw new Error("CUSTOMER_RULE_CONFLICTS_PUBLIC_BASELINE");
    }

    const ruleKey = body.ruleKey.trim().toUpperCase();
    const scopeKey = scopeKeyForRule(body.scopeType, body.clientId, body.componentId);
    const latest = await prisma.ruleVersion.findFirst({
      where: { ruleKey, scopeKey },
      orderBy: { versionNumber: "desc" },
      select: { versionNumber: true },
    });
    const rule = await prisma.ruleVersion.create({
      data: {
        ruleKey,
        ruleType: body.ruleType,
        scopeType: body.scopeType,
        scopeKey,
        clientId: body.clientId,
        componentId: body.componentId,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        effectiveMonth: body.effectiveMonth,
        content: toInputJsonObject(body.content),
        conflictCheckSummary: toInputJsonObject(body.conflictCheckSummary),
        changeSummary: body.changeSummary.trim(),
        draftedById: auditFields.actorUserId,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: "RULE_VERSION_DRAFTED",
        objectType: "RULE_VERSION",
        objectId: rule.id,
        riskLevel: "R2",
        ...auditFields,
        clientId: rule.clientId,
        metadata: {
          ruleKey: rule.ruleKey,
          versionNumber: rule.versionNumber,
          inputSummary: "API 创建规则草稿，不允许正式 run 引用",
          outputSummary: "DRAFT 规则已保存，发布前必须审批和回归",
        },
      },
    });

    return NextResponse.json({ rule }, { status: 201 });
  });
}

export async function PATCH(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = patchSchema.parse(await request.json());
    const rule = await prisma.ruleVersion.findUnique({
      where: { id: body.ruleVersionId },
      include: { approvals: true, regressionRuns: true },
    });
    if (!rule) {
      throw new Error("RULE_VERSION_NOT_FOUND");
    }
    assertRuleApproveAllowed(actor, rule.clientId);

    if (body.action === "approve") {
      const [approval] = await prisma.$transaction([
        prisma.ruleApproval.create({
          data: {
            ruleVersionId: rule.id,
            decision: body.decision,
            note: body.note,
            approverId: auditFields.actorUserId,
          },
        }),
        ...(body.decision === "APPROVED" && rule.status === "DRAFT"
          ? [prisma.ruleVersion.update({ where: { id: rule.id }, data: { status: "APPROVED" } })]
          : []),
        prisma.auditLog.create({
          data: {
            action: "RULE_VERSION_APPROVED",
            objectType: "RULE_VERSION",
            objectId: rule.id,
            riskLevel: "R3",
            ...auditFields,
            clientId: rule.clientId,
            metadata: { decision: body.decision, note: body.note },
          },
        }),
      ]);
      return NextResponse.json({ approval });
    }

    if (body.action === "disable") {
      if (rule.status !== "PUBLISHED") {
        throw new Error("ONLY_PUBLISHED_RULE_CAN_BE_DISABLED");
      }
      const [updated] = await prisma.$transaction([
        prisma.ruleVersion.update({
          where: { id: rule.id },
          data: { status: "DISABLED", disabledById: auditFields.actorUserId, disabledAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            action: "RULE_VERSION_DISABLED",
            objectType: "RULE_VERSION",
            objectId: rule.id,
            riskLevel: "R3",
            ...auditFields,
            clientId: rule.clientId,
            metadata: { reason: body.reason },
          },
        }),
      ]);
      return NextResponse.json({ rule: updated });
    }

    if (!rule.approvals.some((approval) => approval.decision === "APPROVED")) {
      throw new Error("RULE_APPROVAL_REQUIRED_BEFORE_PUBLISH");
    }
    assertRegressionGate(rule.regressionRuns);
    const [updated] = await prisma.$transaction([
      prisma.ruleVersion.update({
        where: { id: rule.id },
        data: {
          status: "PUBLISHED",
          publishedById: auditFields.actorUserId,
          publishedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "RULE_VERSION_PUBLISHED",
          objectType: "RULE_VERSION",
          objectId: rule.id,
          riskLevel: "R3",
          ...auditFields,
          clientId: rule.clientId,
          metadata: {
            ruleKey: rule.ruleKey,
            versionNumber: rule.versionNumber,
            inputSummary: "API 发布规则版本，正式 payroll run 可引用",
          },
        },
      }),
    ]);
    return NextResponse.json({ rule: updated });
  });
}
