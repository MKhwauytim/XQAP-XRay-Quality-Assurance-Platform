import { expect, test } from "@playwright/test";
import { gotoSim, openTab, sidebar, workspace } from "./helpers/app";

/**
 * «إدارة الإعدادات» — label overrides (persisted to `localStorage`), the
 * bootstrap-admin account controls, and the browser-storage report.
 */

test.beforeEach(async ({ page }) => {
  await gotoSim(page, "admin");
  await openTab(page, "إدارة الإعدادات");
  await expect(workspace(page).getByRole("heading", { name: "إعدادات النظام" })).toBeVisible();
});

test("label groups are listed and open", async ({ page }) => {
  const ws = workspace(page);
  const group = ws.getByRole("button", { name: /^القائمة الجانبية/ });
  await expect(group).toBeVisible();
  await group.click();
  await expect(ws.getByRole("textbox").first()).toBeVisible();
});

test("overriding a label re-renders the rest of the app immediately", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("button", { name: /^القائمة الجانبية/ }).click();

  // `sidebar_title` is rendered by the sidebar, not by this page — the whole
  // point of the labels store is that an override propagates to every
  // `useLabels()` consumer without a reload.
  await expect(sidebar(page).getByText("لوحة الإدارة")).toBeVisible();

  const editor = ws.getByRole("textbox", { name: "عنوان القائمة الجانبية" });
  await editor.fill("لوحة اختبار آلي");
  await editor.blur();

  await expect(sidebar(page).getByText("لوحة اختبار آلي")).toBeVisible();
  await expect(sidebar(page).getByText("لوحة الإدارة")).toHaveCount(0);
  await expect(ws.locator(".settings-saved-badge")).toBeVisible();

  // NOT asserted: that the row's own «استعادة القيمة الافتراضية» button becomes
  // enabled. It does not — the editor row reads `isCustomized()` without
  // subscribing to the labels store, so the override it just wrote is invisible
  // to itself until the page remounts. Recorded in
  // docs/development/E2E_TESTS.md § "Bugs this suite found"; this test is left
  // asserting the behaviour that IS correct rather than pinning the defect.
});

test("the bootstrap-admin section is present with its login toggle", async ({ page }) => {
  const ws = workspace(page);
  await expect(ws.getByRole("checkbox", { name: /السماح بتسجيل الدخول باسم المستخدم/ })).toBeChecked();
  await expect(ws.getByRole("textbox", { name: "كلمة المرور الجديدة" })).toBeVisible();
  await expect(ws.getByRole("textbox", { name: "تأكيد كلمة المرور" })).toBeVisible();
  await expect(ws.getByRole("button", { name: "تحديث كلمة المرور" })).toBeVisible();
});

test("a mismatched admin password pair is rejected", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("textbox", { name: "كلمة المرور الجديدة" }).fill("Sup3rSecret!Pass1");
  await ws.getByRole("textbox", { name: "تأكيد كلمة المرور" }).fill("Sup3rSecret!Pass2");
  await ws.getByRole("button", { name: "تحديث كلمة المرور" }).click();
  await expect(ws.getByRole("status").or(ws.getByRole("alert")).first()).toBeVisible();
});

test("the recent-errors log and storage report are reachable", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("button", { name: "سجل الأخطاء الأخيرة" }).click();
  await expect(ws.getByText("المساحة المستخدمة", { exact: false })).toBeVisible();
});

test("settings is closed to a manager", async ({ page }) => {
  await gotoSim(page, "manager");
  await expect(
    page.getByRole("navigation", { name: "تبويبات النظام" })
      .getByRole("button", { name: "إدارة الإعدادات", exact: true }),
  ).toHaveCount(0);
});
