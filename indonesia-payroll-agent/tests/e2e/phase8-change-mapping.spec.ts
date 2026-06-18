import { expect, test } from "@playwright/test";
import "dotenv/config";
import { Pool } from "pg";

const USER_ID = "e2e-phase8-user";
const CLIENT_ID = "e2e-phase8-client";
const RUN_ID = "e2e-phase8-run";
const RAW_ID = "e2e-phase8-raw";
const EMPLOYEE_ID = "e2e-phase8-employee";
const PROPOSAL_ID = "e2e-phase8-proposal";
const LEDGER_PROPOSAL_ID = "e2e-phase8-approved-proposal";
const LEDGER_ID = "e2e-phase8-ledger";
const MAPPING_CANDIDATE_ID = "e2e-phase8-mapping-candidate";
const MAPPING_VERSION_ID = "e2e-phase8-mapping-version";
const MATCH_ID = "e2e-phase8-match";
const INPUT_ID = "e2e-phase8-standardized-input";
const DEFAULT_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5433/indonesia_payroll_agent?schema=public";

let seeded = false;
let seedError = "";
let pool: Pool | null = null;

function requirePool() {
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL });
  }
  return pool;
}

async function cleanupPhase8E2eData() {
  const db = requirePool();
  await db.query("DELETE FROM standardized_payroll_inputs WHERE id = $1 OR run_id = $2", [INPUT_ID, RUN_ID]);
  await db.query("DELETE FROM employee_match_candidates WHERE id = $1 OR run_id = $2", [MATCH_ID, RUN_ID]);
  await db.query("DELETE FROM field_mapping_versions WHERE id = $1 OR run_id = $2", [MAPPING_VERSION_ID, RUN_ID]);
  await db.query("DELETE FROM field_mapping_candidates WHERE id = $1 OR run_id = $2", [MAPPING_CANDIDATE_ID, RUN_ID]);
  await db.query("DELETE FROM change_ledger_entries WHERE id = $1 OR run_id = $2", [LEDGER_ID, RUN_ID]);
  await db.query("DELETE FROM change_proposals WHERE id = ANY($1::text[]) OR run_id = $2", [
    [PROPOSAL_ID, LEDGER_PROPOSAL_ID],
    RUN_ID,
  ]);
  await db.query("DELETE FROM case_items WHERE raw_input_item_id = $1 OR run_id = $2", [RAW_ID, RUN_ID]);
  await db.query("DELETE FROM raw_input_items WHERE id = $1 OR run_id = $2", [RAW_ID, RUN_ID]);
  await db.query("DELETE FROM audit_logs WHERE client_id = $1 OR run_id = $2 OR actor_user_id = $3", [
    CLIENT_ID,
    RUN_ID,
    USER_ID,
  ]);
  await db.query("DELETE FROM run_status_events WHERE run_id = $1", [RUN_ID]);
  await db.query("DELETE FROM payroll_runs WHERE id = $1", [RUN_ID]);
  await db.query("DELETE FROM employees WHERE id = $1", [EMPLOYEE_ID]);
  await db.query("DELETE FROM client_accesses WHERE user_id = $1 OR client_id = $2", [USER_ID, CLIENT_ID]);
  await db.query("DELETE FROM user_roles WHERE user_id = $1", [USER_ID]);
  await db.query("DELETE FROM users WHERE id = $1", [USER_ID]);
  await db.query("DELETE FROM clients WHERE id = $1 OR code = 'E2E8'", [CLIENT_ID]);
}

