import { expect, test, type Page } from "@playwright/test";
import { findRow, gotoSim, openSubTab, openTab, tableSearch, workspace } from "./helpers/app";
import { APPROVALS_READY, REFERRALS_READY } from "./helpers/sections";
import { ASSIGNMENTS, JALGAHAMDI_ROWS } from "./helpers/seed";

/**
 * Reassignment — moving a pending study from one reviewer to another.
 *
 * Two entry points, both landing on the same `ReassignModal` and the same
 * append-only distribution event:
 *   • one row at a time, from the inspection panel;
 *   • many rows at once, from the queue's selection bar.
 *
 * The proof is the assignment count in the oversight scope picker: 34/29 must
 * become 33/30 for a single move. That number is derived from the folded event
 * log, so it only moves if the event really was written and re-read.
 */

const FROM = ASSIGNMENTS[0]; // jalgahamdi, 34
const TO = ASSIGNMENTS[1];   // hihaloraini, 29

function scopePicker(page: Page) {
  return workspace(page).getByRole("combobox", { name: "نطاق العرض" });
}

async function openFromReviewersQueue(page: Page): Promise<void> {
  await gotoSim(page, "admin");
  await openTab(page, "إدارة مساحة العمل");
  await scopePicker(page).selectOption({ label: `${FROM.displayName} (${FROM.count})` });
  await expect(workspace(page).getByRole("button", { name: `جميع الحالات ${FROM.count}` })).toBeVisible();
}

test("reassigns a single row from the inspection panel", async ({ page }) => {
  await openFromReviewersQueue(page);

  await tableSearch(page).fill(JALGAHAMDI_ROWS.untouched);
  await findRow(page, JALGAHAMDI_ROWS.untouched).click();
  await page.locator(".ew-xr-panel-col").getByRole("button", { name: "إسناد لموظف آخر" }).click();

  const modal = page.getByRole("dialog", { name: "إسناد لموظف آخر" });
  await expect(modal).toContainText("عينة واحدة");
  await expect(modal.getByRole("button", { name: "إرسال طلب الإحالة" })).toBeDisabled();

  await modal.getByRole("combobox", { name: /الموظف المستلم/ })
    .selectOption({ label: `${TO.displayName} (${TO.username})` });
  await modal.getByRole("textbox", { name: /سبب الإحالة/ }).fill("نقل ضمن اختبار آلي");
  // The modal summarises the move and requires an explicit acknowledgement.
  await expect(modal).toContainText(`سيتم إرسال طلب إحالة 1 عينة إلى ${TO.username}`);
  await modal.getByRole("checkbox", { name: /أؤكد مراجعة الملخص/ }).check();
  await modal.getByRole("button", { name: "إرسال طلب الإحالة" }).click();

  await expect(modal).toHaveCount(0);

  // A reassignment is a REQUEST, not an immediate move: the row stays with its
  // current owner until a supervisor approves.
  await expect(workspace(page).getByRole("status").filter({ hasText: "تم إرسال طلب إحالة" }))
    .toContainText(`إلى ${TO.username}`);
  await expect(scopePicker(page)).toHaveValue(FROM.username);
  await expect(scopePicker(page).getByRole("option", { name: new RegExp(`${FROM.displayName}.*\\(${FROM.count}\\)`) }))
    .toBeAttached();
});

