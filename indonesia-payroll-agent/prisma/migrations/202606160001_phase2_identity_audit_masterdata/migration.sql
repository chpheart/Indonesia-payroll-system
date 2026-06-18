-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "role_code" AS ENUM ('DELIVERY_SPECIALIST', 'PAYROLL_SPECIALIST', 'PAYROLL_LEAD', 'RULE_ADMIN', 'SYSTEM_ADMIN');

-- CreateEnum
CREATE TYPE "client_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "client_access_status" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "config_version_status" AS ENUM ('DRAFT', 'EFFECTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "employee_status" AS ENUM ('ACTIVE', 'TERMINATED', 'DISABLED');

-- CreateEnum
CREATE TYPE "employee_master_version_status" AS ENUM ('DRAFT', 'EFFECTIVE', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('CLIENT_CREATED', 'CLIENT_ENABLED', 'CLIENT_DISABLED', 'CLIENT_DELETE_REJECTED', 'CLIENT_ACCESS_GRANTED', 'CLIENT_ACCESS_REVOKED', 'CLIENT_CONFIG_VERSION_CREATED', 'EMPLOYEE_CREATED', 'EMPLOYEE_DISABLED', 'EMPLOYEE_STATUS_UPDATED', 'EMPLOYEE_DELETE_REJECTED', 'EMPLOYEE_MASTER_VERSION_CREATED', 'SENSITIVE_FIELD_REVEALED', 'SENSITIVE_FIELD_COPIED', 'EXPORT_CREATED', 'PAYROLL_RUN_LOCKED', 'HIGH_RISK_RELEASED', 'RULE_VERSION_PUBLISHED', 'CORRECTION_RUN_CREATED');

-- CreateEnum
CREATE TYPE "audit_object_type" AS ENUM ('USER', 'CLIENT', 'CLIENT_CONFIG_VERSION', 'EMPLOYEE', 'EMPLOYEE_MASTER_VERSION', 'PAYROLL_RUN', 'EXPORT_FILE', 'RULE_VERSION', 'CORRECTION_RUN', 'SENSITIVE_FIELD');

-- CreateEnum
CREATE TYPE "audit_risk_level" AS ENUM ('R0', 'R1', 'R2', 'R3', 'R4');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" "role_code" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_entity_name" TEXT,
    "status" "client_status" NOT NULL DEFAULT 'ACTIVE',
    "has_historical_payroll" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_accesses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "role_id" TEXT,
    "status" "client_access_status" NOT NULL DEFAULT 'ACTIVE',
    "granted_by_id" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "client_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" "audit_action" NOT NULL,
    "object_type" "audit_object_type" NOT NULL,
    "object_id" TEXT NOT NULL,
    "risk_level" "audit_risk_level" NOT NULL,
    "actor_user_id" TEXT,
    "actor_email" TEXT NOT NULL,
    "actor_role_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "client_id" TEXT,
    "run_id" TEXT,
    "purpose" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_corrections" (
    "id" TEXT NOT NULL,
    "audit_log_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_config_versions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "effective_month" TEXT NOT NULL,
    "payroll_day" INTEGER,
    "template_code" TEXT,
    "gross_up_default" BOOLEAN NOT NULL DEFAULT false,
    "bpjs_config" JSONB NOT NULL DEFAULT '{}',
    "rule_config" JSONB NOT NULL DEFAULT '{}',
    "evidence_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "change_reason" TEXT NOT NULL,
    "status" "config_version_status" NOT NULL DEFAULT 'DRAFT',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "client_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "employee_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "status" "employee_status" NOT NULL DEFAULT 'ACTIVE',
    "work_city" TEXT,
    "nik_or_passport" TEXT,
    "npwp" TEXT,
    "bpjs_health_number" TEXT,
    "bpjs_employment_number" TEXT,
    "bank_name" TEXT,
    "bank_account_number" TEXT,
    "has_historical_payroll" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_master_versions" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "effective_month" TEXT NOT NULL,
    "status" "employee_master_version_status" NOT NULL DEFAULT 'DRAFT',
    "changed_fields" JSONB NOT NULL DEFAULT '{}',
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "evidence_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "change_reason" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "employee_master_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE INDEX "user_roles_role_id_idx" ON "user_roles"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_user_id_role_id_key" ON "user_roles"("user_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "clients_code_key" ON "clients"("code");

-- CreateIndex
CREATE INDEX "client_accesses_client_id_idx" ON "client_accesses"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_accesses_user_id_client_id_role_id_key" ON "client_accesses"("user_id", "client_id", "role_id");

-- CreateIndex
CREATE INDEX "audit_logs_client_id_created_at_idx" ON "audit_logs"("client_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_run_id_created_at_idx" ON "audit_logs"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_corrections_audit_log_id_created_at_idx" ON "audit_corrections"("audit_log_id", "created_at");

-- CreateIndex
CREATE INDEX "client_config_versions_client_id_status_idx" ON "client_config_versions"("client_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "client_config_versions_client_id_version_number_key" ON "client_config_versions"("client_id", "version_number");

-- CreateIndex
CREATE INDEX "employees_client_id_status_idx" ON "employees"("client_id", "status");

-- CreateIndex
CREATE INDEX "employees_client_id_full_name_idx" ON "employees"("client_id", "full_name");

-- CreateIndex
CREATE UNIQUE INDEX "employees_client_id_employee_code_key" ON "employees"("client_id", "employee_code");

-- CreateIndex
CREATE INDEX "employee_master_versions_employee_id_status_idx" ON "employee_master_versions"("employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employee_master_versions_employee_id_version_number_key" ON "employee_master_versions"("employee_id", "version_number");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accesses" ADD CONSTRAINT "client_accesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accesses" ADD CONSTRAINT "client_accesses_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accesses" ADD CONSTRAINT "client_accesses_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_accesses" ADD CONSTRAINT "client_accesses_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_corrections" ADD CONSTRAINT "audit_corrections_audit_log_id_fkey" FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_corrections" ADD CONSTRAINT "audit_corrections_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_config_versions" ADD CONSTRAINT "client_config_versions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_config_versions" ADD CONSTRAINT "client_config_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_master_versions" ADD CONSTRAINT "employee_master_versions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_master_versions" ADD CONSTRAINT "employee_master_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
