import { z } from "zod";
import { CUSTOMER_CONFIRMATION_PACK_ITEM_STATUSES } from "@/domain/confirmation-packs/customer-confirmation-pack-service";

const generatePackSchema = z.object({
  action: z.literal("generate").default("generate"),
});

const recordConfirmationSchema = z.object({
  action: z.literal("recordConfirmation"),
  packId: z.string().min(1).optional(),
  evidenceId: z.string().min(1),
  coverageScope: z.record(z.string(), z.unknown()),
  confirmationText: z.string().min(1).max(20_000),
  confirmedByName: z.string().max(120).optional(),
});

const updateItemSchema = z.object({
  action: z.literal("updateItem"),
  itemId: z.string().min(1),
  status: z.enum(CUSTOMER_CONFIRMATION_PACK_ITEM_STATUSES),
  handlingReason: z.string().max(2000).optional(),
});

const updateMessageSchema = z.object({
  action: z.literal("updateMessage"),
  packId: z.string().min(1),
  editableMessage: z.string().min(1).max(20_000),
});

export const packRequestSchema = z.discriminatedUnion("action", [
  generatePackSchema,
  recordConfirmationSchema,
  updateItemSchema,
  updateMessageSchema,
]);
