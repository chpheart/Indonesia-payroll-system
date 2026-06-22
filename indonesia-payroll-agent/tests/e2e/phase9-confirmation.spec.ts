import { expect, test } from "@playwright/test";
import "dotenv/config";
import { Pool } from "pg";

const USER_ID = "e2e-phase9-user";
const CLIENT_ID = "e2e-phase9-client";
const RUN_ID = "e2e-phase9-run";
const EMPLOYEE_ID = "e2e-phase9-employee";
const RAW_ID = "e2e-phase9-raw";
const PROPOSAL_ID = "e2e-phase9-proposal";
const LEDGER_ID = "e2e-phase9-ledger";
const QUESTION_ID = "e2e-phase9-question";
const EVIDENCE_ID = "e2e-phase9-evidence";
const EVIDENCE_LINK_ID = "e2e-phase9-evidence-link";
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

async function cleanupPhase9E2eData() {
  const db = requirePool();
  await db.query("DELETE FROM question_status_events WHERE question_id = $1", [QUESTION_ID]);
  await db.query("DELETE FROM evidence_links WHERE run_id = $1 OR evidence_id = $2", [RUN_ID, EVIDENCE_ID]);
  await db.query("DELETE FROM customer_confirmations WHERE run_id = $1", [RUN_ID]);
  await db.query("DELETE FROM customer_confirmation_pack_items WHERE run_id = $1", [RUN_ID]);
  await db.query("DELETE FROM customer_confirmation_packs WHERE run_id = $1", [RUN_ID]);
  await db.query("DELETE FROM question_items WHERE run_id = $1", [RUN_ID]);
  await db.query("DELETE FROM evidence WHERE run_id = $1 OR id = $2", [RUN_ID, EVIDENCE_ID]);
  await db.query("DELETE FROM change_ledger_entries WHERE id = $1 OR run_id = $2", [LEDGER_ID, RUN_ID]);
  await db.query("DELETE FROM change_proposals WHERE id = $1 OR run_id = $2", [PROPOSAL_ID, RUN_ID]);
  await db.query("DELETE FROM case_items WHERE run_id = $1", [RUN_ID]);
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
  await db.query("DELETE FROM clients WHERE id = $1 OR code = 'E2E9'", [CLIENT_ID]);
}

