import { expect, test } from "@playwright/test";
import { gotoSim, openTab, workspace } from "./helpers/app";

/**
 * «مركز الإشعارات» — a workspace-wide broadcast written through a single
 * CAS-protected file, plus per-recipient acknowledgement.
 */

test.beforeEach(async ({ page }) => {
  await gotoSim(page, "admin");
  await openTab(page, "مركز الإشعارات");
  await expect(workspace(page).getByRole("heading", { name: "مركز الإشعارات", level: 1 })).toBeVisible();
});

test("starts empty and refuses to publish an empty notification", async ({ page }) => {
  const ws = workspace(page);
  await expect(ws.getByRole("heading", { name: "لا توجد إشعارات مطابقة" })).toBeVisible();
  await expect(ws.getByRole("button", { name: "نشر الإشعار" })).toBeDisabled();
});

test("targeting narrows the recipient count", async ({ page }) => {
  const ws = workspace(page);
  const targeting = ws.getByRole("tablist", { name: "الاستهداف" });
  await expect(ws.getByText("4 مستلم مستهدف")).toBeVisible();

  await targeting.getByRole("tab", { name: "المشرفون" }).click();
  await expect(ws.getByText("مستلم مستهدف")).toBeVisible();
  await expect(ws.getByText("4 مستلم مستهدف")).toHaveCount(0);

  await targeting.getByRole("tab", { name: "الكل" }).click();
  await expect(ws.getByText("4 مستلم مستهدف")).toBeVisible();
});

test("publishing a notification lists it and starts the acknowledgement count", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("textbox", { name: "نص الإشعار الجديد" }).fill("إشعار من اختبار آلي");
  const publish = ws.getByRole("button", { name: "نشر الإشعار" });
  await expect(publish).toBeEnabled();
  await publish.click();

  await expect(ws.getByRole("heading", { name: "لا توجد إشعارات مطابقة" })).toHaveCount(0);
  await expect(ws.getByText("إشعار من اختبار آلي").first()).toBeVisible();
  await expect(ws.getByRole("tab", { name: "الكل 1" })).toBeVisible();
  await expect(ws.getByRole("tab", { name: "بانتظار اطّلاع 1" })).toBeVisible();
});

test("the detail pane lists every targeted recipient as unread", async ({ page }) => {
  const ws = workspace(page);
  await ws.getByRole("textbox", { name: "نص الإشعار الجديد" }).fill("تفاصيل الإشعار الآلي");
  await ws.getByRole("button", { name: "نشر الإشعار" }).click();
  await expect(ws.getByRole("tab", { name: "الكل 1" })).toBeVisible();
  await expect(ws.getByRole("heading", { name: "اختر إشعاراً لعرض تفاصيله" })).toHaveCount(0);

  // Publishing selects the new notification, and its detail pane is the
  // acknowledgement ledger: nobody has read it yet, and every seeded reviewer
  // is on the list.
  await expect(ws.getByText("0 من 4 اطّلعوا")).toBeVisible();
  await expect(ws.getByText("0%", { exact: true })).toBeVisible();
  const recipients = ws.getByRole("tablist", { name: "قائمة المستهدفين" });
  await expect(recipients.getByRole("tab", { name: "لم يطّلع" })).toBeVisible();
  for (const name of ["محمد العتيبي", "جميلة الغامدي", "حاتم العريني", "سلمان الحجي"]) {
    await expect(ws.getByRole("listitem").filter({ hasText: name })).toContainText("لم يطّلع بعد");
  }
  await expect(ws.getByRole("button", { name: "تذكير من لم يطّلع" })).toBeEnabled();
});

test("the notification centre is closed to an employee by default", async ({ page }) => {
  await gotoSim(page, "employee");
  await expect(
    page.getByRole("navigation", { name: "تبويبات النظام" })
      .getByRole("button", { name: "مركز الإشعارات", exact: true }),
  ).toHaveCount(0);
});
