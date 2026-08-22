import { expect, test } from "@playwright/test";
import { gotoSim, openSubTab, openTab, workspace } from "./helpers/app";
import { ACTIONS_READY, PAGE_MATRIX_READY } from "./helpers/sections";

/**
 * «سجل الإجراءات» — the CAS-protected action log under
 * `5-system/audit/actions/`.
 *
 * Rather than assert against seeded history, each test PERFORMS an action and
 * then goes looking for it. That keeps the spec honest about the whole path:
 * the action handler calls `recordAction`, the record survives the CAS write,
 * and the reader's filters find it again.
 */

/**
 * The user-management page's own region.
 *
 * Scoped rather than using `workspace()` because the app keeps previously
 * visited tabs mounted (the tab-mount LRU) — a `getByText` over the whole
 * workspace can match text belonging to a hidden tab the test visited earlier.
 */
function log(page: import("@playwright/test").Page) {
  return workspace(page).getByRole("region", { name: "إدارة المستخدمين" });
}

async function openActionLog(page: import("@playwright/test").Page): Promise<void> {
  await openSubTab(page, "إدارة المستخدمين", "سجل الإجراءات", ACTIONS_READY(page));
  await expect(log(page).getByRole("heading", { name: "سجل الإجراءات" })).toBeVisible();
}

test("renders the log with its user and type filters", async ({ page }) => {
  await gotoSim(page, "admin");
  await openActionLog(page);
  const ws = log(page);
  // Deliberately not pinned to a count: the simulated workspace's seeded
  // action history is tuned independently of this suite.
  await expect(ws.getByText(/^\d+ من \d+ سجل/)).toBeVisible();
  await expect(ws.getByRole("combobox", { name: "المستخدم" })).toBeVisible();
  await expect(ws.getByRole("group", { name: "تصفية السجل" })).toBeVisible();
  await expect(ws.getByRole("button", { name: "تحديث السجل" })).toBeEnabled();
});

test("a permission change is recorded and attributed", async ({ page }) => {
  await gotoSim(page, "admin");

  await openSubTab(page, "إدارة المستخدمين", "صلاحيات الصفحات", PAGE_MATRIX_READY(page));
  await workspace(page).getByRole("row").filter({ hasText: "مركز الإشعارات" }).first()
    .getByRole("button", { name: "مدير: ew/notifications - لا وصول" }).click();

  await openActionLog(page);
  const ws = log(page);
  await ws.getByRole("button", { name: "تحديث السجل" }).click();

  await expect(ws.getByRole("combobox", { name: "المستخدم" }).getByRole("option", { name: "admin", exact: true })).toBeAttached();
  // Narrow to the acting user AND the free-text target so the assertion cannot
  // be satisfied by a seeded record from another user.
  await ws.getByRole("combobox", { name: "المستخدم" }).selectOption("admin");
  await ws.getByRole("searchbox", { name: "بحث في الهدف والتفاصيل" }).fill("ew/notifications");
  await expect(ws.getByText("تغيير صلاحية صفحة").first()).toBeVisible();
  await expect(ws.getByText("ew/notifications").first()).toBeVisible();
});

test("a label override is recorded under its own action type", async ({ page }) => {
  await gotoSim(page, "admin");

  await openTab(page, "إدارة الإعدادات");
  await workspace(page).getByRole("button", { name: /^القائمة الجانبية/ }).click();
  const editor = workspace(page).getByRole("textbox", { name: "عنوان القائمة الجانبية" });
  await editor.fill("عنوان مسجَّل في سجل الإجراءات");
  await editor.blur();

  await openActionLog(page);
  const ws = log(page);
  await ws.getByRole("button", { name: "تحديث السجل" }).click();

  // `label-override-changed` is one of the high-volume types the reader leaves
  // OFF by default, so the record is there but filtered out until it is asked for.
  await ws.getByRole("searchbox", { name: "بحث في الهدف والتفاصيل" }).fill("sidebar_title");
  await expect(ws.getByText("لا توجد سجلات مطابقة للتصفية الحالية.")).toBeVisible();

  await ws.getByRole("checkbox", { name: "تعديل تسميات الواجهة" }).check();
  await expect(ws.getByText("sidebar_title").first()).toBeVisible();
});

test("the type filter narrows the log, and clearing every type empties it", async ({ page }) => {
  await gotoSim(page, "admin");

  // Two different action types so a filter has something to discriminate.
  await openSubTab(page, "إدارة المستخدمين", "صلاحيات الصفحات", PAGE_MATRIX_READY(page));
  await workspace(page).getByRole("row").filter({ hasText: "مركز الإشعارات" }).first()
    .getByRole("button", { name: "مدير: ew/notifications - لا وصول" }).click();
  await openTab(page, "إدارة الإعدادات");
  await workspace(page).getByRole("button", { name: /^القائمة الجانبية/ }).click();
  const editor = workspace(page).getByRole("textbox", { name: "عنوان القائمة الجانبية" });
  await editor.fill("عنوان آخر");
  await editor.blur();

  await openActionLog(page);
  const ws = log(page);
  await ws.getByRole("button", { name: "تحديث السجل" }).click();

  const filters = ws.getByRole("group", { name: "تصفية السجل" });
  await filters.getByRole("button", { name: "إلغاء تحديد الكل", exact: true }).click();
  await expect(ws.getByText(/^0 من \d+ سجل/)).toBeVisible();

  await filters.getByRole("button", { name: "تحديد الكل", exact: true }).click();
  await expect(ws.getByText(/^0 من \d+ سجل/)).toHaveCount(0);
});

test("the free-text filter narrows to one record", async ({ page }) => {
  await gotoSim(page, "admin");

  await openTab(page, "إدارة الإعدادات");
  await workspace(page).getByRole("button", { name: /^القائمة الجانبية/ }).click();
  const editor = workspace(page).getByRole("textbox", { name: "عنوان القائمة الجانبية" });
  await editor.fill("قيمة للبحث");
  await editor.blur();

  await openActionLog(page);
  const ws = log(page);
  await ws.getByRole("button", { name: "تحديث السجل" }).click();

  await ws.getByRole("checkbox", { name: "تعديل تسميات الواجهة" }).check();
  await ws.getByRole("searchbox", { name: "بحث في الهدف والتفاصيل" }).fill("sidebar_title");
  await expect(ws.getByText("sidebar_title").first()).toBeVisible();
  await expect(ws.getByText(/^0 من \d+ سجل/)).toHaveCount(0);

  await ws.getByRole("searchbox", { name: "بحث في الهدف والتفاصيل" }).fill("لا-يوجد-مثل-هذا");
  await expect(ws.getByText(/^0 من \d+ سجل/)).toBeVisible();
});
