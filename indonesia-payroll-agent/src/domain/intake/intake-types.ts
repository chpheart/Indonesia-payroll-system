export const RAW_INPUT_SOURCE_CHANNELS = [
  "WECHAT_TEXT",
  "WECHAT_SCREENSHOT",
  "CUSTOMER_EXCEL",
  "CONTRACT",
  "CUSTOMER_CONFIRMATION",
  "INTERNAL_NOTE",
  "OTHER",
] as const;

export const RAW_INPUT_TYPES = [
  "TEXT",
  "IMAGE",
  "EXCEL",
  "PDF",
  "DOCUMENT",
  "NOTE",
  "OTHER",
] as const;

export const RAW_INPUT_STATUSES = [
  "PENDING_ASSIGNMENT",
  "PENDING_EXTRACTION",
  "EXTRACTED_PENDING_REVIEW",
  "PROPOSAL_GENERATED",
  "NEEDS_QUESTION",
  "ARCHIVED",
  "REJECTED",
  "VOIDED",
] as const;

export const CASE_ITEM_TYPES = [
  "INTAKE_UNASSIGNED",
  "LOW_CONFIDENCE",
  "DUPLICATE_RISK",
  "MISSING_INFORMATION",
  "SECURITY_REVIEW",
  "FILE_PARSE_BLOCKER",
] as const;

export const CASE_ITEM_STATUSES = ["OPEN", "RESOLVED", "CANCELLED"] as const;

export type RawInputSourceChannel = (typeof RAW_INPUT_SOURCE_CHANNELS)[number];
export type RawInputType = (typeof RAW_INPUT_TYPES)[number];
export type RawInputStatus = (typeof RAW_INPUT_STATUSES)[number];
export type CaseItemType = (typeof CASE_ITEM_TYPES)[number];
export type CaseItemStatus = (typeof CASE_ITEM_STATUSES)[number];
