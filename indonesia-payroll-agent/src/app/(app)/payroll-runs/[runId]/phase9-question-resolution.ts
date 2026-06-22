import { type PrismaClient } from "@/generated/prisma/client";

type QuestionResolutionDb = Pick<PrismaClient, "caseItem" | "evidence">;

export type QuestionResolutionSubject = {
  clientId: string;
  runId: string;
  blockingIssueRef?: string | null;
  evidenceRefs: string[];
};

export async function loadQuestionResolutionGuardContext(
  db: QuestionResolutionDb,
  question: QuestionResolutionSubject,
  submittedEvidenceId?: string,
) {
  const evidenceIds = new Set(evidenceIdsFromRefs(question.evidenceRefs));
  let submittedEvidenceRef: string | undefined;

  if (submittedEvidenceId) {
    const evidence = await db.evidence.findUnique({
      where: { id: submittedEvidenceId },
      select: { id: true, clientId: true, runId: true, status: true },
    });
    if (!evidence || evidence.clientId !== question.clientId || evidence.runId !== question.runId || evidence.status !== "VALID") {
      throw new Error("QUESTION_EVIDENCE_SCOPE_MISMATCH");
    }
    evidenceIds.add(evidence.id);
    submittedEvidenceRef = evidenceRefForId(evidence.id);
  }

  const verifiedEvidenceCount =
    evidenceIds.size > 0
      ? await db.evidence.count({
          where: {
            id: { in: [...evidenceIds] },
            clientId: question.clientId,
            runId: question.runId,
            status: "VALID",
          },
        })
      : 0;

  return {
    submittedEvidenceRef,
    verifiedEvidenceCount,
    blockingStatus: await blockingStatusForQuestion(db, question),
  };
}

function evidenceRefForId(evidenceId: string) {
  return `evidence:${evidenceId}`;
}

function evidenceIdsFromRefs(refs: string[]) {
  return refs
    .map((ref) => {
      const value = ref.trim();
      if (!value) return null;
      return value.startsWith("evidence:") ? value.slice("evidence:".length) : null;
    })
    .filter((value): value is string => Boolean(value));
}

async function blockingStatusForQuestion(
  db: QuestionResolutionDb,
  question: QuestionResolutionSubject,
) {
  const caseItemId = caseItemIdFromBlockingRef(question.blockingIssueRef);
  if (!question.blockingIssueRef?.trim()) {
    return "NONE" as const;
  }
  if (!caseItemId) {
    return "UNKNOWN" as const;
  }

  const caseItem = await db.caseItem.findUnique({
    where: { id: caseItemId },
    select: { clientId: true, runId: true, status: true },
  });
  if (!caseItem || caseItem.clientId !== question.clientId || caseItem.runId !== question.runId) {
    return "UNKNOWN" as const;
  }

  return caseItem.status === "RESOLVED" ? "RESOLVED" as const : "UNRESOLVED" as const;
}

function caseItemIdFromBlockingRef(ref?: string | null) {
  const value = ref?.trim();
  if (!value) {
    return null;
  }

  const prefixed = value.match(/^(case_item|case-item|caseitem|case|blocking):(.+)$/i);
  return (prefixed?.[2] ?? value).trim() || null;
}
