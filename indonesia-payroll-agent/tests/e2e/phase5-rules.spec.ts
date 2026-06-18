import { expect, test } from "@playwright/test";
import "dotenv/config";
import { Pool } from "pg";

const TEST_USER_ID = "e2e-phase5-user";
const TEST_CLIENT_ID = "e2e-phase5-client";
const TEST_COMPONENT_ID = "e2e-phase5-component";
const TEST_RULE_ID = "e2e-phase5-rule";
const TEST_FX_ID = "e2e-phase5-fx";
const TEST_RUN_ID = "e2e-phase5-run";
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

async function cleanupPhase5Data() {
  const db = requirePool();
  await db.query("DELETE FROM audit_logs WHERE client_id = $1 OR actor_user_id = $2", [
    TEST_CLIENT_ID,
    TEST_USER_ID,
  ]);
  await db.query("DELETE FROM run_status_events WHERE run_id = $1", [TEST_RUN_ID]);
  await db.query("DELETE FROM run_reminders WHERE run_id = $1", [TEST_RUN_ID]);
  await db.query("DELETE FROM run_assignments WHERE run_id = $1", [TEST_RUN_ID]);
  await db.query("DELETE FROM payroll_runs WHERE id = $1 OR client_id = $2", [
    TEST_RUN_ID,
    TEST_CLIENT_ID,
  ]);
  await db.query("DELETE FROM regression_runs WHERE rule_version_id = $1", [TEST_RULE_ID]);
  await db.query("DELETE FROM rule_approvals WHERE rule_version_id = $1", [TEST_RULE_ID]);
  await db.query("DELETE FROM rule_versions WHERE id = $1 OR client_id = $2", [
    TEST_RULE_ID,
    TEST_CLIENT_ID,
  ]);
  await db.query("DELETE FROM fx_rate_versions WHERE id = $1 OR client_id = $2", [
    TEST_FX_ID,
    TEST_CLIENT_ID,
  ]);
  await db.query("DELETE FROM client_component_aliases WHERE client_id = $1", [TEST_CLIENT_ID]);
  await db.query("DELETE FROM payroll_components WHERE id = $1 OR code = 'E2E5_GROSS'", [
    TEST_COMPONENT_ID,
  ]);
  await db.query("DELETE FROM client_accesses WHERE user_id = $1 OR client_id = $2", [
    TEST_USER_ID,
    TEST_CLIENT_ID,
  ]);
  await db.query("DELETE FROM user_roles WHERE user_id = $1", [TEST_USER_ID]);
  await db.query("DELETE FROM users WHERE id = $1", [TEST_USER_ID]);
  await db.query("DELETE FROM clients WHERE id = $1 OR code = 'E2E5'", [TEST_CLIENT_ID]);
}

