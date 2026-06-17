import { expect, test } from "@playwright/test";
import "dotenv/config";
import { Pool } from "pg";

const TEST_USER_ID = "e2e-phase6-user";
const TEST_CLIENT_ID = "e2e-phase6-client";
const TEST_RUN_ID = "e2e-phase6-run";
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

async function cleanupPhase6Data() {
  const db = requirePool();
  const runIds = await db.query<{ id: string }>(
    "SELECT id FROM agent_runs WHERE run_id = $1 OR client_id = $2",
    [TEST_RUN_ID, TEST_CLIENT_ID],
  );
  const agentRunIds = runIds.rows.map((row) => row.id);

  if (agentRunIds.length > 0) {
    await db.query("DELETE FROM guardrail_results WHERE agent_run_id = ANY($1)", [agentRunIds]);
    await db.query("DELETE FROM tool_invocations WHERE agent_run_id = ANY($1)", [agentRunIds]);
    await db.query("DELETE FROM agent_steps WHERE agent_run_id = ANY($1)", [agentRunIds]);
    await db.query("DELETE FROM agent_runs WHERE id = ANY($1)", [agentRunIds]);
  }

  await db.query("DELETE FROM audit_logs WHERE client_id = $1 OR actor_user_id = $2", [
    TEST_CLIENT_ID,
    TEST_USER_ID,
  ]);
  await db.query("DELETE FROM payroll_runs WHERE id = $1 OR client_id = $2", [
    TEST_RUN_ID,
    TEST_CLIENT_ID,
  ]);
  await db.query("DELETE FROM client_accesses WHERE user_id = $1 OR client_id = $2", [
    TEST_USER_ID,
    TEST_CLIENT_ID,
  ]);
  await db.query("DELETE FROM user_roles WHERE user_id = $1", [TEST_USER_ID]);
  await db.query("DELETE FROM users WHERE id = $1", [TEST_USER_ID]);
  await db.query("DELETE FROM clients WHERE id = $1 OR code = 'E2E6'", [TEST_CLIENT_ID]);
}

async function seedPhase6Data() {
  const db = requirePool();
  const deliveryRole = await db.query<{ id: string }>(
    `INSERT INTO roles (id, code, name, description)
     VALUES ('e2e-phase6-delivery-role', 'DELIVERY_SPECIALIST'::role_code,
      'Delivery Specialist', 'E2E delivery')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  await db.query(
    `INSERT INTO clients (id, code, name, status, updated_at)
     VALUES ($1, 'E2E6', 'Phase 6 Agent Client', 'ACTIVE'::client_status, now())`,
    [TEST_CLIENT_ID],
  );
  await db.query(
    `INSERT INTO users (id, email, display_name, status, updated_at)
     VALUES ($1, 'phase6-e2e@example.local', 'Phase 6 E2E', 'ACTIVE'::user_status, now())`,
    [TEST_USER_ID],
  );
  await db.query("INSERT INTO user_roles (id, user_id, role_id) VALUES ($1, $2, $3)", [
    "e2e-phase6-user-role",
    TEST_USER_ID,
    deliveryRole.rows[0].id,
  ]);
  await db.query(
    `INSERT INTO client_accesses (id, user_id, client_id, role_id, status)
     VALUES ('e2e-phase6-access', $1, $2, $3, 'ACTIVE'::client_access_status)`,
    [TEST_USER_ID, TEST_CLIENT_ID, deliveryRole.rows[0].id],
  );
  await db.query(
    `INSERT INTO payroll_runs (id, client_id, payroll_month, status, created_by_id, updated_at)
     VALUES ($1, $2, '2036-06', 'PENDING_MAPPING_CONFIRMATION'::payroll_run_status, $3, now())`,
    [TEST_RUN_ID, TEST_CLIENT_ID, TEST_USER_ID],
  );
}

test.beforeAll(async () => {
  try {
    await cleanupPhase6Data();
    await seedPhase6Data();
    seeded = true;
  } catch (error) {
    seedError = error instanceof Error ? error.message : String(error);
  }
});

test.afterAll(async () => {
  if (seeded) {
    await cleanupPhase6Data();
  }
  await pool?.end();
});

test("records governed Agent trace and exposes detail page", async ({ page, request }) => {
  test.skip(!seeded, `database seed unavailable: ${seedError}`);

  const response = await request.post("/api/agent/runs", {
    headers: { "x-user-id": TEST_USER_ID },
    data: {
      runId: TEST_RUN_ID,
      nodeType: "FIELD_MAPPING",
      contextSnapshotId: "e2e-phase6-snapshot",
      sourceObjectRefs: ["workbook:e2e:A1"],
      evidenceRefs: ["evidence:e2e:A1"],
      formalRun: true,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { agentRunId: string };

  await page.setExtraHTTPHeaders({ "x-user-id": TEST_USER_ID });
  await page.goto("/agent-governance");
  await expect(page.getByRole("heading", { name: "Agent 版本门禁" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "EvalRun 结果" })).toBeVisible();
  await expect(page.getByRole("link", { name: "FIELD_MAPPING" })).toBeVisible();
  await expect(
    page.getByText("critical:field_mapping_candidate:v1", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("critical:FIELD_MAPPING:v1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("tool-contract-lint:PASSED").first()).toBeVisible();
  await expect(
    page.getByText("blue-focus-bpa1-bpmp-critical-field-mapping:PASSED").first(),
  ).toBeVisible();

  await page.goto(`/agent-runs/${body.agentRunId}`);
  await expect(page.getByRole("heading", { name: "FIELD_MAPPING" })).toBeVisible();
  await expect(page.getByText("field_mapping_candidate", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "PREVIEW", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "PREVIEW_ONLY", exact: true })).toBeVisible();
  await expect(page.getByText("guardrail:FIELD_MAPPING:v1", { exact: true })).toBeVisible();
});
