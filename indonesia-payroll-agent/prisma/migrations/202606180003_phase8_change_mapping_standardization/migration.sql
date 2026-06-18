-- CreateEnum
CREATE TYPE "confidence_band" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CONFLICT');

-- CreateEnum
CREATE TYPE "change_proposal_source" AS ENUM (
    'AI_EXTRACTION',
    'MANUAL_FROM_INTAKE',
    'HISTORICAL_TEMPLATE'
);

-- CreateEnum
CREATE TYPE "change_proposal_type" AS ENUM (
    'NEW_HIRE',
    'TERMINATION',
    'SALARY_ADJUSTMENT',
    'BONUS_DEDUCTION',
    'LEAVE_ABSENCE',
    'BPJS_CHANGE',
    'BANK_IDENTITY_TAX_CHANGE',
    'CONTRACT_EMPLOYMENT_FACT',
    'CLIENT_POLICY_CHANGE',
    'FX_RATE_CHANGE',
    'FIELD_MAPPING',
    'STANDARDIZED_INPUT',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "change_proposal_status" AS ENUM (
    'PENDING_REVIEW',
    'APPROVED',
    'APPROVED_WITH_MODIFICATION',
    'REJECTED',
    'RETURNED',
    'CONVERTED_TO_QUESTION',
    'NO_ACTION',
    'MERGED',
    'SPLIT'
);

-- CreateEnum
CREATE TYPE "field_mapping_source" AS ENUM ('AGENT', 'HISTORICAL_TEMPLATE', 'MANUAL');

-- CreateEnum
CREATE TYPE "field_mapping_status" AS ENUM ('CANDIDATE', 'CONFIRMED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "employee_match_method" AS ENUM (
    'EMPLOYEE_CODE',
    'NIK_OR_PASSPORT',
    'NPWP',
    'NAME_WITH_CONTEXT',
    'NAME_ONLY',
    'UNMATCHED',
    'NEW_EMPLOYEE_REQUIRED'
);

-- CreateEnum
CREATE TYPE "employee_match_status" AS ENUM ('CANDIDATE', 'CONFIRMED', 'REJECTED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "standardized_input_status" AS ENUM ('PREVIEW', 'CONFIRMED', 'BLOCKED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "evidence_status" AS ENUM ('VALID', 'MISSING', 'STALE');

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'CHANGE_PROPOSAL_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'CHANGE_PROPOSAL_REVIEWED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'CHANGE_LEDGER_ENTRY_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'FIELD_MAPPING_CANDIDATE_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'FIELD_MAPPING_VERSION_CONFIRMED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'STANDARDIZED_INPUT_PREVIEW_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'STANDARDIZED_INPUT_CONFIRMED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EMPLOYEE_MATCH_CANDIDATE_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'EMPLOYEE_MATCH_CONFIRMED';

-- AlterEnum
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'CHANGE_PROPOSAL';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'CHANGE_LEDGER_ENTRY';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'FIELD_MAPPING_CANDIDATE';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'FIELD_MAPPING_VERSION';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'STANDARDIZED_PAYROLL_INPUT';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'EMPLOYEE_MATCH_CANDIDATE';

-- CreateTable
CREATE TABLE "change_proposals" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "raw_input_item_id" TEXT,
    "source_agent_run_id" TEXT,
    "created_by_id" TEXT,
    "reviewed_by_id" TEXT,
    "target_employee_id" TEXT,
    "source" "change_proposal_source" NOT NULL,
    "proposal_type" "change_proposal_type" NOT NULL,
    "status" "change_proposal_status" NOT NULL DEFAULT 'PENDING_REVIEW',
    "target_object_type" TEXT NOT NULL,
    "target_object_id" TEXT,
    "target_field" TEXT NOT NULL,
    "previous_value" JSONB NOT NULL DEFAULT '{}',
    "proposed_value" JSONB NOT NULL DEFAULT '{}',
    "effective_from" TEXT NOT NULL,
    "effective_to" TEXT,
    "risk_level" "audit_risk_level" NOT NULL,
    "confidence" "confidence_band" NOT NULL,
    "reason" TEXT NOT NULL,
    "difference_preview" JSONB NOT NULL DEFAULT '{}',
    "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "required_evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "related_proposal_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_ledger_entries" (
    "id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "reviewed_by_id" TEXT,
    "target_employee_id" TEXT,
    "entry_type" "change_proposal_type" NOT NULL,
    "target_object_type" TEXT NOT NULL,
    "target_object_id" TEXT,
    "target_field" TEXT NOT NULL,
    "previous_value" JSONB NOT NULL DEFAULT '{}',
    "new_value" JSONB NOT NULL DEFAULT '{}',
    "effective_from" TEXT NOT NULL,
    "effective_to" TEXT,
    "risk_level" "audit_risk_level" NOT NULL,
    "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "formal_object_type" TEXT,
    "formal_object_id" TEXT,
    "formal_object_version_ref" TEXT,
    "reversal_of_entry_id" TEXT,
    "amendment_of_entry_id" TEXT,
    "review_note" TEXT,
    "reviewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mapping_candidates" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "raw_input_item_id" TEXT,
    "file_version_id" TEXT,
    "workbook_parse_id" TEXT,
    "sheet_id" TEXT,
    "source_agent_run_id" TEXT,
    "source" "field_mapping_source" NOT NULL DEFAULT 'AGENT',
    "status" "field_mapping_status" NOT NULL DEFAULT 'CANDIDATE',
    "source_sheet_name" TEXT NOT NULL,
    "source_column_label" TEXT NOT NULL,
    "source_column_index" INTEGER,
    "sample_values" JSONB NOT NULL DEFAULT '[]',
    "target_field" TEXT NOT NULL,
    "field_category" TEXT NOT NULL DEFAULT 'INPUT',
    "confidence" "confidence_band" NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_mapping_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mapping_versions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "candidate_id" TEXT,
    "file_version_id" TEXT,
    "sheet_id" TEXT,
    "version_number" INTEGER NOT NULL,
    "source" "field_mapping_source" NOT NULL DEFAULT 'MANUAL',
    "status" "field_mapping_status" NOT NULL DEFAULT 'CONFIRMED',
    "source_sheet_name" TEXT NOT NULL,
    "source_column_label" TEXT NOT NULL,
    "source_column_index" INTEGER,
    "target_field" TEXT NOT NULL,
    "field_category" TEXT NOT NULL DEFAULT 'INPUT',
    "confidence" "confidence_band" NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "template_source_ref" TEXT,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_mapping_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_match_candidates" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "raw_input_item_id" TEXT,
    "sheet_id" TEXT,
    "source_agent_run_id" TEXT,
    "employee_id" TEXT,
    "employee_code_raw" TEXT,
    "full_name_raw" TEXT NOT NULL,
    "nik_or_passport_raw" TEXT,
    "npwp_raw" TEXT,
    "join_date_raw" TEXT,
    "store_code" TEXT,
    "position_raw" TEXT,
    "match_method" "employee_match_method" NOT NULL,
    "confidence" "confidence_band" NOT NULL,
    "status" "employee_match_status" NOT NULL DEFAULT 'CANDIDATE',
    "conflict_summary" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT NOT NULL,
    "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_match_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "standardized_payroll_inputs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "field_mapping_version_id" TEXT,
    "employee_id" TEXT,
    "employee_match_candidate_id" TEXT,
    "payroll_component_id" TEXT,
    "raw_input_item_id" TEXT,
    "file_version_id" TEXT,
    "sheet_id" TEXT,
    "source_cell_id" TEXT,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "status" "standardized_input_status" NOT NULL DEFAULT 'PREVIEW',
    "standard_field" TEXT NOT NULL,
    "component_code" TEXT,
    "amount" DECIMAL(18,2),
    "currency_code" TEXT NOT NULL DEFAULT 'IDR',
    "value" JSONB NOT NULL DEFAULT '{}',
    "source_sheet_name" TEXT,
    "source_row_index" INTEGER,
    "store_code" TEXT,
    "store_name" TEXT,
    "evidence_status" "evidence_status" NOT NULL DEFAULT 'MISSING',
    "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "validation_issues" JSONB NOT NULL DEFAULT '[]',
    "optimistic_lock_version" INTEGER NOT NULL DEFAULT 1,
    "modified_by_id" TEXT,
    "confirmed_by_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "standardized_payroll_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_ledger_entries_proposal_id_key" ON "change_ledger_entries"("proposal_id");

-- CreateIndex
CREATE INDEX "change_proposals_client_id_status_idx" ON "change_proposals"("client_id", "status");

-- CreateIndex
CREATE INDEX "change_proposals_run_id_status_idx" ON "change_proposals"("run_id", "status");

-- CreateIndex
CREATE INDEX "change_proposals_raw_input_item_id_idx" ON "change_proposals"("raw_input_item_id");

-- CreateIndex
CREATE INDEX "change_proposals_proposal_type_risk_level_idx" ON "change_proposals"("proposal_type", "risk_level");

-- CreateIndex
CREATE INDEX "change_proposals_target_object_type_target_object_id_idx" ON "change_proposals"("target_object_type", "target_object_id");

-- CreateIndex
CREATE INDEX "change_ledger_entries_client_id_reviewed_at_idx" ON "change_ledger_entries"("client_id", "reviewed_at");

-- CreateIndex
CREATE INDEX "change_ledger_entries_run_id_reviewed_at_idx" ON "change_ledger_entries"("run_id", "reviewed_at");

-- CreateIndex
CREATE INDEX "change_ledger_entries_entry_type_risk_level_idx" ON "change_ledger_entries"("entry_type", "risk_level");

-- CreateIndex
CREATE INDEX "change_ledger_entries_target_object_type_target_object_id_idx" ON "change_ledger_entries"("target_object_type", "target_object_id");

-- CreateIndex
CREATE INDEX "change_ledger_entries_formal_object_type_formal_object_id_idx" ON "change_ledger_entries"("formal_object_type", "formal_object_id");

-- CreateIndex
CREATE INDEX "field_mapping_candidates_client_id_status_idx" ON "field_mapping_candidates"("client_id", "status");

-- CreateIndex
CREATE INDEX "field_mapping_candidates_run_id_status_idx" ON "field_mapping_candidates"("run_id", "status");

-- CreateIndex
CREATE INDEX "field_mapping_candidates_confidence_status_idx" ON "field_mapping_candidates"("confidence", "status");

-- CreateIndex
CREATE INDEX "field_mapping_candidates_file_version_id_idx" ON "field_mapping_candidates"("file_version_id");

-- CreateIndex
CREATE INDEX "field_mapping_candidates_source_sheet_name_source_column_label_idx" ON "field_mapping_candidates"("source_sheet_name", "source_column_label");

-- CreateIndex
CREATE UNIQUE INDEX "field_mapping_versions_run_id_source_sheet_name_source_column_label_version_number_key" ON "field_mapping_versions"("run_id", "source_sheet_name", "source_column_label", "version_number");

-- CreateIndex
CREATE INDEX "field_mapping_versions_client_id_status_idx" ON "field_mapping_versions"("client_id", "status");

-- CreateIndex
CREATE INDEX "field_mapping_versions_run_id_status_idx" ON "field_mapping_versions"("run_id", "status");

-- CreateIndex
CREATE INDEX "field_mapping_versions_confidence_status_idx" ON "field_mapping_versions"("confidence", "status");

-- CreateIndex
CREATE INDEX "employee_match_candidates_client_id_status_idx" ON "employee_match_candidates"("client_id", "status");

-- CreateIndex
CREATE INDEX "employee_match_candidates_run_id_status_idx" ON "employee_match_candidates"("run_id", "status");

-- CreateIndex
CREATE INDEX "employee_match_candidates_employee_id_idx" ON "employee_match_candidates"("employee_id");

-- CreateIndex
CREATE INDEX "employee_match_candidates_match_method_confidence_idx" ON "employee_match_candidates"("match_method", "confidence");

-- CreateIndex
CREATE INDEX "employee_match_candidates_source_agent_run_id_idx" ON "employee_match_candidates"("source_agent_run_id");

-- CreateIndex
CREATE INDEX "standardized_payroll_inputs_client_id_status_idx" ON "standardized_payroll_inputs"("client_id", "status");

-- CreateIndex
CREATE INDEX "standardized_payroll_inputs_run_id_status_idx" ON "standardized_payroll_inputs"("run_id", "status");

-- CreateIndex
CREATE INDEX "standardized_payroll_inputs_employee_id_standard_field_idx" ON "standardized_payroll_inputs"("employee_id", "standard_field");

-- CreateIndex
CREATE INDEX "standardized_payroll_inputs_evidence_status_status_idx" ON "standardized_payroll_inputs"("evidence_status", "status");

-- CreateIndex
CREATE INDEX "standardized_payroll_inputs_store_code_idx" ON "standardized_payroll_inputs"("store_code");

-- AddForeignKey
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_raw_input_item_id_fkey" FOREIGN KEY ("raw_input_item_id") REFERENCES "raw_input_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_source_agent_run_id_fkey" FOREIGN KEY ("source_agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "change_proposals" ADD CONSTRAINT "change_proposals_target_employee_id_fkey" FOREIGN KEY ("target_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "change_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "change_ledger_entries" ADD CONSTRAINT "change_ledger_entries_target_employee_id_fkey" FOREIGN KEY ("target_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mapping_candidates" ADD CONSTRAINT "field_mapping_candidates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_mapping_candidates" ADD CONSTRAINT "field_mapping_candidates_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_mapping_candidates" ADD CONSTRAINT "field_mapping_candidates_raw_input_item_id_fkey" FOREIGN KEY ("raw_input_item_id") REFERENCES "raw_input_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_mapping_candidates" ADD CONSTRAINT "field_mapping_candidates_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "uploaded_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_mapping_candidates" ADD CONSTRAINT "field_mapping_candidates_workbook_parse_id_fkey" FOREIGN KEY ("workbook_parse_id") REFERENCES "workbook_parses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_mapping_candidates" ADD CONSTRAINT "field_mapping_candidates_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "workbook_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_mapping_candidates" ADD CONSTRAINT "field_mapping_candidates_source_agent_run_id_fkey" FOREIGN KEY ("source_agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mapping_versions" ADD CONSTRAINT "field_mapping_versions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_mapping_versions" ADD CONSTRAINT "field_mapping_versions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_mapping_versions" ADD CONSTRAINT "field_mapping_versions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "field_mapping_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_mapping_versions" ADD CONSTRAINT "field_mapping_versions_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "uploaded_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_mapping_versions" ADD CONSTRAINT "field_mapping_versions_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "workbook_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_mapping_versions" ADD CONSTRAINT "field_mapping_versions_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_match_candidates" ADD CONSTRAINT "employee_match_candidates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_match_candidates" ADD CONSTRAINT "employee_match_candidates_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_match_candidates" ADD CONSTRAINT "employee_match_candidates_raw_input_item_id_fkey" FOREIGN KEY ("raw_input_item_id") REFERENCES "raw_input_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_match_candidates" ADD CONSTRAINT "employee_match_candidates_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "workbook_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_match_candidates" ADD CONSTRAINT "employee_match_candidates_source_agent_run_id_fkey" FOREIGN KEY ("source_agent_run_id") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_match_candidates" ADD CONSTRAINT "employee_match_candidates_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employee_match_candidates" ADD CONSTRAINT "employee_match_candidates_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_field_mapping_version_id_fkey" FOREIGN KEY ("field_mapping_version_id") REFERENCES "field_mapping_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_employee_match_candidate_id_fkey" FOREIGN KEY ("employee_match_candidate_id") REFERENCES "employee_match_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_payroll_component_id_fkey" FOREIGN KEY ("payroll_component_id") REFERENCES "payroll_components"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_raw_input_item_id_fkey" FOREIGN KEY ("raw_input_item_id") REFERENCES "raw_input_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "uploaded_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "workbook_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_source_cell_id_fkey" FOREIGN KEY ("source_cell_id") REFERENCES "workbook_cells"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_modified_by_id_fkey" FOREIGN KEY ("modified_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "standardized_payroll_inputs" ADD CONSTRAINT "standardized_payroll_inputs_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
