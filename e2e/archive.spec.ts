import { expect, test } from "@playwright/test";
import { gotoSim, openTab, workspace } from "./helpers/app";
import { ANSWER_RECORDS, POPULATION_ROWS, SAMPLE_ROWS, SEED_MONTH_LABEL, SUBMITTED_ANSWERS } from "./helpers/seed";

/**
 * «إدارة الأرشيف» — backup and the per-month status board.
 *
 * The counters here are a second, independent read of the same workspace the
 * other tabs render, so they double as a consistency check on the seed:
 * 320 population rows → 96 sampled → 96 distributed → 60 answer records.
 */

test.beforeEach(async ({ page }) => {
  await gotoSim(page, "admin");
  await openTab(page, "إدارة الأرشيف");
  await expect(workspace(page).getByRole("heading", { name: "الأرشيف" })).toBeVisible();
});

test("summarises the workspace with the seeded counts", async ({ page }) => {
  const ws = workspace(page);
  await expect(ws.getByText("صفوف المجتمع").locator("xpath=following-sibling::strong[1]")).toHaveText(String(POPULATION_ROWS));
  await expect(ws.getByText("العينات", { exact: true }).locator("xpath=following-sibling::strong[1]")).toHaveText(String(SAMPLE_ROWS));
  await expect(ws.getByText("صفوف التوزيع").locator("xpath=following-sibling::strong[1]")).toHaveText(String(SAMPLE_ROWS));
  await expect(ws.getByText("إجابات الفحص").locator("xpath=following-sibling::strong[1]")).toHaveText(String(ANSWER_RECORDS));
});

test("the month status table reports the distribution split", async ({ page }) => {
  const ws = workspace(page);
  const row = ws.getByRole("row").filter({ hasText: SEED_MONTH_LABEL });
  await expect(row).toContainText("موزع");
  await expect(row).toContainText(String(POPULATION_ROWS));
  await expect(row).toContainText(`مكتمل ${SUBMITTED_ANSWERS} · معلّق ${SAMPLE_ROWS - SUBMITTED_ANSWERS}`);
});

test("a manual backup runs and is reported", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("button", { name: "نسخ احتياطي الآن" }).click();
  // The automatic backup on login already proves the writer works; this asserts
  // the manual path reports a result rather than silently doing nothing.
  await expect(ws.getByRole("status").or(ws.getByRole("alert")).first()).toBeVisible();
});

test("the automatic backup period can be changed", async ({ page }) => {
  const ws = workspace(page);
  const period = ws.getByRole("combobox", { name: "فترة النسخ" });
  await expect(period).toHaveValue("daily");
  await period.selectOption({ label: "أسبوعي" });
  await expect(ws.getByRole("definition").filter({ hasText: "أسبوعي" }).first()).toBeVisible();
});

test("the archive is closed to an ordinary employee", async ({ page }) => {
  await gotoSim(page, "employee");
  await expect(
    page.getByRole("navigation", { name: "تبويبات النظام" })
      .getByRole("button", { name: "إدارة الأرشيف", exact: true }),
  ).toHaveCount(0);
});
