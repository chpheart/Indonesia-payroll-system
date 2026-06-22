import { type PrismaClient } from "@/generated/prisma/client";

type QuestionScopeDb = Pick<PrismaClient, "rawInputItem" | "changeProposal">;

export async function assertQuestionSourceScope(
  db: QuestionScopeDb,
  input: {
    clientId: string;
    runId: string;
    rawInputItemId?: string;
    changeProposalId?: string;
  },
) {
  if (input.rawInputItemId) {
    const item = await db.rawInputItem.findUnique({
      where: { id: input.rawInputItemId },
      select: { clientId: true, runId: true },
    });
    if (!item || item.clientId !== input.clientId || item.runId !== input.runId) {
      throw new Error("QUESTION_RAW_INPUT_SCOPE_MISMATCH");
    }
  }

  if (input.changeProposalId) {
    const proposal = await db.changeProposal.findUnique({
      where: { id: input.changeProposalId },
      select: { clientId: true, runId: true },
    });
    if (!proposal || proposal.clientId !== input.clientId || proposal.runId !== input.runId) {
      throw new Error("QUESTION_CHANGE_PROPOSAL_SCOPE_MISMATCH");
    }
  }
}
