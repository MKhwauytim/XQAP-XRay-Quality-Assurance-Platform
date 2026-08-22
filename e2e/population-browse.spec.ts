import { expect, test } from "@playwright/test";
import { gotoSim, openSubTab, tableSearch, workspace } from "./helpers/app";
import { BROWSE_READY } from "./helpers/sections";
import { POPULATION_ROWS, SAMPLE_ROWS } from "./helpers/seed";

/**
 * Population → «استعراض البيانات»: the four datasets, the shared DataTable's
 * search / column filters / paging, and the export affordances.
 *
 * Row counts come straight from the seed, so they are assertions about the
 * data pipeline (Excel → processing → population.final.json → sample draw),
 * not about the table widget.
 */

test.beforeEach(async ({ page }) => {
  await gotoSim(page, "admin");
  await openSubTab(page, "إدارة بيانات الأشعة", "استعراض البيانات", BROWSE_READY(page));
  await expect(workspace(page).getByRole("heading", { name: "البيانات" })).toBeVisible();
});

test("the final-population dataset is the landing view and holds every seeded row", async ({ page }) => {
  const ws = workspace(page);
  await expect(ws.getByRole("button", { name: "المجتمع النهائي" })).toBeVisible();
  await expect(ws.getByText(`${POPULATION_ROWS} صف`, { exact: true })).toBeVisible();
  await expect(ws.getByRole("cell", { name: "DEMO-JED-0001", exact: true })).toBeVisible();
});

test("the table pages the population rather than rendering all 320 rows", async ({ page }) => {
  const ws = workspace(page);
  await expect(ws.getByText(`عرض 1 إلى 100 من ${POPULATION_ROWS} صف`)).toBeVisible();
  // Only the first page is in the DOM: row 101 is not.
  await expect(ws.getByRole("cell", { name: "DEMO-JED-0101", exact: true })).toHaveCount(0);

  await ws.getByRole("button", { name: "الصفحة التالية" }).click();
  await expect(ws.getByText(`عرض 101 إلى 200 من ${POPULATION_ROWS} صف`)).toBeVisible();
  await expect(ws.getByRole("cell", { name: "DEMO-JED-0101", exact: true })).toBeVisible();
});

test("switching to the drawn sample shows the 96 drawn rows", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("button", { name: "العينة المسحوبة" }).click();
  await expect(ws.getByText(`${SAMPLE_ROWS} صف`, { exact: true })).toBeVisible();
});

test("every dataset source renders its own view rather than an error", async ({ page }) => {
  const ws = workspace(page);
  for (const source of ["تحليل المخاطر", "ذكاء الأعمال", "العينة المسحوبة", "المجتمع النهائي"]) {
    await ws.getByRole("button", { name: source }).click();
    // Either rows, or that source's own "no data" state — never a crash.
    await expect(ws.getByRole("table").or(ws.getByRole("status"))).toBeVisible();
  }
  // Back on the population, the count survived the round trip.
  await expect(ws.getByText(`${POPULATION_ROWS} صف`, { exact: true })).toBeVisible();
});

test("free-text search narrows the population to one row", async ({ page }) => {
  const ws = workspace(page);
  await tableSearch(page).fill("DEMO-RUH-0281");
  await expect(ws.getByRole("cell", { name: "DEMO-RUH-0281", exact: true })).toBeVisible();
  await expect(ws.getByRole("cell", { name: "DEMO-JED-0001", exact: true })).toHaveCount(0);
  await expect(ws.getByText(`1 صف من ${POPULATION_ROWS}`)).toBeVisible();
});

test("a column filter narrows to one port and clears again", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("button", { name: "تصفية المنفذ" }).click();

  const filter = page.getByRole("dialog", { name: "تصفية المنفذ" });
  await expect(filter).toBeVisible();
  await filter.getByRole("checkbox", { name: "ميناء جدة الإسلامي" }).check();

  // The seed puts 120 of the 320 population rows in Jeddah.
  await expect(ws.getByText(`120 صف من ${POPULATION_ROWS}`)).toBeVisible();
  await expect(ws.getByRole("cell", { name: "ميناء الدمام" })).toHaveCount(0);

  await filter.getByRole("button", { name: "مسح" }).click();
  await expect(ws.getByText(`${POPULATION_ROWS} صف`, { exact: true })).toBeVisible();
});

test("export and column controls are reachable", async ({ page }) => {
  const ws = workspace(page);
  await expect(ws.getByRole("button", { name: "تصدير XLSX" })).toBeEnabled();
  const columns = ws.getByRole("button", { name: /^الأعمدة/ });
  await expect(columns).toBeVisible();
  await columns.click();
  await expect(page.getByRole("checkbox", { name: "معرف الأشعة" })).toBeVisible();
});
