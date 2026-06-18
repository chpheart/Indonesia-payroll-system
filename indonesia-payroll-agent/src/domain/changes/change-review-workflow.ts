import { type ChangeProposalStatus } from "@/domain/changes/change-review-policy";

export const CLOSE_CHANGE_PROPOSAL_ACTIONS = [
  "reject",
  "return",
  "noAction",
  "convertToQuestion",
  "merge",
  "split",
] as const;

export type CloseChangeProposalAction = (typeof CLOSE_CHANGE_PROPOSAL_ACTIONS)[number];

export const CLOSE_CHANGE_PROPOSAL_STATUS: Record<
  CloseChangeProposalAction,
  Extract<
    ChangeProposalStatus,
    "REJECTED" | "RETURNED" | "NO_ACTION" | "CONVERTED_TO_QUESTION" | "MERGED" | "SPLIT"
  >
> = {
  reject: "REJECTED",
  return: "RETURNED",
  noAction: "NO_ACTION",
  convertToQuestion: "CONVERTED_TO_QUESTION",
  merge: "MERGED",
  split: "SPLIT",
};

export type FormalObjectRefInput = {
  id: string;
  targetObjectType: string;
  targetObjectId?: string | null;
  targetEmployeeId?: string | null;
  targetField: string;
  effectiveFrom: string;
};

export function formalObjectReferenceForProposal(
  proposal: FormalObjectRefInput,
  override: {
    formalObjectType?: string | null;
    formalObjectId?: string | null;
    formalObjectVersionRef?: string | null;
  } = {},
) {
  const formalObjectType = clean(override.formalObjectType) ?? proposal.targetObjectType;
  const formalObjectId =
    clean(override.formalObjectId) ?? proposal.targetObjectId ?? proposal.targetEmployeeId ?? null;
  const formalObjectVersionRef =
    clean(override.formalObjectVersionRef) ??
    `${formalObjectType}:${formalObjectId ?? proposal.id}:${proposal.targetField}:${proposal.effectiveFrom}`;

  return { formalObjectType, formalObjectId, formalObjectVersionRef };
}

export function assertRelatedProposalIdsForCloseAction(
  action: CloseChangeProposalAction,
  relatedProposalIds: string[],
) {
  if ((action === "merge" || action === "split") && relatedProposalIds.length === 0) {
    throw new Error("RELATED_PROPOSALS_REQUIRED_FOR_REVIEW_ACTION");
  }
}

export function assertRelatedProposalScope(input: {
  action: CloseChangeProposalAction;
  proposalId: string;
  clientId: string;
  runId: string;
  relatedProposalIds: string[];
  relatedProposals: Array<{ id: string; clientId: string; runId: string }>;
}) {
  assertRelatedProposalIdsForCloseAction(input.action, input.relatedProposalIds);
  if (input.action !== "merge" && input.action !== "split") {
    return;
  }
  if (new Set(input.relatedProposalIds).size !== input.relatedProposalIds.length) {
    throw new Error("RELATED_PROPOSALS_MUST_BE_UNIQUE");
  }
  if (input.relatedProposalIds.includes(input.proposalId)) {
    throw new Error("RELATED_PROPOSAL_CANNOT_REFERENCE_SELF");
  }
  if (input.relatedProposals.length !== input.relatedProposalIds.length) {
    throw new Error("RELATED_PROPOSALS_NOT_FOUND");
  }
  if (input.relatedProposals.some((proposal) => proposal.clientId !== input.clientId || proposal.runId !== input.runId)) {
    throw new Error("RELATED_PROPOSALS_SCOPE_MISMATCH");
  }
}

export function closeActionRequiresRelatedProposalLookup(action: CloseChangeProposalAction) {
  return action === "merge" || action === "split";
}

function clean(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
