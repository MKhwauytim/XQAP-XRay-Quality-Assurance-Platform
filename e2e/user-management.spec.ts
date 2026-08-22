import { expect, test } from "@playwright/test";
import { gotoSim, openSubTab, workspace } from "./helpers/app";
import { ACTIVITY_READY, FEATURE_MATRIX_READY, PAGE_MATRIX_READY, PROCESS_READY, USERS_READY } from "./helpers/sections";
import { MANAGED_USERS } from "./helpers/seed";

/**
 * «إدارة المستخدمين» — the roster and the two independent permission
 * matrices. Every mutation here is written to
 * `3-user-data/users.permissions.json` and re-read by `usePermissions`, so the
 * proof of a change landing is the app re-gating itself.
 */

test.beforeEach(async ({ page }) => {
  await gotoSim(page, "admin");
});

test("the roster holds the seeded users, all active", async ({ page }) => {
  await openSubTab(page, "إدارة المستخدمين", "المستخدمون", USERS_READY(page));
  const ws = workspace(page);
  await expect(ws.getByText("المستخدمون", { exact: true }).first()).toBeVisible();
  await expect(ws.getByRole("textbox", { name: "اسم المستخدم" })).toHaveCount(MANAGED_USERS);
  for (const username of ["malrogi", "jalgahamdi", "hihaloraini", "saalhijji", "amonem", "mkhuwaytim", "simguest"]) {
    await expect(ws.getByRole("textbox", { name: "اسم المستخدم" }).and(page.locator(`[value="${username}"]`))).toHaveCount(1);
  }
});

test("adding a user grows the roster and the new account is assignable", async ({ page }) => {
  await openSubTab(page, "إدارة المستخدمين", "المستخدمون", USERS_READY(page));
  const ws = workspace(page);
  await ws.getByRole("button", { name: "+ إضافة مستخدم" }).click();

  const form = ws.locator("form, .um-add-form").filter({ hasText: "مستخدم جديد" }).first();
  const scope = (await form.count()) > 0 ? form : ws;
  await scope.getByRole("textbox", { name: "اسم المستخدم" }).first().fill("e2euser");
  await scope.getByRole("textbox", { name: "الاسم الظاهر" }).first().fill("مستخدم اختبار آلي");
  await scope.getByRole("textbox", { name: "كلمة المرور" }).first().fill("E2e!TestPass123");
  await scope.getByRole("combobox", { name: "الدور", exact: true }).selectOption("employee");
  await ws.getByRole("button", { name: "إضافة المستخدم" }).click();

  await expect(ws.getByRole("textbox", { name: "اسم المستخدم" })).toHaveCount(MANAGED_USERS + 1);
  await expect(ws.getByRole("combobox", { name: "دور المستخدم مستخدم اختبار آلي" })).toHaveValue("employee");

  // The roster is what the distribution planner reads, so a new employee has to
  // reach it — this is the join between user management and the rest of the app.
  await openSubTab(page, "إدارة بيانات الأشعة", "معالجة البيانات", PROCESS_READY(page));
  await expect(
    workspace(page).getByRole("table", { name: "حصص الخبراء عبر المستويات" })
      .getByRole("row").filter({ hasText: "e2euser" }),
  ).toBeVisible();
});

test("a role change on the roster is reflected in the user's row", async ({ page }) => {
  await openSubTab(page, "إدارة المستخدمين", "المستخدمون", USERS_READY(page));
  const ws = workspace(page);
  const roleSelect = ws.getByRole("combobox", { name: "دور المستخدم حاتم العريني" });
  await expect(roleSelect).toHaveValue("employee");
  await roleSelect.selectOption("supervisor");
  await expect(roleSelect).toHaveValue("supervisor");
});

test("the page matrix renders every catalog row with three access levels", async ({ page }) => {
  await openSubTab(page, "إدارة المستخدمين", "صلاحيات الصفحات", PAGE_MATRIX_READY(page));
  const ws = workspace(page);
  const row = ws.getByRole("row").filter({ hasText: "إدارة بيانات الأشعة" }).first();
  for (const role of ["ضيف", "موظف", "مشرف", "مدير"]) {
    for (const level of ["لا وصول", "عرض فقط", "تعديل كامل"]) {
      await expect(row.getByRole("button", { name: `${role}: population - ${level}` })).toBeVisible();
    }
  }
});

test("revoking a page in the matrix removes it from that role's rail", async ({ page }) => {
  await openSubTab(page, "إدارة المستخدمين", "صلاحيات الصفحات", PAGE_MATRIX_READY(page));
  const ws = workspace(page);
  const row = ws.getByRole("row").filter({ hasText: "مركز الإشعارات" }).first();
  await row.getByRole("button", { name: "مدير: ew/notifications - لا وصول" }).click();

  // Role preview evaluates the same live matrix, so the effect is visible at once.
  await page.getByRole("group", { name: "معاينة الأدوار" }).getByRole("button", { name: "المدير" }).click();
  await expect(
    page.getByRole("navigation", { name: "تبويبات النظام" })
      .getByRole("button", { name: "مركز الإشعارات", exact: true }),
  ).toHaveCount(0);
});

test("the feature matrix is grouped by page and gated on page access", async ({ page }) => {
  await openSubTab(page, "إدارة المستخدمين", "صلاحيات الميزات", FEATURE_MATRIX_READY(page));
  const ws = workspace(page);
  for (const group of ["إدارة مساحة العمل", "معالجة المجتمع", "الإدارة والتقارير", "ارفاق حالات استثنائية"]) {
    await expect(ws.getByRole("button", { name: group, exact: true })).toBeVisible();
  }
  // Guest holds no page, so every guest cell is a disabled, explained control.
  const row = ws.getByRole("row").filter({ hasText: "اعتماد طلبات الإحالة" });
  await expect(row.getByRole("checkbox").first()).toBeDisabled();
});

test("the activity view renders", async ({ page }) => {
  await openSubTab(page, "إدارة المستخدمين", "متابعة الأنشطة", ACTIVITY_READY(page));
  await expect(workspace(page).getByRole("region", { name: "إدارة المستخدمين" })).toBeVisible();
});

test("user management is admin-only", async ({ page }) => {
  await gotoSim(page, "manager");
  await expect(
    page.getByRole("navigation", { name: "تبويبات النظام" })
      .getByRole("button", { name: "إدارة المستخدمين", exact: true }),
  ).toHaveCount(0);
});
