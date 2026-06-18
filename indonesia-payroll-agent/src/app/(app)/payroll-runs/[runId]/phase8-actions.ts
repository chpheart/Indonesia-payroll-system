"use server";
import {
  approveChangeProposalAction as approveChangeProposal,
  closeChangeProposalAction as closeChangeProposal,
} from "@/app/(app)/payroll-runs/[runId]/phase8-change-actions";
import { confirmMappingCandidateAction as confirmMappingCandidate } from "@/app/(app)/payroll-runs/[runId]/phase8-mapping-actions";
import { confirmStandardizedInputAction as confirmStandardizedInput } from "@/app/(app)/payroll-runs/[runId]/phase8-standardization-actions";

export async function approveChangeProposalAction(formData: FormData) {
  return approveChangeProposal(formData);
}

export async function closeChangeProposalAction(formData: FormData) {
  return closeChangeProposal(formData);
}

export async function confirmMappingCandidateAction(formData: FormData) {
  return confirmMappingCandidate(formData);
}

export async function confirmStandardizedInputAction(formData: FormData) {
  return confirmStandardizedInput(formData);
}
