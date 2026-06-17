import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  actorFromHeadersWithDatabase,
} from "@/domain/auth/request-context";
import {
  assertClientActionAllowed,
  isSystemAdmin,
  type ActorContext,
} from "@/domain/auth/permissions";
import {
  RAW_INPUT_SOURCE_CHANNELS,
  RAW_INPUT_STATUSES,
  RAW_INPUT_TYPES,
} from "@/domain/intake/intake-service";
import {
  detectInstructionLikeContent,
  evidenceCandidateRefForRawInput,
  hashRawInputContent,
  summarizeRawInput,
} from "@/domain/intake/raw-input-redaction";
import { handleApi } from "@/app/api/_utils/errors";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const createRawInputSchema = z.object({
  sourceChannel: z.enum(RAW_INPUT_SOURCE_CHANNELS),
  inputType: z.enum(RAW_INPUT_TYPES),
  originalText: z.string().min(1).max(100_000),
  clientId: z.string().min(1).optional(),
  payrollMonth: z.string().min(7).max(7).optional(),
  runId: z.string().min(1).optional(),
});

const statusSchema = z.enum(RAW_INPUT_STATUSES);

function scopedClientFilter(actor: ActorContext, clientId?: string | null) {
  if (clientId) {
    assertClientActionAllowed(actor, "viewClient", clientId);
    return clientId;
  }

  return isSystemAdmin(actor) ? undefined : actor.authorizedClientIds;
}

async function resolveBinding(input: {
  actor: ActorContext;
  clientId?: string;
  payrollMonth?: string;
  runId?: string;
}) {
  if (!input.runId) {
    if (input.clientId) {
      assertClientActionAllowed(input.actor, "updatePayrollRun", input.clientId);
    }

    return {
      clientId: input.clientId ?? null,
      payrollMonth: input.payrollMonth ?? null,
      runId: null,
    };
  }

  const run = await prisma.payrollRun.findUnique({
    where: { id: input.runId },
    select: { id: true, clientId: true, payrollMonth: true },
  });
  if (!run) {
    throw new Error("PAYROLL_RUN_NOT_FOUND");
  }
  assertClientActionAllowed(input.actor, "updatePayrollRun", run.clientId);

  if (input.clientId && input.clientId !== run.clientId) {
    throw new Error("RAW_INPUT_BINDING_MISMATCH");
  }

  if (input.payrollMonth && input.payrollMonth !== run.payrollMonth) {
    throw new Error("RAW_INPUT_BINDING_MISMATCH");
  }

  return { clientId: run.clientId, payrollMonth: run.payrollMonth, runId: run.id };
}

