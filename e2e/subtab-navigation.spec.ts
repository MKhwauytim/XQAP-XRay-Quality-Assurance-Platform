import { expect, test } from "@playwright/test";
import { gotoSim, openTab, sidebar, workspace } from "./helpers/app";
import { ACTIONS_READY, BROWSE_READY, PROCESS_READY, RESULTS_READY } from "./helpers/sections";

/**
 * Sub-tab navigation, clicked at full speed.
 *
 * Every click here is made ONCE and asserted against the sub-tab's own
 * content — never against the rail, and never retried. That is the whole
 * point: the rail moves synchronously on click while the content follows a
 * `window` CustomEvent, so a rail-only assertion passes even when the two
 * disagree, and a retried click hides the disagreement entirely.
 *
 * The hard case is a tab whose component is not mounted when the click
 * happens: `reports` and `user-management` are `React.lazy` boundaries, so the
 * first visit spends a Suspense fallback with no listener attached anywhere,
 * and the tab-mount LRU (3 tabs) puts every tab back in that state once it has
 * been evicted. `subTabSelection.ts` is what carries the selection across that
 * gap; without it the tab opens on its own default sub-tab while the rail
 * highlights the one that was clicked.
 */

const NAV = "تبويبات النظام";

test("a sub-tab of a lazy tab opens on the first visit, clicked once", async ({ page }) => {
  await gotoSim(page, "admin");
  await openTab(page, "إدارة المستخدمين");
  await page.getByRole("navigation", { name: NAV }).getByRole("button", { name: "سجل الإجراءات", exact: true }).click();
  await expect(ACTIONS_READY(page)).toBeVisible();
});

test("the reports tab opens on the sub-tab that was clicked, not its default", async ({ page }) => {
  await gotoSim(page, "admin");
  await openTab(page, "إدارة التقارير");
  await page.getByRole("navigation", { name: NAV }).getByRole("button", { name: "مصمم التقارير", exact: true }).click();
  await expect(workspace(page).getByRole("heading", { name: "مصمم التقارير", level: 1 })).toBeVisible();
});

test("a sub-tab still opens after its tab has been evicted from the mount LRU", async ({ page }) => {
  await gotoSim(page, "admin");

  // Land on population/browse, then visit three other tabs so population is
  // pushed out of the 3-tab mount LRU and has to mount again.
  await openTab(page, "إدارة بيانات الأشعة");
  await page.getByRole("navigation", { name: NAV }).getByRole("button", { name: "استعراض البيانات", exact: true }).click();
  await expect(BROWSE_READY(page)).toBeVisible();

  await openTab(page, "إدارة مساحة العمل");
  await openTab(page, "إدارة التقارير");
  await openTab(page, "إدارة المستخدمين");

  await openTab(page, "إدارة بيانات الأشعة");
  await page.getByRole("navigation", { name: NAV }).getByRole("button", { name: "معالجة البيانات", exact: true }).click();
  await expect(PROCESS_READY(page)).toBeVisible();
});

test("the rail's highlight and the visible content name the same sub-tab", async ({ page }) => {
  await gotoSim(page, "admin");
  await openTab(page, "إدارة مساحة العمل");
  const results = sidebar(page).getByRole("button", { name: "نتائج فحص الأشعة", exact: true });
  await results.click();
  await expect(results).toHaveAttribute("aria-current", "page");
  await expect(RESULTS_READY(page)).toBeVisible();
});
