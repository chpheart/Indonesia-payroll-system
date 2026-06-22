import { type CoverageScope } from "@/domain/confirmation-packs/pack-coverage-service";

export const CUSTOMER_CONFIRMATION_PACK_STATUSES = [
  "DRAFT",
  "READY_FOR_CUSTOMER",
  "PARTIALLY_CONFIRMED",
  "CONFIRMED",
  "INVALIDATED",
  "SUPERSEDED",
] as const;

export const CUSTOMER_CONFIRMATION_PACK_ITEM_CATEGORIES = [
  "MONTHLY_CHANGE",
  "MISSING_INFORMATION",
  "EXCEPTION",
  "CONFIRMATION_REQUIRED",
  "SUGGESTED_MESSAGE",
  "EVIDENCE_ATTACHMENT",
] as const;

export const CUSTOMER_CONFIRMATION_PACK_ITEM_STATUSES = [
  "OPEN",
  "INTERNAL_HANDLING",
  "NOT_CUSTOMER_FACING",
  "CONFIRMED",
  "INVALIDATED",
] as const;

export type CustomerConfirmationPackStatus = (typeof CUSTOMER_CONFIRMATION_PACK_STATUSES)[number];
export type CustomerConfirmationPackItemCategory = (typeof CUSTOMER_CONFIRMATION_PACK_ITEM_CATEGORIES)[number];
export type CustomerConfirmationPackItemStatus = (typeof CUSTOMER_CONFIRMATION_PACK_ITEM_STATUSES)[number];

export type PackRunSnapshot = {
  id: string;
  clientId: string;
  clientCode: string;
  clientName: string;
  payrollMonth: string;
  status: string;
  dataVersionRef: string;
  resultVersionRef?: string | null;
  exportPreviewVersionRef?: string | null;
  previousRunRef?: string | null;
};

export type PackLedgerEntry = {
  id: string;
  entryType: string;
  targetEmployeeId?: string | null;
  employeeLabel?: string | null;
  targetField: string;
  previousValue: unknown;
  newValue: unknown;
  riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  evidenceRefs: string[];
};

export type PackQuestion = {
  id: string;
  title: string;
  detail: string;
  reason: string;
  status: string;
  riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  targetObjectType?: string | null;
  targetObjectId?: string | null;
  targetField?: string | null;
  blockingIssueRef?: string | null;
  evidenceRefs: string[];
};

export type PackStandardizedInput = {
  id: string;
  employeeId?: string | null;
  employeeLabel?: string | null;
  standardField: string;
  value: unknown;
  amount?: string | null;
  currencyCode: string;
  status: string;
  evidenceStatus: string;
  evidenceRefs: string[];
  sourceLabel?: string | null;
  previousRunRef?: string | null;
};

export type PackIssue = {
  id: string;
  title: string;
  detail: string;
  riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  sourceObjectType: string;
  sourceObjectId?: string | null;
};

export type PackInvalidConfirmation = {
  id: string;
  invalidationReason: string;
  coverageScope: CoverageScope;
};

export type CustomerConfirmationPackItemDraft = {
  category: CustomerConfirmationPackItemCategory;
  status: CustomerConfirmationPackItemStatus;
  sourceObjectType?: string;
  sourceObjectId?: string;
  targetEmployeeId?: string | null;
  targetField?: string | null;
  title: string;
  detail: string;
  riskLevel: "R0" | "R1" | "R2" | "R3" | "R4";
  isCritical: boolean;
  isSystemRequired: boolean;
  coverageScope: CoverageScope;
  evidenceRefs: string[];
  sortOrder: number;
};

export type CustomerConfirmationPackDraft = {
  runId: string;
  clientId: string;
  status: CustomerConfirmationPackStatus;
  dataVersionRef: string;
  resultVersionRef?: string | null;
  exportPreviewVersionRef?: string | null;
  sourceSnapshot: Record<string, unknown>;
  generatedMessage: string;
  items: CustomerConfirmationPackItemDraft[];
};

export type PackSourceSnapshot = {
  run: PackRunSnapshot;
  ledgerEntries: PackLedgerEntry[];
  questions: PackQuestion[];
  standardizedInputs: PackStandardizedInput[];
  previousStandardizedInputs: PackStandardizedInput[];
  blockingIssues: PackIssue[];
  highRiskIssues: PackIssue[];
  invalidConfirmations: PackInvalidConfirmation[];
};
