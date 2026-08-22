import { expect, test } from "@playwright/test";
import { gotoSim, openTab, sidebar, workspace } from "./helpers/app";
import { POPULATION_ROWS, SAMPLE_ROWS, SEED_MONTH_FOLDER, SEED_MONTH_LABEL, SUBMITTED_ANSWERS } from "./helpers/seed";

/**
 * «إدارة التقارير» — the report centre and the KPI dashboard.
 *
 * Reports open in a new tab / trigger a download, which a browser test cannot
 * meaningfully assert on beyond "the action fired". What IS asserted here is
 * the month context every builder reads from, the per-report export controls
 * being reachable, and every KPI figure the seed determines.
 */

test.describe("report centre", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSim(page, "admin");
    await openTab(page, "إدارة التقارير");
    await expect(workspace(page).getByRole("heading", { name: "مركز التقارير" })).toBeVisible();
  });

  test("reports are scoped to the seeded month and its real counts", async ({ page }) => {
    const ws = workspace(page);
    await expect(ws.getByText(SEED_MONTH_LABEL, { exact: true })).toBeVisible();
    await expect(ws.getByText(`${POPULATION_ROWS} صورة`)).toBeVisible();
    await expect(ws.getByText(`${SAMPLE_ROWS} عينة`)).toBeVisible();
  });

  test("every report card offers its three export formats", async ({ page }) => {
    const ws = workspace(page);
    for (const title of ["التقرير التنفيذي", "تقرير العينة", "تقرير التوزيع", "تقرير الإدارة"]) {
      await expect(ws.getByText(title, { exact: true }).first()).toBeVisible();
    }
    const formatGroups = ws.getByRole("group", { name: "صيغة التصدير" });
    await expect(formatGroups).toHaveCount(4);
    for (const label of ["عرض تقديمي تفاعلي (HTML)", "بيانات (Excel)", "تقرير تفصيلي تفاعلي (HTML)"]) {
      await expect(formatGroups.first().getByRole("button", { name: label })).toBeEnabled();
    }
  });

  test("the Power BI CSV export names the month folder it will write", async ({ page }) => {
    const ws = workspace(page);
    await expect(ws.getByText("تصدير Power BI / CSV")).toBeVisible();
    await expect(ws.getByText(SEED_MONTH_FOLDER, { exact: true })).toBeVisible();
  });

  test("the executive deck really builds and opens", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));

    // Inside a card the three format buttons only CHOOSE the format; «التصدير»
    // is what runs the builder.
    const group = workspace(page).getByRole("group", { name: "صيغة التصدير" }).first();
    await group.getByRole("button", { name: "عرض تقديمي تفاعلي (HTML)" }).click();

    const popupPromise = page.context().waitForEvent("page");
    await group.getByRole("button", { name: "التصدير" }).click();
    const popup = await popupPromise;

    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveTitle(new RegExp(SEED_MONTH_LABEL));
    await expect(popup.getByText("ضمان جودة الأشعة — " + SEED_MONTH_LABEL)).toBeVisible();
    // The deck's own paging chrome proves the async, chunked builder finished.
    await expect(popup.getByText(/الصفحة 1 من \d+/)).toBeAttached();
    await popup.close();

    await expect(workspace(page).getByRole("status").filter({ hasText: "تم فتح العرض التنفيذي" })).toBeVisible();
    expect(errors, errors.join("\n")).toHaveLength(0);
  });

  test("the sample report builds and opens", async ({ page }) => {
    const group = workspace(page).getByRole("group", { name: "صيغة التصدير" }).nth(1);
    await group.getByRole("button", { name: "تقرير تفصيلي تفاعلي (HTML)" }).click();
    const popupPromise = page.context().waitForEvent("page");
    await group.getByRole("button", { name: "التصدير" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup.locator("body")).toContainText(SEED_MONTH_LABEL);
    await popup.close();
  });

  test("the report designer is reachable from the reports tab", async ({ page }) => {
    await workspace(page).getByRole("button", { name: "تخصيص التصميم" }).click();
    await expect(workspace(page).getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("KPI dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSim(page, "admin");
    await openTab(page, "إدارة التقارير");
    await workspace(page).getByRole("tab", { name: "مؤشرات" }).click();
    await expect(workspace(page).getByRole("heading", { name: "مؤشرات الأداء" })).toBeVisible();
  });

  test("headline figures follow the seeded answers", async ({ page }) => {
    const ws = workspace(page);
    await expect(ws.getByText(`${SUBMITTED_ANSWERS} مدروسة`)).toBeVisible();
    // 40 of 96 sampled studies answered.
    await expect(ws.getByText(`${SUBMITTED_ANSWERS} من ${SAMPLE_ROWS} عينة`)).toBeVisible();
    await expect(ws.getByText("41.7%").first()).toBeVisible();
    await expect(ws.getByText(`المتبقي: ${SAMPLE_ROWS - SUBMITTED_ANSWERS} صورة`)).toBeVisible();
  });

  test("the three dashboard sections each render", async ({ page }) => {
    const ws = workspace(page);
    const tabs = ws.getByRole("tablist", { name: "أقسام لوحة المؤشرات" });
    for (const name of ["نظرة عامة", "المنافذ", "المراجعون"]) {
      await tabs.getByRole("tab", { name }).click();
      await expect(tabs.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
      await expect(ws.getByRole("heading", { level: 3 }).first()).toBeVisible();
    }
  });

  test("the p-chart ships a screen-reader table alongside the SVG", async ({ page }) => {
    const ws = workspace(page);
    await ws.getByRole("tablist", { name: "أقسام لوحة المؤشرات" }).getByRole("tab", { name: "نظرة عامة" }).click();
    await expect(ws.getByRole("table").first()).toBeAttached();
  });

});

test("a supervisor is refused the reports tab entirely", async ({ page }) => {
  // `reports` and every child ship as "none" for supervisor in the default
  // matrix, so the rail must not offer the page at all.
  await gotoSim(page, "supervisor");
  await expect(
    page.getByRole("navigation", { name: "تبويبات النظام" })
      .getByRole("button", { name: "إدارة التقارير", exact: true }),
  ).toHaveCount(0);
});

test("a manager gets the report centre, the KPI board and the designer", async ({ page }) => {
  await gotoSim(page, "manager");
  await openTab(page, "إدارة التقارير");
  await expect(workspace(page).getByRole("heading", { name: "مركز التقارير" })).toBeVisible();
  for (const sub of ["التقارير", "مؤشرات الأداء", "مصمم التقارير"]) {
    await expect(sidebar(page).getByRole("button", { name: sub, exact: true })).toBeVisible();
  }
});