export async function GET(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const { searchParams } = request.nextUrl;
    const runId = searchParams.get("runId")?.trim() || undefined;
    const clientId = searchParams.get("clientId")?.trim() || undefined;
    const statusValue = searchParams.get("status")?.trim() || undefined;
    const status = statusValue ? statusSchema.parse(statusValue) : undefined;

    if (runId) {
      const run = await prisma.payrollRun.findUnique({
        where: { id: runId },
        select: { clientId: true },
      });
      if (!run) {
        throw new Error("PAYROLL_RUN_NOT_FOUND");
      }
      assertClientActionAllowed(actor, "viewClient", run.clientId);
    }

    const clientScope = scopedClientFilter(actor, clientId);
    const clientVisibility =
      clientId || !Array.isArray(clientScope)
        ? {
            clientId: Array.isArray(clientScope)
              ? { in: clientScope }
              : clientScope
                ? clientScope
                : undefined,
          }
        : {
            OR: [{ clientId: { in: clientScope } }, { clientId: null, createdById: actor.id }],
          };
    const rawInputs = await prisma.rawInputItem.findMany({
      where: {
        runId,
        ...clientVisibility,
        status,
      },
      include: {
        client: { select: { code: true, name: true } },
        payrollRun: { select: { id: true, payrollMonth: true, status: true } },
        uploadedFiles: {
          select: {
            id: true,
            fileName: true,
            purpose: true,
            versionNumber: true,
            parseStatus: true,
            riskFlags: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 3,
        },
        caseItems: {
          where: { status: "OPEN" },
          select: { id: true, type: true, riskLevel: true, title: true },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
    });

    return NextResponse.json({ rawInputs });
  });
}

export async function POST(request: NextRequest) {
  return handleApi(async () => {
    const actor = await actorFromHeadersWithDatabase(request.headers);
    const auditFields = await requestAuditFields(actor, request.headers);
    const body = createRawInputSchema.parse(await request.json());
    const binding = await resolveBinding({
      actor,
      clientId: body.clientId,
      payrollMonth: body.payrollMonth,
      runId: body.runId,
    });
    const originalText = body.originalText.trim();
    const contentHash = hashRawInputContent(originalText);
    const duplicate = await prisma.rawInputItem.findFirst({
      where: {
        contentHash,
        clientId: binding.clientId,
        payrollMonth: binding.payrollMonth,
      },
      select: { id: true, contentHash: true },
    });
    const securityFlags = detectInstructionLikeContent(originalText);
    const isAssigned = Boolean(binding.clientId && binding.payrollMonth);

    const rawInput = await prisma.$transaction(async (tx) => {
      const created = await tx.rawInputItem.create({
        data: {
          ...binding,
          sourceChannel: body.sourceChannel,
          inputType: body.inputType,
          status: isAssigned ? "PENDING_EXTRACTION" : "PENDING_ASSIGNMENT",
          originalText,
          redactedSummary: summarizeRawInput(originalText),
          contentHash,
          duplicateGroupHash: duplicate?.contentHash ?? null,
          duplicateRiskScore: duplicate ? 1 : 0,
          securityFlags,
          createdById: auditFields.actorUserId,
        },
      });
      const updated = await tx.rawInputItem.update({
        where: { id: created.id },
        data: { evidenceCandidateRefs: [evidenceCandidateRefForRawInput(created.id)] },
      });

      const caseCreates = [];
      if (!isAssigned) {
        caseCreates.push(
          tx.caseItem.create({
            data: {
              clientId: binding.clientId,
              runId: binding.runId,
              rawInputItemId: created.id,
              type: "INTAKE_UNASSIGNED",
              riskLevel: "R1",
              title: "原始输入未完成客户/月度归属",
              detail: "未归属输入不得进入 ChangeProposal、映射、算薪或导出流程。",
            },
          }),
        );
      }

      if (duplicate) {
        caseCreates.push(
          tx.caseItem.create({
            data: {
              clientId: binding.clientId,
              runId: binding.runId,
              rawInputItemId: created.id,
              type: "DUPLICATE_RISK",
              riskLevel: "R1",
              title: "检测到重复原始输入",
              detail: `与 ${duplicate.id} 的内容 hash 相同，保留证据但需要人工确认是否重复处理。`,
              metadata: { duplicateRawInputItemId: duplicate.id },
            },
          }),
        );
      }

      if (securityFlags.length > 0) {
        caseCreates.push(
          tx.caseItem.create({
            data: {
              clientId: binding.clientId,
              runId: binding.runId,
              rawInputItemId: created.id,
              type: "SECURITY_REVIEW",
              riskLevel: "R2",
              title: "原始输入包含疑似指令类内容",
              detail: "客户文本只能作为数据处理，不得改变系统规则、权限或工具调用边界。",
              metadata: { securityFlags },
            },
          }),
        );
      }

      await Promise.all(caseCreates);
      await tx.auditLog.create({
        data: {
          action: "RAW_INPUT_CREATED",
          objectType: "RAW_INPUT_ITEM",
          objectId: created.id,
          riskLevel: "R1",
          ...auditFields,
          clientId: binding.clientId,
          runId: binding.runId,
          metadata: {
            inputType: body.inputType,
            sourceChannel: body.sourceChannel,
            status: updated.status,
            securityFlags,
            duplicateRiskScore: updated.duplicateRiskScore,
            inputSummary: "保存原始输入为不可信 evidence 候选，不触发生效变更",
          },
        },
      });

      return updated;
    });

    return NextResponse.json({ rawInput }, { status: 201 });
  });
}
