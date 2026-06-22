-- CreateEnum
CREATE TYPE "precheck_run_status" AS ENUM ('PASSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "blocking_issue_status" AS ENUM ('OPEN', 'RESOLVED', 'WAIVED');

-- CreateEnum
CREATE TYPE "blocking_issue_source" AS ENUM ('PRECHECK', 'CALCULATION', 'MANUAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "payroll_result_status" AS ENUM ('FINAL', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "payroll_result_line_type" AS ENUM (
    'EARNING',
    'DEDUCTION',
    'TAX',
    'EMPLOYEE_CONTRIBUTION',
    'EMPLOYER_CONTRIBUTION',
    'TAX_ALLOWANCE',
    'THR',
    'MEMO'
);

-- CreateEnum
CREATE TYPE "customer_comparison_value_status" AS ENUM (
    'MATCH',
    'DIFF',
    'CUSTOMER_ONLY',
    'SYSTEM_ONLY'
);

-- AlterEnum
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'PRECHECK_RUN_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'BLOCKING_ISSUE_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'BLOCKING_ISSUE_RESOLVED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'PAYROLL_RESULT_CREATED';
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'CUSTOMER_COMPARISON_VALUE_RECORDED';

-- AlterEnum
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'PRECHECK_RUN';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'BLOCKING_ISSUE';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'PAYROLL_RESULT';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'PAYROLL_RESULT_LINE';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'CALCULATION_TRACE';
ALTER TYPE "audit_object_type" ADD VALUE IF NOT EXISTS 'CUSTOMER_COMPARISON_VALUE';

-- CreateTable
CREATE TABLE "precheck_runs" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "status" "precheck_run_status" NOT NULL,
    "gate_results" JSONB NOT NULL DEFAULT '[]',
    "issue_count" INTEGER NOT NULL DEFAULT 0,
    "run_by_id" TEXT,
    "passed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "precheck_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocking_issues" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "precheck_run_id" TEXT,
    "payroll_result_id" TEXT,
    "target_employee_id" TEXT,
    "source" "blocking_issue_source" NOT NULL DEFAULT 'PRECHECK',
    "issue_type" TEXT NOT NULL,
    "status" "blocking_issue_status" NOT NULL DEFAULT 'OPEN',
    "risk_level" "audit_risk_level" NOT NULL DEFAULT 'R2',
    "target_object_type" TEXT,
    "target_object_id" TEXT,
    "target_field" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "evidence_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "resolution_note" TEXT,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blocking_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_results" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "result_version_ref" TEXT NOT NULL,
    "status" "payroll_result_status" NOT NULL DEFAULT 'FINAL',
    "gross_pay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxable_income" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "pph21" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bpjs_health_employee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bpjs_employment_employee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bpjs_health_employer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "bpjs_employment_employer" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employer_cost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency_code" TEXT NOT NULL DEFAULT 'IDR',
    "source_version_snapshot" JSONB NOT NULL DEFAULT '{}',
    "calculated_by_id" TEXT,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_result_lines" (
    "id" TEXT NOT NULL,
    "result_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "line_type" "payroll_result_line_type" NOT NULL,
    "component_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'IDR',
    "taxable_cash" BOOLEAN NOT NULL DEFAULT false,
    "bpjs_health_base" BOOLEAN NOT NULL DEFAULT false,
    "bpjs_employment_base" BOOLEAN NOT NULL DEFAULT false,
    "paid_out" BOOLEAN NOT NULL DEFAULT true,
    "affects_net_pay" BOOLEAN NOT NULL DEFAULT true,
    "affects_employer_cost" BOOLEAN NOT NULL DEFAULT false,
    "source_input_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rule_version_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "trace_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_result_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calculation_traces" (
    "id" TEXT NOT NULL,
    "result_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "result_field" TEXT NOT NULL,
    "trace_type" TEXT NOT NULL,
    "input_refs" JSONB NOT NULL DEFAULT '[]',
    "rule_version_refs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "formula" TEXT NOT NULL,
    "parameters" JSONB NOT NULL DEFAULT '{}',
    "intermediate_values" JSONB NOT NULL DEFAULT '{}',
    "rounding" JSONB NOT NULL DEFAULT '{}',
    "output_value" DECIMAL(18,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calculation_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_comparison_values" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employee_id" TEXT,
    "source_input_id" TEXT,
    "target_field" TEXT NOT NULL,
    "customer_value" DECIMAL(18,2) NOT NULL,
    "system_value" DECIMAL(18,2),
    "delta" DECIMAL(18,2),
    "status" "customer_comparison_value_status" NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'IDR',
    "source_label" TEXT NOT NULL,
    "source_cell_id" TEXT,
    "result_version_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_comparison_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "precheck_runs_client_id_created_at_idx" ON "precheck_runs"("client_id", "created_at");
CREATE INDEX "precheck_runs_run_id_created_at_idx" ON "precheck_runs"("run_id", "created_at");
CREATE INDEX "precheck_runs_status_created_at_idx" ON "precheck_runs"("status", "created_at");
CREATE INDEX "blocking_issues_client_id_status_idx" ON "blocking_issues"("client_id", "status");
CREATE INDEX "blocking_issues_run_id_status_idx" ON "blocking_issues"("run_id", "status");
CREATE INDEX "blocking_issues_precheck_run_id_idx" ON "blocking_issues"("precheck_run_id");
CREATE INDEX "blocking_issues_target_employee_id_target_field_idx" ON "blocking_issues"("target_employee_id", "target_field");
CREATE INDEX "blocking_issues_issue_type_risk_level_idx" ON "blocking_issues"("issue_type", "risk_level");
CREATE UNIQUE INDEX "payroll_results_run_id_employee_id_result_version_ref_key" ON "payroll_results"("run_id", "employee_id", "result_version_ref");
CREATE INDEX "payroll_results_client_id_status_idx" ON "payroll_results"("client_id", "status");
CREATE INDEX "payroll_results_run_id_status_idx" ON "payroll_results"("run_id", "status");
CREATE INDEX "payroll_results_employee_id_calculated_at_idx" ON "payroll_results"("employee_id", "calculated_at");
CREATE INDEX "payroll_result_lines_result_id_line_type_idx" ON "payroll_result_lines"("result_id", "line_type");
CREATE INDEX "payroll_result_lines_run_id_employee_id_idx" ON "payroll_result_lines"("run_id", "employee_id");
CREATE INDEX "payroll_result_lines_component_code_idx" ON "payroll_result_lines"("component_code");
CREATE INDEX "calculation_traces_result_id_result_field_idx" ON "calculation_traces"("result_id", "result_field");
CREATE INDEX "calculation_traces_run_id_employee_id_idx" ON "calculation_traces"("run_id", "employee_id");
CREATE INDEX "calculation_traces_trace_type_idx" ON "calculation_traces"("trace_type");
CREATE INDEX "customer_comparison_values_client_id_status_idx" ON "customer_comparison_values"("client_id", "status");
CREATE INDEX "customer_comparison_values_run_id_status_idx" ON "customer_comparison_values"("run_id", "status");
CREATE INDEX "customer_comparison_values_employee_id_target_field_idx" ON "customer_comparison_values"("employee_id", "target_field");
CREATE INDEX "customer_comparison_values_source_input_id_idx" ON "customer_comparison_values"("source_input_id");

-- AddForeignKey
ALTER TABLE "precheck_runs" ADD CONSTRAINT "precheck_runs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "precheck_runs" ADD CONSTRAINT "precheck_runs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "precheck_runs" ADD CONSTRAINT "precheck_runs_run_by_id_fkey" FOREIGN KEY ("run_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "blocking_issues" ADD CONSTRAINT "blocking_issues_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "blocking_issues" ADD CONSTRAINT "blocking_issues_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "blocking_issues" ADD CONSTRAINT "blocking_issues_precheck_run_id_fkey" FOREIGN KEY ("precheck_run_id") REFERENCES "precheck_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "blocking_issues" ADD CONSTRAINT "blocking_issues_payroll_result_id_fkey" FOREIGN KEY ("payroll_result_id") REFERENCES "payroll_results"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "blocking_issues" ADD CONSTRAINT "blocking_issues_target_employee_id_fkey" FOREIGN KEY ("target_employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "blocking_issues" ADD CONSTRAINT "blocking_issues_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_results" ADD CONSTRAINT "payroll_results_calculated_by_id_fkey" FOREIGN KEY ("calculated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payroll_result_lines" ADD CONSTRAINT "payroll_result_lines_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "payroll_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_result_lines" ADD CONSTRAINT "payroll_result_lines_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_result_lines" ADD CONSTRAINT "payroll_result_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_result_lines" ADD CONSTRAINT "payroll_result_lines_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calculation_traces" ADD CONSTRAINT "calculation_traces_result_id_fkey" FOREIGN KEY ("result_id") REFERENCES "payroll_results"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calculation_traces" ADD CONSTRAINT "calculation_traces_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calculation_traces" ADD CONSTRAINT "calculation_traces_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "calculation_traces" ADD CONSTRAINT "calculation_traces_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_comparison_values" ADD CONSTRAINT "customer_comparison_values_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_comparison_values" ADD CONSTRAINT "customer_comparison_values_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_comparison_values" ADD CONSTRAINT "customer_comparison_values_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_comparison_values" ADD CONSTRAINT "customer_comparison_values_source_input_id_fkey" FOREIGN KEY ("source_input_id") REFERENCES "standardized_payroll_inputs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
