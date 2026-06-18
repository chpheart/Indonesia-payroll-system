import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("shows Phase 7 Golden Eval release gates at desktop width", async ({ page }) => {
  await page.goto("/agent-evals");

  await expect(page.getByRole("heading", { name: "Workflow Node 门禁" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Phase 7 用例结果" })).toBeVisible();
  await expect(page.getByText("customer-file-instruction-data-only")).toBeVisible();
  await expect(page.getByText("change-proposal-direct-write-blocked")).toBeVisible();
  await expect(page.getByText("confirmation-summary-critical-exceptions-preserved")).toBeVisible();
  await expect(page.getByRole("cell", { name: "INTAKE_CLASSIFICATION" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "CONFIRMATION_SUMMARY" }).first()).toBeVisible();
});
