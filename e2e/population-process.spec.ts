import { expect, test } from "@playwright/test";
import { gotoSim, openSubTab, workspace } from "./helpers/app";
import { PROCESS_READY } from "./helpers/sections";
import { ASSIGNMENTS, SAMPLE_ROWS, SUBMITTED_ANSWERS } from "./helpers/seed";

/**
 * Population → «معالجة البيانات»: the four-phase pipeline (upload → report →
 * draw → distribute).
 *
 * The seeded month has already been through all four, so what this file
 * asserts is the pipeline's own view of a completed month: every phase marked
 * done, the distribution totals matching the event log, and the bulk-assign
 * planner correctly refusing to re-assign rows that already have an owner.
 */

test.beforeEach(async ({ page }) => {
  await gotoSim(page, "admin");
  await openSubTab(page, "إدارة بيانات الأشعة", "معالجة البيانات", PROCESS_READY(page));
});

test("all four phases report as complete for the seeded month", async ({ page }) => {
  const stages = workspace(page).getByRole("navigation", { name: "مراحل معالجة المجتمع" });
  for (const stage of ["رفع البيانات", "تقرير البيانات والمعالجة", "اختيار العينة"]) {
    await expect(stages.getByRole("button", { name: new RegExp(`^${stage} مكتملة$`) })).toBeVisible();
  }
  await expect(stages.getByRole("button", { name: "توزيع العينة المرحلة الحالية" })).toBeVisible();
});

test("the readiness strip reports the sample and distribution totals", async ({ page }) => {
  const readiness = workspace(page).getByRole("region", { name: "جاهزية الشهر" });
  await expect(readiness).toContainText("6/2026");
  await expect(readiness).toContainText(`${SAMPLE_ROWS} عنصر`);
  await expect(readiness).toContainText(`${SAMPLE_ROWS} معين`);
  await expect(readiness).toContainText("غير مرفوع"); // no BI workbook in the seed
});

test("the distribution status matches the folded event log", async ({ page }) => {
  const status = workspace(page).getByRole("status").filter({ hasText: "حالة التوزيع" });
  await expect(status).toContainText("100%");
  await expect(status).toContainText(`${SAMPLE_ROWS} من ${SAMPLE_ROWS}`);
  await expect(status).toContainText(String(SUBMITTED_ANSWERS));
  await expect(status).toContainText(String(SAMPLE_ROWS - SUBMITTED_ANSWERS));
});

test("bulk assignment refuses to touch rows that already have an owner", async ({ page }) => {
  const ws = workspace(page);
  await expect(ws.getByRole("status").filter({ hasText: "سيتم تخطي" }))
    .toContainText(`سيتم تخطي ${SAMPLE_ROWS} صفاً معيناً مسبقاً`);
  await expect(ws.getByText("يوزّع الصفوف غير المعينة فقط — 0 صفاً")).toBeVisible();
});

test("the quota table lists every reviewer with their CertScan licence", async ({ page }) => {
  const table = workspace(page).getByRole("table", { name: "حصص الخبراء عبر المستويات" });
  for (const reviewer of ASSIGNMENTS) {
    await expect(table.getByRole("row").filter({ hasText: reviewer.username })).toBeVisible();
    await expect(table.getByRole("spinbutton", { name: `حصة ${reviewer.displayName} في المستوى الأول` })).toBeVisible();
  }
  // Two of the four seeded reviewers hold no CertScan licence, and the planner
  // says so rather than silently mis-routing CertScan rows.
  await expect(workspace(page).getByRole("alert").filter({ hasText: "غير مرخّص لـ CertScan" }))
    .toContainText("حاتم العريني، سلمان الحجي");
});

test("the manual-review mode is reachable", async ({ page }) => {
  const ws = workspace(page);
  const modes = ws.getByRole("group", { name: "المراجعة اليدوية" });
  const manual = modes.getByRole("button", { name: "المراجعة اليدوية", exact: true });
  await expect(modes.getByRole("button", { name: "التوزيع الجماعي" })).toHaveAttribute("aria-pressed", "true");
  await manual.click();
  await expect(manual).toHaveAttribute("aria-pressed", "true");
  await expect(ws.locator("#p4-manual-section")).toBeVisible();
});
