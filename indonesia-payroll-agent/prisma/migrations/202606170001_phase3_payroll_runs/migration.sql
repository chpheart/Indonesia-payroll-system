-- CreateEnum
CREATE TYPE "payroll_run_status" AS ENUM (
    'DRAFT',
    'PENDING_MAPPING_CONFIRMATION',
    'PENDING_STANDARDIZATION_CONFIRMATION',
    'PENDING_CUSTOMER_CONFIRMATION',
    'PENDING_PRECHECK',
    'PENDING_CALCULATION',
    'PENDING_PAYROLL_CONFIRMATION',
    'PENDING_HIGH_RISK_RELEASE',
    'LOCKED',
    'EXPORTED',
    'ARCHIVED',
    'VOIDED',
    'CORRECTED'
);

-- CreateEnum
CREATE TYPE "run_assignment_role" AS ENUM (
    'DELIVERY_OWNER',
    'PAYROLL_OWNER',
    'APPROVAL_OWNER'
);

-- CreateEnum
CREATE TYPE "run_reminder_type" AS ENUM (
    'INTAKE_ASSIGNMENT',
    'PROPOSAL_REVIEW',
    'BLOCKING_ISSUE',
    'HIGH_RISK_REVIEW',
    'CUSTOMER_CONFIRMATION',
    'OVERDUE',
    'STAGE_ACTION'
);

-- CreateEnum
CREATE TYPE "run_reminder_status" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "run_change_source_type" AS ENUM (
    'RAW_INPUT',
    'FILE',
    'FIELD_MAPPING',
    'STANDARDIZED_INPUT',
    'EMPLOYEE_MASTER',
    'CLIENT_CONFIG',
    'CUSTOMER_RULE',
    'PUBLIC_RULE',
    'FX_RATE',
    'CUSTOMER_CONFIRMATION_PACK',
    'PAYROLL_RESULT',
    'MANUAL_STAGE_ROLLBACK'
);

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'PAYROLL_RUN_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'PAYROLL_RUN_STATUS_CHANGED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'PAYROLL_RUN_REOPENED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'RUN_ASSIGNMENT_CHANGED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'RUN_REMINDER_COMPLETED';

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "payroll_month" TEXT NOT NULL,
    "status" "payroll_run_status" NOT NULL DEFAULT 'DRAFT',
    "status_reason" TEXT,
    "target_completion_date" TIMESTAMP(3),
    "pay_date" TIMESTAMP(3),
    "pending_intake_assignment_count" INTEGER NOT NULL DEFAULT 0,
    "pending_proposal_review_count" INTEGER NOT NULL DEFAULT 0,
    "blocking_issue_count" INTEGER NOT NULL DEFAULT 0,
    "high_risk_issue_count" INTEGER NOT NULL DEFAULT 0,
    "pending_customer_confirmation_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "locked_at" TIMESTAMP(3),
    "exported_at" TIMESTAMP(3),
    "archived_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "corrected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_status_events" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "from_status" "payroll_run_status",
    "to_status" "payroll_run_status" NOT NULL,
    "source_type" "run_change_source_type" NOT NULL,
    "reason" TEXT NOT NULL,
    "impacted_object_type" TEXT,
    "impacted_object_id" TEXT,
    "triggered_by_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_status_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_assignments" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "role" "run_assignment_role" NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_by_id" TEXT,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "run_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_reminders" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "type" "run_reminder_type" NOT NULL,
    "status" "run_reminder_status" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "due_at" TIMESTAMP(3),
    "completed_by_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_client_id_payroll_month_key" ON "payroll_runs"("client_id", "payroll_month");

-- CreateIndex
CREATE INDEX "payroll_runs_status_target_completion_date_idx" ON "payroll_runs"("status", "target_completion_date");

-- CreateIndex
CREATE INDEX "payroll_runs_client_id_status_idx" ON "payroll_runs"("client_id", "status");

-- CreateIndex
CREATE INDEX "run_status_events_run_id_created_at_idx" ON "run_status_events"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "run_status_events_source_type_created_at_idx" ON "run_status_events"("source_type", "created_at");

-- CreateIndex
CREATE INDEX "run_assignments_user_id_assigned_at_idx" ON "run_assignments"("user_id", "assigned_at");

-- CreateIndex
CREATE UNIQUE INDEX "run_assignments_run_id_role_user_id_key" ON "run_assignments"("run_id", "role", "user_id");

-- CreateIndex
CREATE INDEX "run_reminders_status_due_at_idx" ON "run_reminders"("status", "due_at");

-- CreateIndex
CREATE INDEX "run_reminders_run_id_status_idx" ON "run_reminders"("run_id", "status");

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_status_events" ADD CONSTRAINT "run_status_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_status_events" ADD CONSTRAINT "run_status_events_triggered_by_id_fkey" FOREIGN KEY ("triggered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_assignments" ADD CONSTRAINT "run_assignments_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_assignments" ADD CONSTRAINT "run_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_assignments" ADD CONSTRAINT "run_assignments_assigned_by_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_reminders" ADD CONSTRAINT "run_reminders_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_reminders" ADD CONSTRAINT "run_reminders_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
