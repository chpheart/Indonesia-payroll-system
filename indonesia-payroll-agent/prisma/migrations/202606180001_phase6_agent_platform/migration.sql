-- CreateEnum
CREATE TYPE "agent_version_status" AS ENUM (
    'DRAFT',
    'INTERNAL_TEST',
    'RELEASED',
    'DEPRECATED',
    'REVOKED'
);

-- CreateEnum
CREATE TYPE "agent_run_status" AS ENUM (
    'PENDING',
    'RUNNING',
    'WAITING_FOR_APPROVAL',
    'SUCCEEDED',
    'FAILED',
    'CANCELLED'
);

-- CreateEnum
CREATE TYPE "agent_step_status" AS ENUM (
    'PENDING',
    'RUNNING',
    'WAITING_FOR_APPROVAL',
    'SUCCEEDED',
    'FAILED',
    'SKIPPED'
);

-- CreateEnum
CREATE TYPE "agent_node_type" AS ENUM (
    'INTAKE_CLASSIFICATION',
    'EXCEL_STRUCTURE',
    'CHANGE_EXTRACTION',
    'FIELD_MAPPING',
    'EMPLOYEE_MATCHING',
    'QUESTION_GENERATION',
    'EVIDENCE_LINKING',
    'PRECHECK_ADVICE',
    'CUSTOMER_CONFIRMATION_PACK',
    'RECONCILIATION_EXPLANATION',
    'CONFIRMATION_SUMMARY'
);

-- CreateEnum
CREATE TYPE "tool_invocation_status" AS ENUM (
    'PENDING',
    'PREVIEW',
    'WAITING_FOR_APPROVAL',
    'SUCCEEDED',
    'FAILED',
    'BLOCKED',
    'SKIPPED'
);

-- CreateEnum
CREATE TYPE "guardrail_severity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "guardrail_action" AS ENUM (
    'PASS',
    'FLAG',
    'BLOCK',
    'REDACT',
    'NEEDS_REVIEW'
);

-- CreateEnum
CREATE TYPE "eval_case_type" AS ENUM (
    'GOLDEN',
    'GUARDRAIL',
    'PERMISSION',
    'RAG_CITATION',
    'REGRESSION'
);

-- CreateEnum
CREATE TYPE "eval_run_status" AS ENUM (
    'PENDING',
    'PASSED',
    'FAILED',
    'BLOCKED'
);

-- CreateEnum
CREATE TYPE "eval_result_status" AS ENUM (
    'PASSED',
    'FAILED',
    'BLOCKED'
);

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'AGENT_RUN_CREATED';

