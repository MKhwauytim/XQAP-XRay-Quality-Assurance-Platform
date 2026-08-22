import { expect, test, type Page } from "@playwright/test";
import { findRow, gotoSim, openSubTab, openTab, tableSearch, workspace } from "./helpers/app";
import { FEATURE_MATRIX_READY } from "./helpers/sections";
import { ASSIGNMENTS, JALGAHAMDI_ROWS } from "./helpers/seed";

/**
 * `answer-on-behalf` — the oversight feature that lets one user complete
 * ANOTHER reviewer's study.
 *
 * The rule (`resolvePanelAuthoring` in
 * `.../XrayReferrals/subComponents.tsx`) has three outcomes, and all three are
 * covered here:
 *   • holder of the feature + row still unanswered → editable, "on-behalf" notice
 *   • holder of the feature + row already answered → read-only, must reopen first
 *   • no feature                                   → read-only, "no permission"
 *
 * The feature ships enabled for `admin` only, so the supervisor case starts by
 * granting it in the real feature-permission matrix and then switching the
 * admin's role preview — a reload cannot carry the grant, because every page
 * load re-seeds the in-memory workspace from scratch.
 */

const REVIEWER = ASSIGNMENTS[0]; // jalgahamdi

function panel(page: Page) {
  return page.locator(".ew-xr-panel-col");
}

async function openOthersRow(page: Page, xrayImageId: string): Promise<void> {
  await openTab(page, "إدارة مساحة العمل");
  await workspace(page)
    .getByRole("combobox", { name: "نطاق العرض" })
    .selectOption({ label: `${REVIEWER.displayName} (${REVIEWER.count})` });
  await tableSearch(page).fill(xrayImageId);
  await findRow(page, xrayImageId).click();
  await expect(panel(page)).toContainText(xrayImageId);
}

test("a holder of the feature answers another reviewer's untouched row", async ({ page }) => {
  await gotoSim(page, "admin");
  await openOthersRow(page, JALGAHAMDI_ROWS.untouched);

  await expect(workspace(page).getByRole("status").filter({ hasText: "أنت تجيب نيابةً عن" }))
    .toContainText(REVIEWER.displayName);

  await panel(page).getByRole("group", { name: "نتيجة مراجعة الصورة" })
    .getByRole("button", { name: "سليمة" }).click();
  await panel(page).getByRole("group", { name: "نتيجة التفتيش" })
    .getByRole("button", { name: "اشتباه" }).click();
  await panel(page).getByRole("button", { name: "تقديم الفحص" }).click();

  await expect(panel(page)).toContainText("مقدم");
  await expect(findRow(page, JALGAHAMDI_ROWS.untouched)).toHaveClass(/dt-tr--completed/);
});

test("a holder of the feature is refused on a row that is already answered", async ({ page }) => {
  await gotoSim(page, "admin");
  await openOthersRow(page, JALGAHAMDI_ROWS.submitted);

  await expect(workspace(page).getByRole("status").filter({ hasText: "أُجيب عنها بالفعل" }))
    .toContainText(REVIEWER.displayName);
  // No form, no submit — the only way forward is an explicit reopen.
  await expect(panel(page).getByRole("button", { name: "تقديم الفحص" })).toHaveCount(0);
  await expect(panel(page).getByRole("group", { name: "نتيجة التفتيش" })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "إعادة فتح للتصحيح" })).toBeVisible();
});

test("without the feature the panel is view-only on someone else's row", async ({ page }) => {
  // `answer-on-behalf` ships OFF for every managed role, supervisor included.
  await gotoSim(page, "supervisor");
  await openOthersRow(page, JALGAHAMDI_ROWS.untouchedSecond);

  await expect(workspace(page).getByRole("status").filter({ hasText: "لا تملك صلاحية الإجابة نيابةً" }))
    .toBeVisible();
  await expect(panel(page).getByRole("button", { name: "تقديم الفحص" })).toHaveCount(0);
});

test("granting the feature to supervisor makes the same row answerable", async ({ page }) => {
  await gotoSim(page, "admin");

  // 1. Turn the feature on for `supervisor` in the real matrix.
  await openSubTab(page, "إدارة المستخدمين", "صلاحيات الميزات", FEATURE_MATRIX_READY(page));
  const row = workspace(page).getByRole("row").filter({ hasText: "الإجابة نيابةً عن موظف آخر" });
  await expect(row).toBeVisible();
  // Column order is guest · employee · supervisor · manager. The feature matrix's
  // toggles are visually-hidden inputs inside an unlabelled `<label class="um-toggle">`
  // (unlike the page matrix, whose buttons carry real aria-labels), so there is no
  // accessible name to query and the label has to be clicked instead of the input
  // checked. See docs/development/E2E_TESTS.md § "Selectors we could not make semantic".
  const toggle = row.getByRole("checkbox").nth(2);
  await expect(toggle).not.toBeChecked();
  await row.locator("label.um-toggle").nth(2).click();
  await expect(toggle).toBeChecked();

  // 2. Preview as a supervisor — same page load, so the grant is still live.
  await page.getByRole("group", { name: "معاينة الأدوار" }).getByRole("button", { name: "المشرف" }).click();

  // 3. The row that was view-only a moment ago is now editable.
  await openOthersRow(page, JALGAHAMDI_ROWS.untouchedSecond);
  await expect(workspace(page).getByRole("status").filter({ hasText: "أنت تجيب نيابةً عن" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "تقديم الفحص" })).toBeVisible();
});
