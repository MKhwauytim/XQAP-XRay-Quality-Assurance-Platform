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
});

test("the row that wrote an override can revert it without a remount", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("button", { name: /^القائمة الجانبية/ }).click();

  const editor = ws.getByRole("textbox", { name: "عنوان القائمة الجانبية" });
  const revert = ws.getByRole("button", {
    name: "استعادة القيمة الافتراضية للحقل: عنوان القائمة الجانبية",
  });
  await expect(revert).toBeDisabled();

  await editor.fill("لوحة اختبار آلي");
  await editor.blur();

  // The row writes the label store, so the row has to SEE the label store: the
  // revert button arms itself, the default value is offered back, and the row
  // marks itself as overridden — all without leaving the page and returning.
  await expect(revert).toBeEnabled();
  await expect(ws.getByText("الافتراضي: لوحة الإدارة")).toBeVisible();
  await expect(ws.locator(".settings-label-row.is-custom")).toHaveCount(1);

  // And the button does what it says: one click puts the sidebar back.
  await revert.click();
  await expect(sidebar(page).getByText("لوحة الإدارة")).toBeVisible();
  await expect(revert).toBeDisabled();
  await expect(editor).toHaveValue("لوحة الإدارة");
});

test("the override counter follows the overrides that exist", async ({ page }) => {
  const ws = workspace(page);
  await expect(ws.getByRole("button", { name: /^استعادة الكل/ })).toHaveCount(0);

  await ws.getByRole("button", { name: /^القائمة الجانبية/ }).click();
  const editor = ws.getByRole("textbox", { name: "عنوان القائمة الجانبية" });
  await editor.fill("لوحة اختبار آلي");
  await editor.blur();

  await expect(ws.getByRole("button", { name: /^استعادة الكل \(1 تعديل\)/ })).toBeVisible();
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
