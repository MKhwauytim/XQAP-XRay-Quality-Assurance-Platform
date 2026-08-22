import { expect, test } from "@playwright/test";
import { findRow, gotoSim, openTab, statToken, tableSearch, workspace } from "./helpers/app";
import { ASSIGNMENTS, JALGAHAMDI_ROWS, SAMPLE_ROWS, TEMPLATE_NAME } from "./helpers/seed";

/**
 * «صور الأشعة المحالة» — the reviewer's queue. This is the app's busiest
 * screen: personal stats, the three case chips, the oversight scope picker,
 * and the inspection panel that answers a study.
 */

const REVIEWER = ASSIGNMENTS[0]; // jalgahamdi, 34 rows

function panel(page: import("@playwright/test").Page) {
  return page.locator(".ew-xr-panel-col");
}

test.describe("reviewer's own queue", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSim(page, "employee");
    await openTab(page, "إدارة مساحة العمل");
    await expect(workspace(page).getByRole("heading", { name: "صور الأشعة المحالة" })).toBeVisible();
  });

  test("shows the reviewer's own assignment count and the seeded answer split", async ({ page }) => {
    // 34 assigned; the 5-slot seed cycle leaves 14 submitted and 20 not finished.
    await expect(statToken(page, "الإجمالي")).toHaveText(`الإجمالي${REVIEWER.count}`);
    await expect(statToken(page, "مكتملة")).toHaveText("مكتملة14");
    await expect(statToken(page, "لم تبدأ")).toHaveText("لم تبدأ20");
    await expect(statToken(page, "نسبة الإنجاز")).toHaveText("نسبة الإنجاز41%");
    await expect(workspace(page).getByRole("button", { name: `جميع الحالات ${REVIEWER.count}` })).toBeVisible();
  });

  test("the active inspection template is named in the header", async ({ page }) => {
    await expect(workspace(page).getByText(`${TEMPLATE_NAME} (v1)`)).toBeVisible();
  });

  test("the three case chips carry counts and filter the queue", async ({ page }) => {
    const chips = workspace(page).getByRole("group", { name: "تصفية الحالات" });
    const all = chips.getByRole("button", { name: `جميع الحالات ${REVIEWER.count}` });
    const engine = chips.getByRole("button", { name: "مستهدف المؤشر 9" });
    const exceptional = chips.getByRole("button", { name: "حالات استثنائية 0" });

    await expect(all).toHaveAttribute("aria-pressed", "true");
    await expect(engine).toBeVisible();
    await expect(exceptional).toBeVisible();

    await engine.click();
    await expect(engine).toHaveAttribute("aria-pressed", "true");
    await expect(workspace(page).getByRole("row")).toHaveCount(9 + 1); // + header row

    await exceptional.click();
    // No ad-hoc rows in the seed: the chip must say so rather than show a bare header.
    await expect(workspace(page).getByRole("status").first()).toBeVisible();

    await all.click();
    await expect(all).toHaveAttribute("aria-pressed", "true");
  });

  test("the oversight scope picker is hidden from an ordinary employee", async ({ page }) => {
    await expect(workspace(page).getByRole("combobox", { name: "نطاق العرض" })).toHaveCount(0);
  });

  test("opening a row shows the inspection form for that x-ray", async ({ page }) => {
    await tableSearch(page).fill(JALGAHAMDI_ROWS.untouched);
    await findRow(page, JALGAHAMDI_ROWS.untouched).click();

    await expect(panel(page)).toContainText(JALGAHAMDI_ROWS.untouched);
    await expect(panel(page)).toContainText("0 من 2 حقول مطلوبة");
    await expect(panel(page).getByRole("group", { name: "نتيجة مراجعة الصورة" })).toBeVisible();
    await expect(panel(page).getByRole("group", { name: "نتيجة التفتيش" })).toBeVisible();
  });

  test("a seeded draft reopens with its saved values still filled in", async ({ page }) => {
    await tableSearch(page).fill(JALGAHAMDI_ROWS.draft);
    await findRow(page, JALGAHAMDI_ROWS.draft).click();

    await expect(panel(page)).toContainText("2 من 2 حقول مطلوبة");
    await expect(
      panel(page).getByRole("group", { name: "نتيجة التفتيش" }).getByRole("button", { name: "سليمة" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("submitting without the required fields is refused", async ({ page }) => {
    await tableSearch(page).fill(JALGAHAMDI_ROWS.untouched);
    await findRow(page, JALGAHAMDI_ROWS.untouched).click();

    await panel(page).getByRole("button", { name: "تقديم الفحص" }).click();

    // Still editable, still not submitted.
    await expect(panel(page).getByRole("button", { name: "تقديم الفحص" })).toBeVisible();
    await expect(panel(page)).toContainText("قيد التحرير");
  });

  test("answering, submitting, and the row becoming completed", async ({ page }) => {
    await expect(statToken(page, "مكتملة")).toHaveText("مكتملة14");

    await tableSearch(page).fill(JALGAHAMDI_ROWS.untouched);
    await findRow(page, JALGAHAMDI_ROWS.untouched).click();

    await panel(page).getByRole("group", { name: "نتيجة مراجعة الصورة" })
      .getByRole("button", { name: "اشتباه" }).click();
    await panel(page).getByRole("group", { name: "نتيجة التفتيش" })
      .getByRole("button", { name: "سليمة" }).click();
    await panel(page).getByRole("textbox", { name: "ملاحظات" }).fill("ملاحظة من اختبار آلي");
    await expect(panel(page)).toContainText("2 من 2 حقول مطلوبة");

    await panel(page).getByRole("button", { name: "تقديم الفحص" }).click();

    // The panel flips to the read-only summary of what was submitted…
    await expect(panel(page)).toContainText("مقدم");
    await expect(panel(page).getByRole("button", { name: "تقديم الفحص" })).toHaveCount(0);
    await expect(panel(page)).toContainText("ملاحظة من اختبار آلي");
    await expect(panel(page).getByRole("button", { name: "طلب إعادة فتح الحالة" })).toBeVisible();

    // …and the personal stats count the study as done: 14 → 15, 20 → 19.
    await expect(statToken(page, "مكتملة")).toHaveText("مكتملة15");
    await expect(statToken(page, "لم تبدأ")).toHaveText("لم تبدأ19");

    // The row itself is now marked completed in the queue.
    await expect(findRow(page, JALGAHAMDI_ROWS.untouched)).toHaveClass(/dt-tr--completed/);
  });
});

test.describe("oversight scope picker", () => {
  test.beforeEach(async ({ page }) => {
    await gotoSim(page, "supervisor");
    await openTab(page, "إدارة مساحة العمل");
    await expect(workspace(page).getByRole("heading", { name: "صور الأشعة المحالة" })).toBeVisible();
  });

  test("offers every reviewer, and the per-employee counts sum to the drawn sample", async ({ page }) => {
    const picker = workspace(page).getByRole("combobox", { name: "نطاق العرض" });
    await expect(picker).toBeVisible();

    await expect(picker.getByRole("option", { name: `الكل — جميع الموظفين (${SAMPLE_ROWS})` })).toBeAttached();
    let sum = 0;
    for (const reviewer of ASSIGNMENTS) {
      const label = new RegExp(`^${reviewer.displayName}.*\\(${reviewer.count}\\)$`);
      await expect(picker.getByRole("option", { name: label })).toBeAttached();
      sum += reviewer.count;
    }
    expect(sum).toBe(SAMPLE_ROWS);
  });

  test("picking another reviewer swaps the queue to that reviewer's rows", async ({ page }) => {
    const ws = workspace(page);
    await ws.getByRole("combobox", { name: "نطاق العرض" })
      .selectOption({ label: `${REVIEWER.displayName} (${REVIEWER.count})` });

    await expect(ws.getByRole("button", { name: `جميع الحالات ${REVIEWER.count}` })).toBeVisible();
    await tableSearch(page).fill(JALGAHAMDI_ROWS.submitted);
    await expect(findRow(page, JALGAHAMDI_ROWS.submitted)).toBeVisible();
  });
});