async function seedPhase8E2eData() {
  const db = requirePool();
  await db.query(
    `INSERT INTO roles (id, code, name, description)
     VALUES ('e2e-phase8-role', 'DELIVERY_SPECIALIST'::role_code, 'Delivery Specialist', 'E2E role')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
  );
  const role = await db.query<{ id: string }>("SELECT id FROM roles WHERE code = 'DELIVERY_SPECIALIST'::role_code");
  await db.query(
    "INSERT INTO clients (id, code, name, status, updated_at) VALUES ($1, 'E2E8', 'Phase 8 Client', 'ACTIVE'::client_status, now())",
    [CLIENT_ID],
  );
  await db.query(
    "INSERT INTO users (id, email, display_name, status, updated_at) VALUES ($1, 'phase8@example.local', 'Phase 8 E2E', 'ACTIVE'::user_status, now())",
    [USER_ID],
  );
  await db.query("INSERT INTO user_roles (id, user_id, role_id) VALUES ('e2e-phase8-user-role', $1, $2)", [
    USER_ID,
    role.rows[0].id,
  ]);
  await db.query(
    "INSERT INTO client_accesses (id, user_id, client_id, role_id, status) VALUES ('e2e-phase8-access', $1, $2, $3, 'ACTIVE'::client_access_status)",
    [USER_ID, CLIENT_ID, role.rows[0].id],
  );
  await db.query(
    "INSERT INTO employees (id, client_id, employee_code, full_name, status, updated_at) VALUES ($1, $2, 'E8-001', 'Ayu Sanfu', 'ACTIVE'::employee_status, now())",
    [EMPLOYEE_ID, CLIENT_ID],
  );
  await db.query(
    "INSERT INTO payroll_runs (id, client_id, payroll_month, status, created_by_id, updated_at) VALUES ($1, $2, '2036-08', 'PENDING_MAPPING_CONFIRMATION'::payroll_run_status, $3, now())",
    [RUN_ID, CLIENT_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO raw_input_items
     (id, client_id, payroll_month, run_id, source_channel, input_type, status, redacted_summary, evidence_candidate_refs, created_by_id, updated_at)
     VALUES ($1, $2, '2036-08', $3, 'WECHAT_TEXT'::raw_input_source_channel, 'TEXT'::raw_input_type,
     'PROPOSAL_GENERATED'::raw_input_status, '客户确认 Ayu 本月调薪', ARRAY['raw-input:e2e-phase8-raw'], $4, now())`,
    [RAW_ID, CLIENT_ID, RUN_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO change_proposals
     (id, client_id, run_id, raw_input_item_id, created_by_id, source, proposal_type, target_object_type,
      target_employee_id, target_field, previous_value, proposed_value, effective_from, risk_level, confidence,
      reason, evidence_refs, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'AI_EXTRACTION'::change_proposal_source, 'SALARY_ADJUSTMENT'::change_proposal_type,
      'EmployeeMasterVersion', $6, 'salaryAmount', '{"amount":10000000}', '{"amount":12000000}', '2036-08',
      'R3'::audit_risk_level, 'HIGH'::confidence_band, '客户确认调薪', ARRAY['raw-input:e2e-phase8-raw'], now())`,
    [PROPOSAL_ID, CLIENT_ID, RUN_ID, RAW_ID, USER_ID, EMPLOYEE_ID],
  );
  await db.query(
    `INSERT INTO change_proposals
     (id, client_id, run_id, raw_input_item_id, created_by_id, reviewed_by_id, source, proposal_type,
      status, target_object_type, target_employee_id, target_field, previous_value, proposed_value, effective_from,
      risk_level, confidence, reason, evidence_refs, review_note, reviewed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5, 'MANUAL_FROM_INTAKE'::change_proposal_source, 'BONUS_DEDUCTION'::change_proposal_type,
      'APPROVED'::change_proposal_status, 'StandardizedPayrollInput', $6, 'bonusAmount', '{}', '{"amount":500000}', '2036-08',
      'R2'::audit_risk_level, 'HIGH'::confidence_band, '人工确认 bonus', ARRAY['evidence:bonus'], '确认入账', now(), now())`,
    [LEDGER_PROPOSAL_ID, CLIENT_ID, RUN_ID, RAW_ID, USER_ID, EMPLOYEE_ID],
  );
  await db.query(
    `INSERT INTO change_ledger_entries
     (id, proposal_id, client_id, run_id, reviewed_by_id, target_employee_id, entry_type, target_object_type,
      target_field, previous_value, new_value, effective_from, risk_level, evidence_refs)
     VALUES ($1, $2, $3, $4, $5, $6, 'BONUS_DEDUCTION'::change_proposal_type, 'StandardizedPayrollInput',
      'bonusAmount', '{}', '{"amount":500000}', '2036-08', 'R2'::audit_risk_level, ARRAY['evidence:bonus'])`,
    [LEDGER_ID, LEDGER_PROPOSAL_ID, CLIENT_ID, RUN_ID, USER_ID, EMPLOYEE_ID],
  );
  await db.query(
    `INSERT INTO field_mapping_candidates
     (id, client_id, run_id, source, source_sheet_name, source_column_label, sample_values,
      target_field, confidence, rationale, updated_at)
     VALUES ($1, $2, $3, 'AGENT'::field_mapping_source, '门店工资', 'BPJS', '["123"]',
      'bpjsHealthNumber', 'LOW'::confidence_band, '表头疑似 BPJS，需人工确认', now())`,
    [MAPPING_CANDIDATE_ID, CLIENT_ID, RUN_ID],
  );
	  await db.query(
	    `INSERT INTO field_mapping_versions
	     (id, client_id, run_id, version_number, source, source_sheet_name, source_column_label,
	      target_field, confidence, rationale, confirmed_by_id, updated_at)
	     VALUES ($1, $2, $3, 1, 'MANUAL'::field_mapping_source, '门店工资', 'Gross',
	      'grossSalaryAmount', 'HIGH'::confidence_band, '人工确认 gross salary', $4, now())`,
	    [MAPPING_VERSION_ID, CLIENT_ID, RUN_ID, USER_ID],
	  );
  await db.query(
    `INSERT INTO employee_match_candidates
     (id, client_id, run_id, employee_id, full_name_raw, match_method, confidence, status, reason, updated_at)
     VALUES ($1, $2, $3, $4, 'Ayu Sanfu', 'NAME_ONLY'::employee_match_method, 'LOW'::confidence_band,
      'CONFIRMED'::employee_match_status, '人工确认姓名单独匹配', now())`,
    [MATCH_ID, CLIENT_ID, RUN_ID, EMPLOYEE_ID],
  );
  await db.query(
    `INSERT INTO standardized_payroll_inputs
     (id, client_id, run_id, field_mapping_version_id, employee_id, employee_match_candidate_id,
      standard_field, amount, currency_code, value, source_sheet_name, source_row_index, store_code,
      evidence_status, evidence_refs, validation_issues, modified_by_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'grossSalaryAmount', 12000000, 'IDR', '{"amount":12000000}',
      '门店工资', 2, 'JKT-01', 'VALID'::evidence_status, ARRAY['evidence:gross'], '[]', $7, now())`,
    [INPUT_ID, CLIENT_ID, RUN_ID, MAPPING_VERSION_ID, EMPLOYEE_ID, MATCH_ID, USER_ID],
  );
}

test.beforeAll(async () => {
  try {
    await cleanupPhase8E2eData();
    await seedPhase8E2eData();
    seeded = true;
  } catch (error) {
    seedError = error instanceof Error ? error.message : String(error);
  }
});

test.afterAll(async () => {
  if (seeded) {
    await cleanupPhase8E2eData();
  }
  await pool?.end();
});

test.use({ viewport: { width: 1440, height: 900 } });

test("shows Phase 8 change and mapping workbenches at desktop width", async ({ page }) => {
  test.skip(!seeded, `database seed unavailable: ${seedError}`);

	  await page.setExtraHTTPHeaders({ "x-user-id": USER_ID });
	  await page.goto(`/payroll-runs/${RUN_ID}/changes`);
	  await expect(page.getByRole("heading", { name: "变更 Proposal Review" })).toBeVisible();
	  await expect(page.getByText("ChangeProposal 候选队列")).toBeVisible();
	  await expect(page.getByText("ChangeLedgerEntry 正式账本")).toBeVisible();
	  await expect(page.getByText("客户确认 Ayu 本月调薪").first()).toBeVisible();
	  await expect(page.getByText("权限：payrollRun.update 已授权").first()).toBeVisible();
	  await expect(page.getByText("客户确认：当前无缺口").first()).toBeVisible();
	  await page.getByPlaceholder("采纳理由").fill("e2e approval");
	  await page.getByRole("button", { name: "采纳入账" }).click();
	  await expect(page.getByText("已采纳").first()).toBeVisible();

	  await page.goto(`/payroll-runs/${RUN_ID}/mappings`);
	  await expect(page.getByRole("heading", { name: "字段映射与标准化确认" })).toBeVisible();
	  await expect(page.getByText("字段映射候选")).toBeVisible();
	  await expect(page.getByText("FieldMappingVersion")).toBeVisible();
	  await expect(page.getByText("标准化数据预览")).toBeVisible();
	  await expect(page.getByText("BPJS", { exact: true }).first()).toBeVisible();
	  await expect(page.getByText("grossSalaryAmount").first()).toBeVisible();

	  await page.getByRole("button", { name: "确认映射版本" }).click();
	  await expect(page.getByText("CONFIRMED").first()).toBeVisible();

	  await page.getByRole("button", { name: "确认标准化数据" }).click();
	  await expect(page.getByText("CONFIRMED").last()).toBeVisible();
	});
