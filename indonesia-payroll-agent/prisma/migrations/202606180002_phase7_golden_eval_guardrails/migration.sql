-- CreateEnum
CREATE TYPE "eval_dataset_status" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "agent_output_review_decision" AS ENUM (
    'APPROVED',
    'REJECTED',
    'NEEDS_REVISION',
    'ESCALATED'
);

-- AlterEnum
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'AGENT_OUTPUT_REVIEW';

-- CreateTable
CREATE TABLE "eval_datasets" (
    "id" TEXT NOT NULL,
    "dataset_key" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" "eval_dataset_status" NOT NULL DEFAULT 'DRAFT',
    "display_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "required_for_release" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_datasets_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "eval_cases" ADD COLUMN "eval_dataset_id" TEXT;
ALTER TABLE "eval_cases" ADD COLUMN "case_version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "eval_runs" ADD COLUMN "eval_dataset_id" TEXT;
ALTER TABLE "eval_runs" ADD COLUMN "eval_dataset_version" INTEGER;
ALTER TABLE "eval_runs" ADD COLUMN "prompt_version_ref" TEXT;
ALTER TABLE "eval_runs" ADD COLUMN "model_version_ref" TEXT;
ALTER TABLE "eval_runs" ADD COLUMN "tool_schema_version_ref" TEXT;
ALTER TABLE "eval_runs" ADD COLUMN "retrieval_index_version_ref" TEXT;
ALTER TABLE "eval_runs" ADD COLUMN "guardrail_config_ref" TEXT;

-- CreateTable
CREATE TABLE "agent_output_reviews" (
    "id" TEXT NOT NULL,
    "agent_run_id" TEXT NOT NULL,
    "agent_step_id" TEXT,
    "eval_run_id" TEXT,
    "reviewer_id" TEXT,
    "decision" "agent_output_review_decision" NOT NULL,
    "risk_level" "audit_risk_level" NOT NULL DEFAULT 'R1',
    "review_summary" TEXT NOT NULL,
    "reviewed_output" JSONB NOT NULL DEFAULT '{}',
    "required_corrections" JSONB NOT NULL DEFAULT '{}',
    "effective_object_type" TEXT,
    "effective_object_id" TEXT,
    "effective_object_version_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_output_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "eval_datasets_dataset_key_version_number_key" ON "eval_datasets"("dataset_key", "version_number");

-- CreateIndex
CREATE INDEX "eval_datasets_status_required_for_release_idx" ON "eval_datasets"("status", "required_for_release");

-- CreateIndex
CREATE INDEX "eval_cases_eval_dataset_id_required_for_release_idx" ON "eval_cases"("eval_dataset_id", "required_for_release");

-- CreateIndex
CREATE INDEX "eval_runs_eval_dataset_id_eval_dataset_version_idx" ON "eval_runs"("eval_dataset_id", "eval_dataset_version");

-- CreateIndex
CREATE INDEX "agent_output_reviews_agent_run_id_created_at_idx" ON "agent_output_reviews"("agent_run_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_output_reviews_agent_step_id_created_at_idx" ON "agent_output_reviews"("agent_step_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_output_reviews_eval_run_id_decision_idx" ON "agent_output_reviews"("eval_run_id", "decision");

-- CreateIndex
CREATE INDEX "agent_output_reviews_effective_object_type_effective_object_id_idx" ON "agent_output_reviews"("effective_object_type", "effective_object_id");

-- CreateIndex
CREATE INDEX "agent_output_reviews_reviewer_id_created_at_idx" ON "agent_output_reviews"("reviewer_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_output_reviews_decision_risk_level_idx" ON "agent_output_reviews"("decision", "risk_level");

-- AddForeignKey
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_eval_dataset_id_fkey" FOREIGN KEY ("eval_dataset_id") REFERENCES "eval_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_eval_dataset_id_fkey" FOREIGN KEY ("eval_dataset_id") REFERENCES "eval_datasets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_output_reviews" ADD CONSTRAINT "agent_output_reviews_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_output_reviews" ADD CONSTRAINT "agent_output_reviews_agent_step_id_fkey" FOREIGN KEY ("agent_step_id") REFERENCES "agent_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_output_reviews" ADD CONSTRAINT "agent_output_reviews_eval_run_id_fkey" FOREIGN KEY ("eval_run_id") REFERENCES "eval_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_output_reviews" ADD CONSTRAINT "agent_output_reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
