-- CreateEnum
CREATE TYPE "raw_input_source_channel" AS ENUM (
    'WECHAT_TEXT',
    'WECHAT_SCREENSHOT',
    'CUSTOMER_EXCEL',
    'CONTRACT',
    'CUSTOMER_CONFIRMATION',
    'INTERNAL_NOTE',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "raw_input_type" AS ENUM (
    'TEXT',
    'IMAGE',
    'EXCEL',
    'PDF',
    'DOCUMENT',
    'NOTE',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "raw_input_status" AS ENUM (
    'PENDING_ASSIGNMENT',
    'PENDING_EXTRACTION',
    'EXTRACTED_PENDING_REVIEW',
    'PROPOSAL_GENERATED',
    'NEEDS_QUESTION',
    'ARCHIVED',
    'REJECTED',
    'VOIDED'
);

-- CreateEnum
CREATE TYPE "file_purpose" AS ENUM (
    'EMPLOYEE_MASTER',
    'MOVEMENT',
    'PAYROLL_INPUT',
    'ATTENDANCE',
    'CONTRACT',
    'CUSTOMER_CONFIRMATION',
    'INTERNAL_NOTE',
    'OTHER'
);

-- CreateEnum
CREATE TYPE "file_parse_status" AS ENUM (
    'PENDING',
    'PARSED',
    'BLOCKED',
    'FAILED',
    'SKIPPED'
);

-- CreateEnum
CREATE TYPE "case_item_type" AS ENUM (
    'INTAKE_UNASSIGNED',
    'LOW_CONFIDENCE',
    'DUPLICATE_RISK',
    'MISSING_INFORMATION',
    'SECURITY_REVIEW',
    'FILE_PARSE_BLOCKER'
);

-- CreateEnum
CREATE TYPE "case_item_status" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'RAW_INPUT_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'RAW_INPUT_BOUND';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'RAW_INPUT_STATUS_CHANGED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'FILE_UPLOADED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'FILE_PARSE_COMPLETED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'FILE_PARSE_BLOCKED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'CASE_ITEM_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'CASE_ITEM_RESOLVED';

-- AlterEnum
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'RAW_INPUT_ITEM';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'UPLOADED_FILE_VERSION';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'WORKBOOK_PARSE';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'CASE_ITEM';

-- CreateTable
CREATE TABLE "raw_input_items" (
    "id" TEXT NOT NULL,
    "client_id" TEXT,
    "payroll_month" TEXT,
    "run_id" TEXT,
    "source_channel" "raw_input_source_channel" NOT NULL,
    "input_type" "raw_input_type" NOT NULL,
    "status" "raw_input_status" NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
    "original_text" TEXT,
    "redacted_summary" TEXT NOT NULL,
    "content_hash" TEXT,
    "attachment_key" TEXT,
    "attachment_file_name" TEXT,
    "attachment_mime_type" TEXT,
    "attachment_size_bytes" INTEGER,
    "duplicate_group_hash" TEXT,
    "duplicate_risk_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidence_candidate_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "security_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raw_input_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_file_versions" (
    "id" TEXT NOT NULL,
    "raw_input_item_id" TEXT,
    "client_id" TEXT,
    "payroll_month" TEXT,
    "run_id" TEXT,
    "purpose" "file_purpose" NOT NULL,
    "version_number" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "parse_status" "file_parse_status" NOT NULL DEFAULT 'PENDING',
    "parse_error_code" TEXT,
    "parse_error_message" TEXT,
    "risk_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "replaces_file_id" TEXT,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uploaded_file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbook_parses" (
    "id" TEXT NOT NULL,
    "file_version_id" TEXT NOT NULL,
    "parser_version" TEXT NOT NULL,
    "status" "file_parse_status" NOT NULL,
    "workbook_name" TEXT,
    "sheet_count" INTEGER NOT NULL DEFAULT 0,
    "formula_cell_count" INTEGER NOT NULL DEFAULT 0,
    "merged_range_count" INTEGER NOT NULL DEFAULT 0,
    "external_link_count" INTEGER NOT NULL DEFAULT 0,
    "dangerous_content_flags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "workbook_parses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbook_sheets" (
    "id" TEXT NOT NULL,
    "workbook_parse_id" TEXT NOT NULL,
    "sheet_name" TEXT NOT NULL,
    "sheet_index" INTEGER NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "column_count" INTEGER NOT NULL DEFAULT 0,
    "effective_range" TEXT,
    "header_row_index" INTEGER,
    "header_values" JSONB NOT NULL DEFAULT '[]',
    "sample_rows" JSONB NOT NULL DEFAULT '[]',
    "merged_ranges" JSONB NOT NULL DEFAULT '[]',
    "has_header" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workbook_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workbook_cells" (
    "id" TEXT NOT NULL,
    "workbook_parse_id" TEXT NOT NULL,
    "sheet_id" TEXT NOT NULL,
    "sheet_name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "column_index" INTEGER NOT NULL,
    "raw_value" TEXT,
    "display_value" TEXT,
    "formula_text" TEXT,
    "number_format" TEXT,
    "merged_range" TEXT,
    "is_header" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "workbook_cells_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_replacements" (
    "id" TEXT NOT NULL,
    "old_file_id" TEXT NOT NULL,
    "new_file_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_replacements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_items" (
    "id" TEXT NOT NULL,
    "client_id" TEXT,
    "run_id" TEXT,
    "raw_input_item_id" TEXT,
    "file_version_id" TEXT,
    "type" "case_item_type" NOT NULL,
    "risk_level" "audit_risk_level" NOT NULL DEFAULT 'R1',
    "status" "case_item_status" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "owner_id" TEXT,
    "resolved_by_id" TEXT,
    "resolution_note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "case_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raw_input_items_client_id_payroll_month_status_idx" ON "raw_input_items"("client_id", "payroll_month", "status");

-- CreateIndex
CREATE INDEX "raw_input_items_run_id_status_idx" ON "raw_input_items"("run_id", "status");

-- CreateIndex
CREATE INDEX "raw_input_items_content_hash_idx" ON "raw_input_items"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_file_versions_raw_input_item_id_version_number_key" ON "uploaded_file_versions"("raw_input_item_id", "version_number");

-- CreateIndex
CREATE INDEX "uploaded_file_versions_client_id_payroll_month_purpose_idx" ON "uploaded_file_versions"("client_id", "payroll_month", "purpose");

-- CreateIndex
CREATE INDEX "uploaded_file_versions_run_id_parse_status_idx" ON "uploaded_file_versions"("run_id", "parse_status");

-- CreateIndex
CREATE INDEX "uploaded_file_versions_sha256_idx" ON "uploaded_file_versions"("sha256");

-- CreateIndex
CREATE INDEX "workbook_parses_file_version_id_started_at_idx" ON "workbook_parses"("file_version_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "workbook_sheets_workbook_parse_id_sheet_name_key" ON "workbook_sheets"("workbook_parse_id", "sheet_name");

-- CreateIndex
CREATE INDEX "workbook_sheets_workbook_parse_id_sheet_index_idx" ON "workbook_sheets"("workbook_parse_id", "sheet_index");

-- CreateIndex
CREATE UNIQUE INDEX "workbook_cells_sheet_id_address_key" ON "workbook_cells"("sheet_id", "address");

-- CreateIndex
CREATE INDEX "workbook_cells_workbook_parse_id_sheet_name_idx" ON "workbook_cells"("workbook_parse_id", "sheet_name");

-- CreateIndex
CREATE UNIQUE INDEX "file_replacements_old_file_id_new_file_id_key" ON "file_replacements"("old_file_id", "new_file_id");

-- CreateIndex
CREATE INDEX "file_replacements_new_file_id_idx" ON "file_replacements"("new_file_id");

-- CreateIndex
CREATE INDEX "case_items_client_id_status_idx" ON "case_items"("client_id", "status");

-- CreateIndex
CREATE INDEX "case_items_run_id_status_idx" ON "case_items"("run_id", "status");

-- CreateIndex
CREATE INDEX "case_items_raw_input_item_id_status_idx" ON "case_items"("raw_input_item_id", "status");

-- CreateIndex
CREATE INDEX "case_items_file_version_id_status_idx" ON "case_items"("file_version_id", "status");

-- AddForeignKey
ALTER TABLE "raw_input_items" ADD CONSTRAINT "raw_input_items_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_input_items" ADD CONSTRAINT "raw_input_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_input_items" ADD CONSTRAINT "raw_input_items_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_file_versions" ADD CONSTRAINT "uploaded_file_versions_raw_input_item_id_fkey" FOREIGN KEY ("raw_input_item_id") REFERENCES "raw_input_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_file_versions" ADD CONSTRAINT "uploaded_file_versions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_file_versions" ADD CONSTRAINT "uploaded_file_versions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_file_versions" ADD CONSTRAINT "uploaded_file_versions_replaces_file_id_fkey" FOREIGN KEY ("replaces_file_id") REFERENCES "uploaded_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_file_versions" ADD CONSTRAINT "uploaded_file_versions_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbook_parses" ADD CONSTRAINT "workbook_parses_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "uploaded_file_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbook_sheets" ADD CONSTRAINT "workbook_sheets_workbook_parse_id_fkey" FOREIGN KEY ("workbook_parse_id") REFERENCES "workbook_parses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbook_cells" ADD CONSTRAINT "workbook_cells_workbook_parse_id_fkey" FOREIGN KEY ("workbook_parse_id") REFERENCES "workbook_parses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workbook_cells" ADD CONSTRAINT "workbook_cells_sheet_id_fkey" FOREIGN KEY ("sheet_id") REFERENCES "workbook_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_replacements" ADD CONSTRAINT "file_replacements_old_file_id_fkey" FOREIGN KEY ("old_file_id") REFERENCES "uploaded_file_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_replacements" ADD CONSTRAINT "file_replacements_new_file_id_fkey" FOREIGN KEY ("new_file_id") REFERENCES "uploaded_file_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_replacements" ADD CONSTRAINT "file_replacements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_items" ADD CONSTRAINT "case_items_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_items" ADD CONSTRAINT "case_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_items" ADD CONSTRAINT "case_items_raw_input_item_id_fkey" FOREIGN KEY ("raw_input_item_id") REFERENCES "raw_input_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_items" ADD CONSTRAINT "case_items_file_version_id_fkey" FOREIGN KEY ("file_version_id") REFERENCES "uploaded_file_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_items" ADD CONSTRAINT "case_items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_items" ADD CONSTRAINT "case_items_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