async function seedPhase9E2eData() {
  const db = requirePool();
  await db.query(
    `INSERT INTO roles (id, code, name, description)
     VALUES ('e2e-phase9-role', 'DELIVERY_SPECIALIST'::role_code, 'Delivery Specialist', 'E2E role')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
  );
  const role = await db.query<{ id: string }>("SELECT id FROM roles WHERE code = 'DELIVERY_SPECIALIST'::role_code");
  await db.query(
    "INSERT INTO clients (id, code, name, status, updated_at) VALUES ($1, 'E2E9', 'Phase 9 Client', 'ACTIVE'::client_status, now())",
    [CLIENT_ID],
  );
  await db.query(
    "INSERT INTO users (id, email, display_name, status, updated_at) VALUES ($1, 'phase9@example.local', 'Phase 9 E2E', 'ACTIVE'::user_status, now())",
    [USER_ID],
  );
  await db.query("INSERT INTO user_roles (id, user_id, role_id) VALUES ('e2e-phase9-user-role', $1, $2)", [
    USER_ID,
    role.rows[0].id,
  ]);
  await db.query(
    "INSERT INTO client_accesses (id, user_id, client_id, role_id, status) VALUES ('e2e-phase9-access', $1, $2, $3, 'ACTIVE'::client_access_status)",
    [USER_ID, CLIENT_ID, role.rows[0].id],
  );
  await db.query(
    "INSERT INTO employees (id, client_id, employee_code, full_name, status, updated_at) VALUES ($1, $2, 'E9-001', 'Dewi Evidence', 'ACTIVE'::employee_status, now())",
    [EMPLOYEE_ID, CLIENT_ID],
  );
  await db.query(
    `INSERT INTO payroll_runs
     (id, client_id, payroll_month, status, blocking_issue_count, high_risk_issue_count, created_by_id, updated_at)
     VALUES ($1, $2, '2036-09', 'PENDING_CUSTOMER_CONFIRMATION'::payroll_run_status, 1, 1, $3, now())`,
    [RUN_ID, CLIENT_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO raw_input_items
     (id, client_id, payroll_month, run_id, source_channel, input_type, status, redacted_summary, created_by_id, updated_at)
     VALUES ($1, $2, '2036-09', $3, 'WECHAT_TEXT'::raw_input_source_channel, 'TEXT'::raw_input_type,
     'PROPOSAL_GENERATED'::raw_input_status, '客户确认 Dewi 本月调薪', $4, now())`,
    [RAW_ID, CLIENT_ID, RUN_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO change_proposals
     (id, client_id, run_id, raw_input_item_id, created_by_id, reviewed_by_id, source, proposal_type,
      status, target_object_type, target_employee_id, target_field, previous_value, proposed_value, effective_from,
      risk_level, confidence, reason, evidence_refs, review_note, reviewed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5, 'MANUAL_FROM_INTAKE'::change_proposal_source, 'SALARY_ADJUSTMENT'::change_proposal_type,
      'APPROVED'::change_proposal_status, 'EmployeeMasterVersion', $6, 'salaryAmount', '{"amount":10000000}', '{"amount":12000000}', '2036-09',
      'R3'::audit_risk_level, 'HIGH'::confidence_band, '人工确认调薪', ARRAY['evidence:e2e-phase9-evidence'], '确认入账', now(), now())`,
    [PROPOSAL_ID, CLIENT_ID, RUN_ID, RAW_ID, USER_ID, EMPLOYEE_ID],
  );
  await db.query(
    `INSERT INTO change_ledger_entries
     (id, proposal_id, client_id, run_id, reviewed_by_id, target_employee_id, entry_type, target_object_type,
      target_field, previous_value, new_value, effective_from, risk_level, evidence_refs)
     VALUES ($1, $2, $3, $4, $5, $6, 'SALARY_ADJUSTMENT'::change_proposal_type, 'EmployeeMasterVersion',
      'salaryAmount', '{"amount":10000000}', '{"amount":12000000}', '2036-09', 'R3'::audit_risk_level, ARRAY['evidence:e2e-phase9-evidence'])`,
    [LEDGER_ID, PROPOSAL_ID, CLIENT_ID, RUN_ID, USER_ID, EMPLOYEE_ID],
  );
  await db.query(
    `INSERT INTO question_items
     (id, client_id, run_id, raw_input_item_id, source, status, risk_level, title, detail, reason,
      impact_summary, target_object_type, target_object_id, target_field, blocking_issue_ref,
      required_evidence_types, created_by_id, updated_at)
     VALUES ($1, $2, $3, $4, 'MANUAL'::question_source, 'WAITING_CUSTOMER_REPLY'::question_status,
      'R2'::audit_risk_level, '确认调薪生效范围', '客户需确认 Dewi 调薪是否只影响 2036-09',
      '缺少覆盖范围会阻断确认包', '影响员工 Dewi 和 salaryAmount', 'EMPLOYEE', $5, 'salaryAmount',
      'blocking:salary-scope', ARRAY['WECHAT_TEXT'], $6, now())`,
    [QUESTION_ID, CLIENT_ID, RUN_ID, RAW_ID, EMPLOYEE_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO evidence
     (id, client_id, run_id, raw_input_item_id, kind, source_channel, status, redacted_summary,
      content_text, content_hash, applicable_month, source_label, coverage_scope_type, coverage_scope, uploaded_by_id, updated_at)
     VALUES ($1, $2, $3, $4, 'WECHAT_TEXT'::evidence_kind, 'WECHAT_TEXT'::raw_input_source_channel,
      'VALID'::evidence_lifecycle_status, '客户回复：确认 Dewi 调薪', '确认 Dewi 2036-09 调薪无误',
      'e2e-phase9-hash', '2036-09', '企业微信客户回复', 'MIXED'::coverage_scope_type,
      '{"type":"MIXED","runId":"e2e-phase9-run","employeeIds":["e2e-phase9-employee"],"fields":["salaryAmount"]}', $5, now())`,
    [EVIDENCE_ID, CLIENT_ID, RUN_ID, RAW_ID, USER_ID],
  );
  await db.query(
    `INSERT INTO evidence_links
     (id, evidence_id, client_id, run_id, object_type, object_id, object_label, target_field, coverage_scope_type, coverage_scope, linked_by_id)
     VALUES ($1, $2, $3, $4, 'PAYROLL_RUN'::evidence_link_object_type, $4, 'Phase 9 run', 'salaryAmount',
      'MIXED'::coverage_scope_type,
      '{"type":"MIXED","runId":"e2e-phase9-run","employeeIds":["e2e-phase9-employee"],"fields":["salaryAmount"]}', $5)`,
    [EVIDENCE_LINK_ID, EVIDENCE_ID, CLIENT_ID, RUN_ID, USER_ID],
  );
}

test.beforeAll(async () => {
  try {
    await cleanupPhase9E2eData();
    await seedPhase9E2eData();
    seeded = true;
  } catch (error) {
    seedError = error instanceof Error ? error.message : String(error);
  }
});

test.afterAll(async () => {
  if (seeded) {
    await cleanupPhase9E2eData();
  }
  await pool?.end();
});

test.use({ viewport: { width: 1440, height: 900 } });

test("generates a customer confirmation pack and backfills scoped customer evidence", async ({ page }) => {
  test.skip(!seeded, `database seed unavailable: ${seedError}`);

  await page.setExtraHTTPHeaders({ "x-user-id": USER_ID });
  await page.goto(`/payroll-runs/${RUN_ID}/evidence`);
  await expect(page.getByRole("heading", { name: "追问与证据中心" })).toBeVisible();
  await expect(page.getByText("确认调薪生效范围")).toBeVisible();
  await expect(page.getByRole("article").filter({ hasText: "企业微信客户回复" })).toBeVisible();

  await page.goto(`/payroll-runs/${RUN_ID}/customer-confirmation`);
  await expect(page.getByRole("heading", { name: "客户确认包", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "生成新确认包版本" }).click();
  await expect(page.getByRole("heading", { name: "v1 · 草稿/核对材料" })).toBeVisible();
  await expect(page.getByText("本月变更", { exact: true })).toBeVisible();
  await expect(page.getByText("缺失信息", { exact: true })).toBeVisible();
  await expect(page.getByText("需客户确认", { exact: true }).first()).toBeVisible();

  await page.getByLabel("回复证据").selectOption(EVIDENCE_ID);
  await page.getByLabel("客户确认人").fill("Ibu Customer");
  await page.locator('input[name="employeeIds"]').fill(EMPLOYEE_ID);
  await page.locator('input[name="fields"]').fill("salaryAmount");
  await page.getByLabel("客户回复文本").fill("确认无误，仅覆盖 Dewi 2036-09 salaryAmount");
  await page.getByRole("button", { name: "回填客户确认" }).click();

  await expect(page.getByText("客户确认记录")).toBeVisible();
  await expect(page.getByText("Ibu Customer")).toBeVisible();
  await expect(page.getByText("VALID")).toBeVisible();
});