async function seedPhase5Data() {
  const db = requirePool();
  const ruleAdmin = await db.query<{ id: string }>(
    `INSERT INTO roles (id, code, name, description)
     VALUES ('e2e-phase5-rule-admin-role', 'RULE_ADMIN'::role_code, 'Rule Admin', 'E2E rule admin')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const payrollLead = await db.query<{ id: string }>(
    `INSERT INTO roles (id, code, name, description)
     VALUES ('e2e-phase5-lead-role', 'PAYROLL_LEAD'::role_code, 'Payroll Lead', 'E2E lead')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  await db.query(
    `INSERT INTO clients (id, code, name, status, updated_at)
     VALUES ($1, 'E2E5', 'Phase 5 Rules Client', 'ACTIVE'::client_status, now())`,
    [TEST_CLIENT_ID],
  );
  await db.query(
    `INSERT INTO users (id, email, display_name, status, updated_at)
     VALUES ($1, 'phase5-e2e@example.local', 'Phase 5 E2E', 'ACTIVE'::user_status, now())`,
    [TEST_USER_ID],
  );
  await db.query("INSERT INTO user_roles (id, user_id, role_id) VALUES ($1, $2, $3)", [
    "e2e-phase5-user-role-admin",
    TEST_USER_ID,
    ruleAdmin.rows[0].id,
  ]);
  await db.query("INSERT INTO user_roles (id, user_id, role_id) VALUES ($1, $2, $3)", [
    "e2e-phase5-user-role-lead",
    TEST_USER_ID,
    payrollLead.rows[0].id,
  ]);
  await db.query(
    `INSERT INTO client_accesses (id, user_id, client_id, role_id, status)
     VALUES ('e2e-phase5-access-admin', $1, $2, $3, 'ACTIVE'::client_access_status)`,
    [TEST_USER_ID, TEST_CLIENT_ID, ruleAdmin.rows[0].id],
  );
  await db.query(
    `INSERT INTO payroll_runs (id, client_id, payroll_month, status, created_by_id, updated_at)
     VALUES ($1, $2, '2036-05', 'PENDING_PRECHECK'::payroll_run_status, $3, now())`,
    [TEST_RUN_ID, TEST_CLIENT_ID, TEST_USER_ID],
  );
  await db.query(
    `INSERT INTO payroll_components
     (id, code, name, component_type, taxable_cash, bpjs_health_base, bpjs_employment_base,
      paid_out, affects_net_pay, affects_employer_cost, status, created_by_id, updated_at)
     VALUES ($1, 'E2E5_GROSS', 'E2E Gross Salary', 'EARNING'::payroll_component_type,
      true, false, false, true, true, false, 'ACTIVE'::payroll_component_status, $2, now())`,
    [TEST_COMPONENT_ID, TEST_USER_ID],
  );
  await db.query(
    `INSERT INTO client_component_aliases
     (id, client_id, component_id, source_label, normalized_label, version_number,
      effective_month, status, change_reason, created_by_id, updated_at)
     VALUES ('e2e-phase5-alias', $1, $2, 'Gaji Pokok', 'gaji pokok', 1,
      '2036-05', 'DRAFT'::component_alias_status, 'E2E alias', $3, now())`,
    [TEST_CLIENT_ID, TEST_COMPONENT_ID, TEST_USER_ID],
  );
  await seedRuleAndFx(db);
}

async function seedRuleAndFx(db: Pool) {
  await db.query(
    `INSERT INTO rule_versions
     (id, rule_key, rule_type, scope_type, scope_key, client_id, version_number,
      effective_month, status, content, conflict_check_summary, change_summary,
      drafted_by_id, updated_at)
     VALUES ($1, 'E2E5_PPH21', 'PPH21'::rule_version_type, 'CUSTOMER'::rule_scope_type,
      $2, $3, 1, '2036-05', 'APPROVED'::rule_version_status, '{}', '{}',
      'E2E rule', $4, now())`,
    [TEST_RULE_ID, `CLIENT:${TEST_CLIENT_ID}`, TEST_CLIENT_ID, TEST_USER_ID],
  );
  await db.query(
    `INSERT INTO rule_approvals (id, rule_version_id, decision, approver_id, note)
     VALUES ('e2e-phase5-approval', $1, 'APPROVED'::rule_approval_decision, $2, 'ok')`,
    [TEST_RULE_ID, TEST_USER_ID],
  );
  for (const dataset of ["BLUE_FOCUS", "SANFU"]) {
    await db.query(
      `INSERT INTO regression_runs
       (id, rule_version_id, dataset_code, scenario_name, status, max_diff_idr, run_by_id)
       VALUES ($1, $2, $3::regression_dataset_code, 'monthly', 'PASSED'::regression_run_status, 0, $4)`,
      [`e2e-phase5-regression-${dataset}`, TEST_RULE_ID, dataset, TEST_USER_ID],
    );
  }
  await db.query(
    `INSERT INTO fx_rate_versions
     (id, client_id, payroll_month, currency_code, version_number, rate, evidence_refs,
      source_label, change_reason, status, created_by_id, updated_at)
     VALUES ($1, $2, '2036-05', 'USD', 1, 16000, ARRAY['evidence-fx'],
      'Bank Indonesia', 'E2E FX', 'DRAFT'::fx_rate_version_status, $3, now())`,
    [TEST_FX_ID, TEST_CLIENT_ID, TEST_USER_ID],
  );
}

test.beforeAll(async () => {
  try {
    await cleanupPhase5Data();
    await seedPhase5Data();
    seeded = true;
  } catch (error) {
    seedError = error instanceof Error ? error.message : String(error);
  }
});

test.afterAll(async () => {
  if (seeded) {
    await cleanupPhase5Data();
  }
  await pool?.end();
});

test("publishes rules, blocks unconfirmed FX, then snapshots precheck", async ({ page, request }) => {
  test.skip(!seeded, `database seed unavailable: ${seedError}`);

  await page.setExtraHTTPHeaders({ "x-user-id": TEST_USER_ID });
  await page.goto("/rules");

  await expect(page.getByRole("heading", { name: "规则版本、审批与回归" })).toBeVisible();
  await expect(page.getByRole("cell", { name: /E2E5_GROSS/ }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: /E2E5_PPH21/ }).first()).toBeVisible();
  await expect(page.getByText("BLUE_FOCUS · PASSED · diff 0")).toBeVisible();

  await page.getByPlaceholder("输入 PUBLISH 确认发布").fill("PUBLISH");
  await page.getByRole("button", { name: "发布版本" }).click();
  await expect(page.getByText("PUBLISHED")).toBeVisible();

  const blocked = await request.patch(`/api/payroll-runs/${TEST_RUN_ID}`, {
    headers: { "x-user-id": TEST_USER_ID },
    data: {
      action: "transition",
      toStatus: "PENDING_CALCULATION",
      reason: "try with unconfirmed fx",
    },
  });
  expect(blocked.status()).toBe(400);
  await expect(blocked.json()).resolves.toMatchObject({
    errorCode: "PAYROLL_RUN_FX_RATE_UNCONFIRMED",
  });

  await page.getByPlaceholder("输入 CONFIRM_FX 确认").fill("CONFIRM_FX");
  await page.getByRole("button", { name: "确认汇率" }).click();
  await expect(page.getByText("CONFIRMED")).toBeVisible();

  const advanced = await request.patch(`/api/payroll-runs/${TEST_RUN_ID}`, {
    headers: { "x-user-id": TEST_USER_ID },
    data: {
      action: "transition",
      toStatus: "PENDING_CALCULATION",
      reason: "rules and fx precheck passed",
    },
  });
  expect(advanced.status()).toBe(200);

  const db = requirePool();
  const snapshot = await db.query<{
    rule_version_snapshot: unknown[];
    fx_rate_snapshot: unknown[];
  }>(
    "SELECT rule_version_snapshot, fx_rate_snapshot FROM payroll_runs WHERE id = $1",
    [TEST_RUN_ID],
  );
  expect(snapshot.rows[0].rule_version_snapshot).toHaveLength(1);
  expect(snapshot.rows[0].fx_rate_snapshot).toHaveLength(1);
});
