"use server";
import { createEvidenceAction as createEvidence } from "@/app/(app)/payroll-runs/[runId]/phase9-evidence-actions";
import {
  createQuestionAction as createQuestion,
  transitionQuestionAction as transitionQuestion,
} from "@/app/(app)/payroll-runs/[runId]/phase9-question-actions";
import {
  generateCustomerConfirmationPackAction as generateCustomerConfirmationPack,
  recordCustomerConfirmationAction as recordCustomerConfirmation,
  updateConfirmationPackItemAction as updateConfirmationPackItem,
} from "@/app/(app)/payroll-runs/[runId]/phase9-confirmation-actions";
import { updateCustomerConfirmationPackMessageAction as updateCustomerConfirmationPackMessage } from "@/app/(app)/payroll-runs/[runId]/phase9-pack-message-actions";

export async function createEvidenceAction(formData: FormData) {
  return createEvidence(formData);
}

export async function createQuestionAction(formData: FormData) {
  return createQuestion(formData);
}

export async function transitionQuestionAction(formData: FormData) {
  return transitionQuestion(formData);
}

export async function generateCustomerConfirmationPackAction(formData: FormData) {
  return generateCustomerConfirmationPack(formData);
}

export async function recordCustomerConfirmationAction(formData: FormData) {
  return recordCustomerConfirmation(formData);
}

export async function updateConfirmationPackItemAction(formData: FormData) {
  return updateConfirmationPackItem(formData);
}

export async function updateCustomerConfirmationPackMessageAction(formData: FormData) {
  return updateCustomerConfirmationPackMessage(formData);
}