test("approving the request is what actually moves the row", async ({ page }) => {
  await openFromReviewersQueue(page);

  await tableSearch(page).fill(JALGAHAMDI_ROWS.untouched);
  await findRow(page, JALGAHAMDI_ROWS.untouched).click();
  await page.locator(".ew-xr-panel-col").getByRole("button", { name: "إسناد لموظف آخر" }).click();

  const modal = page.getByRole("dialog", { name: "إسناد لموظف آخر" });
  await modal.getByRole("combobox", { name: /الموظف المستلم/ })
    .selectOption({ label: `${TO.displayName} (${TO.username})` });
  await modal.getByRole("textbox", { name: /سبب الإحالة/ }).fill("نقل ضمن اختبار آلي");
  await modal.getByRole("checkbox", { name: /أؤكد مراجعة الملخص/ }).check();
  await modal.getByRole("button", { name: "إرسال طلب الإحالة" }).click();
  await expect(modal).toHaveCount(0);

  // The request lands in the approval queue…
  await openSubTab(page, "إدارة مساحة العمل", "اعتماد الطلبات", APPROVALS_READY(page));
  const ws = workspace(page);
  await expect(ws.getByRole("tab", { name: "معلّق 1" })).toBeVisible();
  await expect(ws.getByRole("heading", { name: `${FROM.displayName} ← ${TO.displayName}` })).toBeVisible();
  await ws.getByRole("button", { name: "موافقة" }).click();

  await expect(ws.getByRole("tab", { name: "معلّق 0" })).toBeVisible();
  await expect(ws.getByRole("tab", { name: "مقبول 1" })).toBeVisible();

  // …and only now does the assignment count move: 34 → 33, 29 → 30.
  //
  // No refresh button is clicked here, deliberately. The referrals queue stays
  // mounted behind this desk (tab-mount LRU), so it is showing pre-approval
  // state — and the approval is what tells it otherwise (`notifyLocalDataChange`
  // in useApprovalData). Re-add a manual refresh here and this stops testing
  // anything: it would pass just as well with the queue left stale for 45 s.
  await openSubTab(page, "إدارة مساحة العمل", "صور الأشعة المحالة", REFERRALS_READY(page));
  await expect(scopePicker(page).getByRole("option", { name: new RegExp(`${FROM.displayName}.*\\(${FROM.count - 1}\\)`) }))
    .toBeAttached();
  await expect(scopePicker(page).getByRole("option", { name: new RegExp(`${TO.displayName}.*\\(${TO.count + 1}\\)`) }))
    .toBeAttached();
});

test("reassigns a selection of rows in bulk", async ({ page }) => {
  await openFromReviewersQueue(page);
  const ws = workspace(page);

  const first = JALGAHAMDI_ROWS.untouched;
  const second = JALGAHAMDI_ROWS.untouchedSecond;

  await tableSearch(page).fill(first);
  await findRow(page, first).getByRole("checkbox").check();
  await tableSearch(page).fill(second);
  await findRow(page, second).getByRole("checkbox").check();
  await tableSearch(page).fill("");

  await expect(ws.getByText("2 محددة يدوياً")).toBeVisible();
  await ws.getByRole("button", { name: "إسناد المحدد (2)" }).click();

  const modal = page.getByRole("dialog", { name: "إسناد لموظف آخر" });
  await expect(modal).toContainText("2");
  await modal.getByRole("combobox", { name: /الموظف المستلم/ })
    .selectOption({ label: `${TO.displayName} (${TO.username})` });
  await modal.getByRole("textbox", { name: /سبب الإحالة/ }).fill("نقل جماعي ضمن اختبار آلي");
  await expect(modal).toContainText(`سيتم إرسال طلب إحالة 2 عينة إلى ${TO.username}`);
  await modal.getByRole("checkbox", { name: /أؤكد مراجعة الملخص/ }).check();
  await modal.getByRole("button", { name: "إرسال طلب الإحالة" }).click();

  await expect(modal).toHaveCount(0);
  await expect(ws.getByRole("status").filter({ hasText: "تم إرسال طلب إحالة" }))
    .toContainText(`2 عينة إلى ${TO.username}`);

  // Both rows are now waiting on the same approval queue.
  await openSubTab(page, "إدارة مساحة العمل", "اعتماد الطلبات", APPROVALS_READY(page));
  await expect(workspace(page).getByRole("tab", { name: "معلّق 1" })).toBeVisible();
});

test("a completed study cannot be selected for reassignment", async ({ page }) => {
  await openFromReviewersQueue(page);
  await tableSearch(page).fill(JALGAHAMDI_ROWS.submitted);
  const checkbox = findRow(page, JALGAHAMDI_ROWS.submitted).getByRole("checkbox");
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).toHaveAccessibleName(new RegExp("لا يمكن إسناد"));
});

test("an ordinary employee gets no bulk-reassign authority over other queues", async ({ page }) => {
  await gotoSim(page, "employee");
  await openTab(page, "إدارة مساحة العمل");
  // No scope picker at all, so there is nothing to reach across.
  await expect(workspace(page).getByRole("combobox", { name: "نطاق العرض" })).toHaveCount(0);
});
