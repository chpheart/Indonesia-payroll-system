import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  const hasOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasOverflow).toBe(false);
}

test.describe("Phase 2 desktop shell", () => {
  test("matches the 1440px PC layout contract on clients", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/clients");

    await expect(page.getByRole("heading", { name: "客户主档与授权" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    await expect(page.getByLabel("员工搜索")).toBeVisible();

    const sidebarBox = await page.locator(".sidebar").boundingBox();
    const topbarBox = await page.locator(".topbar").boundingBox();
    expect(Math.round(sidebarBox?.width ?? 0)).toBe(220);
    expect(Math.round(topbarBox?.height ?? 0)).toBe(56);
    await expectNoHorizontalOverflow(page);
  });

  test("shows the Phase 3 payroll run task console at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/payroll-runs");

    await expect(page.getByRole("heading", { name: "Payroll Runs" })).toBeVisible();
    await expect(page.getByLabel("任务台指标")).toBeVisible();
    await expect(page.getByLabel("客户筛选")).toBeVisible();
    await expect(page.getByLabel("状态筛选")).toBeVisible();
    await expect(page.getByRole("heading", { name: "我的待办" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("exposes audit filters and detail-safe empty state", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/audit");

    await expect(page.getByRole("heading", { name: "审计日志" })).toBeVisible();
    await expect(page.getByLabel("动作类型")).toBeVisible();
    await expect(page.getByLabel("角色")).toBeVisible();
    await expect(page.getByLabel("员工关键字")).toBeVisible();
    await expect(page.getByLabel("开始时间")).toBeVisible();
    await expect(page.getByLabel("结束时间")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("keeps employee sensitive data workflow visible at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 820 });
    await page.goto("/employees");

    await expect(page.getByRole("heading", { name: "员工主档" })).toBeVisible();
    await expect(page.getByText("关键字段变更先生成待确认版本")).toBeVisible();
    await expect(page.getByLabel("搜索员工")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("exposes the Phase 4 intake inbox controls at desktop width", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/intake");

    await expect(page.getByRole("heading", { name: "AI Intake Inbox" })).toBeVisible();
    await expect(page.getByLabel("AI Intake 指标")).toBeVisible();
    await expect(page.getByLabel("来源渠道")).toBeVisible();
    await expect(page.getByLabel("输入类型")).toBeVisible();
    await expect(page.getByLabel("原始文本")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
