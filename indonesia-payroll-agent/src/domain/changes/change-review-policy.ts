import { type AuditRiskLevel } from "@/domain/audit/audit-service";

export const CHANGE_PROPOSAL_SOURCES = [
  "AI_EXTRACTION",
  "MANUAL_FROM_INTAKE",
  "HISTORICAL_TEMPLATE",
] as const;

export const CHANGE_PROPOSAL_TYPES = [
  "NEW_HIRE",
  "TERMINATION",
  "SALARY_ADJUSTMENT",
  "BONUS_DEDUCTION",
  "LEAVE_ABSENCE",
  "BPJS_CHANGE",
  "BANK_IDENTITY_TAX_CHANGE",
  "CONTRACT_EMPLOYMENT_FACT",
  "CLIENT_POLICY_CHANGE",
  "FX_RATE_CHANGE",
  "FIELD_MAPPING",
  "STANDARDIZED_INPUT",
  "OTHER",
] as const;

export const CHANGE_PROPOSAL_STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "APPROVED_WITH_MODIFICATION",
  "REJECTED",
  "RETURNED",
  "CONVERTED_TO_QUESTION",
  "NO_ACTION",
  "MERGED",
  "SPLIT",
] as const;

export const CONFIDENCE_BANDS = ["LOW", "MEDIUM", "HIGH", "CONFLICT"] as const;

export type ChangeProposalSource = (typeof CHANGE_PROPOSAL_SOURCES)[number];
export type ChangeProposalType = (typeof CHANGE_PROPOSAL_TYPES)[number];
export type ChangeProposalStatus = (typeof CHANGE_PROPOSAL_STATUSES)[number];
export type ConfidenceBand = (typeof CONFIDENCE_BANDS)[number];

const HIGH_IMPACT_TYPES = new Set<ChangeProposalType>([
  "NEW_HIRE",
  "TERMINATION",
  "SALARY_ADJUSTMENT",
  "BONUS_DEDUCTION",
  "BPJS_CHANGE",
  "BANK_IDENTITY_TAX_CHANGE",
  "CONTRACT_EMPLOYMENT_FACT",
  "CLIENT_POLICY_CHANGE",
  "FX_RATE_CHANGE",
  "STANDARDIZED_INPUT",
]);

const CRITICAL_FIELD_PATTERNS = [
  /amount/i,
  /salary/i,
  /bonus/i,
  /deduction/i,
  /bpjs/i,
  /bank/i,
  /nik/i,
  /passport/i,
  /npwp/i,
  /tax/i,
  /termination/i,
  /join/i,
  /effective/i,
  /fx/i,
  /gross/i,
];

export type ReviewableProposal = {
  proposalType: ChangeProposalType;
  targetField: string;
  riskLevel: AuditRiskLevel;
  confidence: ConfidenceBand;
  evidenceRefs: string[];
  requiredEvidenceRefs: string[];
};

export function proposalRequiresEvidence(proposal: ReviewableProposal): boolean {
  return (
    HIGH_IMPACT_TYPES.has(proposal.proposalType) ||
    ["R2", "R3", "R4"].includes(proposal.riskLevel) ||
    CRITICAL_FIELD_PATTERNS.some((pattern) => pattern.test(proposal.targetField))
  );
}

export function assertProposalCanBeApproved(proposal: ReviewableProposal): void {
  if (proposal.confidence === "LOW" || proposal.confidence === "CONFLICT") {
    throw new ChangeReviewPolicyError("LOW_CONFIDENCE_PROPOSAL_REQUIRES_MODIFICATION_OR_REJECTION");
  }

  if (proposalRequiresEvidence(proposal) && proposal.evidenceRefs.length === 0) {
    throw new ChangeReviewPolicyError("CRITICAL_PROPOSAL_EVIDENCE_REQUIRED");
  }

  const missingRequired = proposal.requiredEvidenceRefs.filter(
    (ref) => !proposal.evidenceRefs.includes(ref),
  );
  if (missingRequired.length > 0) {
    throw new ChangeReviewPolicyError("REQUIRED_PROPOSAL_EVIDENCE_MISSING");
  }
}

export class ChangeReviewPolicyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ChangeReviewPolicyError";
  }
}
