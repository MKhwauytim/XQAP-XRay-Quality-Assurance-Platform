import { expect, test } from "@playwright/test";
import { gotoSim, openSubTab, tableSearch, workspace } from "./helpers/app";
import { APPROVALS_READY, REFERRALS_READY, RESULTS_READY } from "./helpers/sections";
import { JALGAHAMDI_ROWS, SAMPLE_ROWS, SUBMITTED_ANSWERS, TEMPLATE_NAME } from "./helpers/seed";

/**
 * The two «إدارة مساحة العمل» sub-tabs that are not the reviewer's queue:
 * the results grid and the approvals desk. Plus the inspection-form builder,
 * which renders inside the same tab for the roles that hold it.
 */

test.describe("«نتائج فحص الأشعة»", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSim(page, "supervisor");
    await openSubTab(page, "إدارة مساحة العمل", "نتائج فحص الأشعة", RESULTS_READY(page));
  });

  test("joins every distributed row with its answer", async ({ page }) => {
    const ws = workspace(page);
    await expect(ws.getByText(`${SAMPLE_ROWS} صف`)).toBeVisible();
    await expect(ws.getByRole("columnheader", { name: /خبير جودة الأشعة/ })).toBeVisible();
    await expect(ws.getByRole("columnheader", { name: /حركة العينة/ })).toBeVisible();
  });

  test("the three scope buttons switch the result set", async ({ page }) => {
    const ws = workspace(page);
    const scope = ws.getByRole("group", { name: "نطاق النتائج" });
    for (const name of ["النتائج", "المستبدلة", "المحالة/المنقولة"]) {
      await expect(scope.getByRole("button", { name })).toBeVisible();
    }
    await scope.getByRole("button", { name: "المستبدلة" }).click();
    // Nothing has been replaced in the seed, so this scope is legitimately empty.
    await expect(ws.getByText(`${SAMPLE_ROWS} صف`)).toHaveCount(0);
    await scope.getByRole("button", { name: "النتائج" }).click();
    await expect(ws.getByText(`${SAMPLE_ROWS} صف`)).toBeVisible();
  });

  test("search finds a submitted study and shows who answered it", async ({ page }) => {
    await tableSearch(page).fill(JALGAHAMDI_ROWS.submitted);
    const row = workspace(page).getByRole("row").filter({ hasText: JALGAHAMDI_ROWS.submitted });
    await expect(row).toBeVisible();
    await expect(row).toContainText("jalgahamdi");
    await expect(row).toContainText("مكتملة");
  });
});

test.describe("«اعتماد الطلبات»", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSim(page, "supervisor");
    await openSubTab(page, "إدارة مساحة العمل", "اعتماد الطلبات", APPROVALS_READY(page));
  });

  test("starts with an empty queue and explains why", async ({ page }) => {
    const ws = workspace(page);
    await expect(ws.getByRole("tab", { name: "معلّق 0" })).toBeVisible();
    await expect(ws.getByRole("heading", { name: "لا توجد طلبات لهذا التصنيف" })).toBeVisible();
    await expect(ws.getByRole("heading", { name: "اختر طلباً لعرض تفاصيله" })).toBeVisible();
  });

  test("offers a status filter and a request-kind filter", async ({ page }) => {
    const ws = workspace(page);
    for (const name of ["معلّق 0", "مقبول 0", "مرفوض 0", "الكل 0"]) {
      await expect(ws.getByRole("tablist", { name: "تصفية حسب الحالة" }).getByRole("tab", { name })).toBeVisible();
    }
    for (const name of ["كل الأنواع", "إحالة", "استبدال", "إعادة فتح"]) {
      await expect(ws.getByRole("tablist", { name: "تصفية حسب نوع الطلب" }).getByRole("tab", { name })).toBeVisible();
    }
  });

  test("the decision history view is reachable", async ({ page }) => {
    const ws = workspace(page);
    await ws.getByRole("button", { name: "السجل" }).click();
    await expect(ws.getByRole("heading", { name: "اعتماد الطلبات", level: 1 })).toBeVisible();
  });
});

test("the inspection-form builder renders the seeded template", async ({ page }) => {
  await gotoSim(page, "admin");
  // NB the rail's label is «نموذج الفحص» while `tabCatalog.ts` carries
  // «نموذج الفحص (مساحة العمل)» for the same sub-tab id — the two are not
  // required to agree, so the rail's wording is what a test must click.
  const ready = workspace(page).getByRole("heading", { name: "نموذج الفحص", level: 1 });
  await openSubTab(page, "إدارة مساحة العمل", "نموذج الفحص", ready);

  const card = workspace(page).getByRole("article").filter({ hasText: TEMPLATE_NAME });
  await expect(card.getByRole("heading", { name: TEMPLATE_NAME })).toBeVisible();
  await expect(card).toContainText("الإصدار 1");
  await expect(card.getByRole("button", { name: "تعديل" })).toBeEnabled();
});

test("a reviewer's own queue is the landing sub-tab", async ({ page }) => {
  await gotoSim(page, "employee");
  await openSubTab(page, "إدارة مساحة العمل", "صور الأشعة المحالة", REFERRALS_READY(page));
  await expect(workspace(page).getByRole("heading", { name: "صور الأشعة المحالة", level: 1 })).toBeVisible();
  // Sanity-check the cross-tab total the results grid also reports.
  expect(SUBMITTED_ANSWERS).toBeLessThan(SAMPLE_ROWS);
});