-- AlterEnum
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'AGENT_RUN';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'AGENT_STEP';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'TOOL_INVOCATION';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'GUARDRAIL_RESULT';

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "prompt_key" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "agent_version_status" NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL DEFAULT '{}',
    "eval_binding_ref" TEXT,
    "guardrail_binding_ref" TEXT,
    "change_summary" TEXT NOT NULL,
    "created_by_id" TEXT,
    "released_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
    "revocation_impact_scope" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_versions" (
    "id" TEXT NOT NULL,
    "model_key" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "status" "agent_version_status" NOT NULL DEFAULT 'DRAFT',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "context_window" INTEGER,
    "eval_binding_ref" TEXT,
    "change_summary" TEXT NOT NULL,
    "created_by_id" TEXT,
    "released_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
    "revocation_impact_scope" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieval_index_versions" (
    "id" TEXT NOT NULL,
    "index_key" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "agent_version_status" NOT NULL DEFAULT 'DRAFT',
    "source_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "top_k_default" INTEGER NOT NULL DEFAULT 5,
    "redaction_policy" JSONB NOT NULL DEFAULT '{}',
    "eval_binding_ref" TEXT,
    "change_summary" TEXT NOT NULL,
    "created_by_id" TEXT,
    "released_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
    "revocation_impact_scope" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retrieval_index_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_schema_versions" (
    "id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "schema_version" TEXT NOT NULL,
    "status" "agent_version_status" NOT NULL DEFAULT 'DRAFT',
    "input_schema" JSONB NOT NULL DEFAULT '{}',
    "output_schema" JSONB NOT NULL DEFAULT '{}',
    "error_codes" JSONB NOT NULL DEFAULT '[]',
    "permission_level" TEXT NOT NULL,
    "risk_level" "audit_risk_level" NOT NULL,
    "action_scope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approval_policy" JSONB NOT NULL DEFAULT '{}',
    "idempotency_required" BOOLEAN NOT NULL DEFAULT true,
    "timeout_ms" INTEGER NOT NULL,
    "retry_policy" JSONB NOT NULL DEFAULT '{}',
    "formal_run_allowed" BOOLEAN NOT NULL DEFAULT false,
    "eval_binding_ref" TEXT,
    "guardrail_binding_ref" TEXT,
    "trace_field_policy" JSONB NOT NULL DEFAULT '{}',
    "change_summary" TEXT NOT NULL,
    "created_by_id" TEXT,
    "released_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revocation_reason" TEXT,
    "revocation_impact_scope" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_schema_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_cases" (
    "id" TEXT NOT NULL,
    "eval_binding_ref" TEXT NOT NULL,
    "case_key" TEXT NOT NULL,
    "case_type" "eval_case_type" NOT NULL,
    "risk_level" "audit_risk_level" NOT NULL DEFAULT 'R1',
    "required_for_release" BOOLEAN NOT NULL DEFAULT true,
    "input_fixture" JSONB NOT NULL DEFAULT '{}',
    "expected_output" JSONB NOT NULL DEFAULT '{}',
    "source_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "eval_binding_ref" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_ref" TEXT NOT NULL,
    "status" "eval_run_status" NOT NULL DEFAULT 'PENDING',
    "total_case_count" INTEGER NOT NULL DEFAULT 0,
    "passed_case_count" INTEGER NOT NULL DEFAULT 0,
    "failed_case_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_case_count" INTEGER NOT NULL DEFAULT 0,
    "result_summary" JSONB NOT NULL DEFAULT '{}',
    "run_by_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eval_run_results" (
    "id" TEXT NOT NULL,
    "eval_run_id" TEXT NOT NULL,
    "eval_case_id" TEXT NOT NULL,
    "status" "eval_result_status" NOT NULL,
    "observed_output" JSONB NOT NULL DEFAULT '{}',
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eval_run_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "triggered_by_id" TEXT,
    "trigger_source" TEXT NOT NULL,
    "node_type" "agent_node_type",
    "status" "agent_run_status" NOT NULL DEFAULT 'PENDING',
    "prompt_version_id" TEXT NOT NULL,
    "model_version_id" TEXT NOT NULL,
    "retrieval_index_version_id" TEXT,
    "tool_schema_version_id" TEXT,
    "memory_snapshot_ref" TEXT,
    "input_summary" JSONB NOT NULL DEFAULT '{}',
    "output_summary" JSONB NOT NULL DEFAULT '{}',
    "human_review_status" TEXT NOT NULL DEFAULT 'NOT_REVIEWED',
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "cost_estimate_usd" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "node_type" "agent_node_type" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "agent_step_status" NOT NULL DEFAULT 'PENDING',
    "input_summary" JSONB NOT NULL DEFAULT '{}',
    "output_summary" JSONB NOT NULL DEFAULT '{}',
    "cited_source_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "confidence" TEXT,
    "risk_level" "audit_risk_level" NOT NULL DEFAULT 'R1',
    "guardrail_summary" JSONB NOT NULL DEFAULT '{}',
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "cost_estimate_usd" DECIMAL(18,6) NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_invocations" (
    "id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "agent_step_id" TEXT,
    "schema_version_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "tool_version" TEXT NOT NULL,
    "status" "tool_invocation_status" NOT NULL DEFAULT 'PENDING',
    "permission_level" TEXT NOT NULL,
    "risk_level" "audit_risk_level" NOT NULL DEFAULT 'R1',
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "approval_status" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "idempotency_key" TEXT,
    "parameter_summary" JSONB NOT NULL DEFAULT '{}',
    "output_summary" JSONB NOT NULL DEFAULT '{}',
    "error_code" TEXT,
    "error_message" TEXT,
    "timeout_ms" INTEGER NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "formal_run_allowed" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardrail_results" (
    "id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "agent_step_id" TEXT,
    "tool_invocation_id" TEXT,
    "guardrail_name" TEXT NOT NULL,
    "guardrail_type" TEXT NOT NULL,
    "severity" "guardrail_severity" NOT NULL,
    "action" "guardrail_action" NOT NULL,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "result_summary" JSONB NOT NULL DEFAULT '{}',
    "redaction_applied" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardrail_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_prompt_key_version_number_key" ON "prompt_versions"("prompt_key", "version_number");

-- CreateIndex
CREATE INDEX "prompt_versions_status_created_at_idx" ON "prompt_versions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "model_versions_model_key_version_number_key" ON "model_versions"("model_key", "version_number");

-- CreateIndex
CREATE INDEX "model_versions_status_created_at_idx" ON "model_versions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "retrieval_index_versions_index_key_version_number_key" ON "retrieval_index_versions"("index_key", "version_number");

-- CreateIndex
CREATE INDEX "retrieval_index_versions_status_created_at_idx" ON "retrieval_index_versions"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tool_schema_versions_tool_name_schema_version_key" ON "tool_schema_versions"("tool_name", "schema_version");

-- CreateIndex
CREATE INDEX "tool_schema_versions_status_formal_run_allowed_idx" ON "tool_schema_versions"("status", "formal_run_allowed");

-- CreateIndex
CREATE INDEX "tool_schema_versions_risk_level_requires_approval_idx" ON "tool_schema_versions"("risk_level", "requires_approval");

-- CreateIndex
CREATE UNIQUE INDEX "eval_cases_eval_binding_ref_case_key_key" ON "eval_cases"("eval_binding_ref", "case_key");

-- CreateIndex
CREATE INDEX "eval_cases_eval_binding_ref_required_for_release_idx" ON "eval_cases"("eval_binding_ref", "required_for_release");

-- CreateIndex
CREATE INDEX "eval_cases_case_type_risk_level_idx" ON "eval_cases"("case_type", "risk_level");

-- CreateIndex
CREATE INDEX "eval_runs_eval_binding_ref_target_ref_status_idx" ON "eval_runs"("eval_binding_ref", "target_ref", "status");

-- CreateIndex
CREATE INDEX "eval_runs_target_type_target_ref_created_at_idx" ON "eval_runs"("target_type", "target_ref", "created_at");

-- CreateIndex
CREATE INDEX "eval_runs_status_created_at_idx" ON "eval_runs"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "eval_run_results_eval_run_id_eval_case_id_key" ON "eval_run_results"("eval_run_id", "eval_case_id");

-- CreateIndex
CREATE INDEX "eval_run_results_eval_case_id_status_idx" ON "eval_run_results"("eval_case_id", "status");

-- CreateIndex
CREATE INDEX "eval_run_results_status_created_at_idx" ON "eval_run_results"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_run_id_created_at_idx" ON "agent_runs"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_client_id_created_at_idx" ON "agent_runs"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_status_created_at_idx" ON "agent_runs"("status", "created_at");

-- CreateIndex
CREATE INDEX "agent_runs_node_type_status_idx" ON "agent_runs"("node_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_steps_agent_run_id_sequence_key" ON "agent_steps"("agent_run_id", "sequence");

-- CreateIndex
CREATE INDEX "agent_steps_agent_run_id_node_type_idx" ON "agent_steps"("agent_run_id", "node_type");

-- CreateIndex
CREATE INDEX "agent_steps_status_created_at_idx" ON "agent_steps"("status", "created_at");

-- CreateIndex
CREATE INDEX "tool_invocations_agent_run_id_created_at_idx" ON "tool_invocations"("agent_run_id", "created_at");

-- CreateIndex
CREATE INDEX "tool_invocations_agent_step_id_created_at_idx" ON "tool_invocations"("agent_step_id", "created_at");

-- CreateIndex
CREATE INDEX "tool_invocations_tool_name_tool_version_idx" ON "tool_invocations"("tool_name", "tool_version");

-- CreateIndex
CREATE INDEX "tool_invocations_status_created_at_idx" ON "tool_invocations"("status", "created_at");

-- CreateIndex
CREATE INDEX "guardrail_results_agent_run_id_created_at_idx" ON "guardrail_results"("agent_run_id", "created_at");

-- CreateIndex
CREATE INDEX "guardrail_results_agent_step_id_created_at_idx" ON "guardrail_results"("agent_step_id", "created_at");

-- CreateIndex
CREATE INDEX "guardrail_results_tool_invocation_id_created_at_idx" ON "guardrail_results"("tool_invocation_id", "created_at");

-- CreateIndex
CREATE INDEX "guardrail_results_guardrail_name_triggered_idx" ON "guardrail_results"("guardrail_name", "triggered");

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_index_versions" ADD CONSTRAINT "retrieval_index_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_schema_versions" ADD CONSTRAINT "tool_schema_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_run_by_id_fkey" FOREIGN KEY ("run_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_run_results" ADD CONSTRAINT "eval_run_results_eval_run_id_fkey" FOREIGN KEY ("eval_run_id") REFERENCES "eval_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_run_results" ADD CONSTRAINT "eval_run_results_eval_case_id_fkey" FOREIGN KEY ("eval_case_id") REFERENCES "eval_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_retrieval_index_version_id_fkey" FOREIGN KEY ("retrieval_index_version_id") REFERENCES "retrieval_index_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tool_schema_version_id_fkey" FOREIGN KEY ("tool_schema_version_id") REFERENCES "tool_schema_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_schema_version_id_fkey" FOREIGN KEY ("schema_version_id") REFERENCES "tool_schema_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_results" ADD CONSTRAINT "guardrail_results_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_results" ADD CONSTRAINT "guardrail_results_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardrail_results" ADD CONSTRAINT "guardrail_results_tool_invocation_id_fkey" FOREIGN KEY ("tool_invocation_id") REFERENCES "tool_invocations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
