import { expect, test, type Page } from "@playwright/test";
import { gotoSim, openSubTab, pasteInto, workspace } from "./helpers/app";
import { ADHOC_READY, REFERRALS_READY } from "./helpers/sections";
import { ASSIGNMENTS } from "./helpers/seed";

/**
 * «ارفاق حالات استثنائية» — the ad-hoc import wizard.
 *
 * Three steps: source → column mapping → review & assign. The mapping step is
 * the interesting one: a field is selected in the left rail and then bound by
 * clicking a column header in the grid, and two result fields are mandatory.
 *
 * The paste path is driven by dispatching a real `paste` event with a
 * DataTransfer (see `pasteInto`): the drop zone is a focusable div, not a
 * textarea, so `fill()` cannot reach it and the headless runner has no system
 * clipboard for `Control+V` to read.
 */

const PASTE_ZONE = ".amw-paste-zone";

/** Two columns deliberately named so the auto-mapper cannot guess them. */
const TSV = [
  "معرف الأشعة\tالمنفذ\tتاريخ الدخول\tرقم اللوحة\tL1\tL2",
  "ADHOC-001\tميناء جدة الإسلامي\t2026-06-01\tPLT-9001\tسليمة\tسليمة",
  "ADHOC-002\tميناء الدمام\t2026-06-02\tPLT-9002\tاشتباه\tاشتباه",
  "ADHOC-003\tمنفذ البطحاء\t2026-06-03\tPLT-9003\tسليمة\tاشتباه",
  "ADHOC-004\tمطار الملك خالد\t2026-06-04\tPLT-9004\tاشتباه\tسليمة",
].join("\n");

async function startPastedImport(page: Page, importKind?: string): Promise<void> {
  await gotoSim(page, "admin");
  await openSubTab(page, "إدارة بيانات الأشعة", "ارفاق حالات استثنائية", ADHOC_READY(page));
  await workspace(page).getByRole("button", { name: "استيراد جديد" }).click();
  await workspace(page).getByRole("radio", { name: "لصق من إكسل" }).check();
  await pasteInto(page, PASTE_ZONE, TSV);
  await expect(workspace(page).getByText("4 صف × 6 عمود")).toBeVisible();
  if (importKind) {
    await workspace(page).getByRole("combobox", { name: "نوع الاستيراد" }).selectOption({ label: importKind });
  }
  await workspace(page).getByRole("button", { name: "التالي", exact: true }).click();
}

/** The live assignment plan the wizard recomputes on every setting change. */
function preview(page: Page) {
  return workspace(page)
    .getByRole("region", { name: "التوزيع على الموظفين" })
    .getByRole("status")
    .filter({ hasText: "معاينة التوزيع" });
}

/** Bind the two mandatory result fields by clicking their column headers. */
async function mapResultColumns(page: Page): Promise<void> {
  const ws = workspace(page);
  await ws.getByRole("button", { name: "تحديد الحقل نتيجة المستوى الأول لربطه بعمود" }).click();
  await ws.getByRole("button", { name: "L1", exact: true }).click();
  await ws.getByRole("button", { name: "تحديد الحقل نتيجة المستوى الثاني لربطه بعمود" }).click();
  await ws.getByRole("button", { name: "L2", exact: true }).click();
}

test("the import list starts empty and offers a new import", async ({ page }) => {
  await gotoSim(page, "admin");
  await openSubTab(page, "إدارة بيانات الأشعة", "ارفاق حالات استثنائية", ADHOC_READY(page));
  await expect(workspace(page).getByRole("heading", { name: "ارفاق حالات استثنائية" })).toBeVisible();
  await expect(workspace(page).getByText("لا توجد عمليات استيراد بعد.")).toBeVisible();
  await expect(workspace(page).getByRole("button", { name: "استيراد جديد" })).toBeEnabled();
});

test("a pasted TSV is parsed, auto-mapped, and blocks on the mandatory result fields", async ({ page }) => {
  await startPastedImport(page);
  const ws = workspace(page);

  // The auto-mapper resolved the columns whose headers it recognises…
  // The binding is exposed as the header cell's accessible name, not as text.
  await expect(ws.getByRole("cell", { name: /مرتبط بـ معرف الأشعة/ })).toBeVisible();
  await expect(ws.getByRole("cell", { name: /مرتبط بـ رقم اللوحة\/الحاوية/ })).toBeVisible();
  // …and reports exactly what it could not resolve.
  await expect(ws.getByRole("status").filter({ hasText: "الحقل الإلزامي" }))
    .toContainText('الحقل الإلزامي "نتيجة المستوى الأول" غير مرتبط');
  await expect(ws.getByRole("button", { name: "التالي", exact: true })).toBeDisabled();
});

test("mapping the result columns by clicking headers unblocks the review step", async ({ page }) => {
  await startPastedImport(page);
  const ws = workspace(page);

  await mapResultColumns(page);
  await expect(ws.getByRole("cell", { name: /مرتبط بـ نتيجة المستوى الأول/ })).toBeVisible();
  await expect(ws.getByRole("cell", { name: /مرتبط بـ نتيجة المستوى الثاني/ })).toBeVisible();

  await ws.getByRole("button", { name: "التالي", exact: true }).click();
  await expect(ws.getByText("4 صف — 4 صالح، 0 غير صالح، 0 مستبعد يدوياً.")).toBeVisible();
  // The mapped values survived into the projected rows.
  await expect(ws.getByRole("row").filter({ hasText: "ADHOC-002" })).toContainText("اشتباه");
});

test.describe("assignment modes", () => {
  test.beforeEach(async ({ page }) => {
    await startPastedImport(page);
    await mapResultColumns(page);
    await workspace(page).getByRole("button", { name: "التالي", exact: true }).click();
    await expect(workspace(page).getByRole("region", { name: "التوزيع على الموظفين" })).toBeVisible();
  });

  test("offers all four modes and every seeded reviewer", async ({ page }) => {
    const dist = workspace(page).getByRole("region", { name: "التوزيع على الموظفين" });
    for (const mode of ["صفوف محددة لموظف", "عدد لكل موظف", "نسبة مئوية", "كل الصفوف لكل موظف"]) {
      await expect(dist.getByRole("radio", { name: mode })).toBeVisible();
    }
    const picker = dist.getByRole("combobox", { name: "تعيين إلى موظف" });
    for (const reviewer of ASSIGNMENTS) {
      await expect(picker.getByRole("option", { name: `${reviewer.displayName} (${reviewer.username})` })).toBeAttached();
    }
    await expect(dist).toContainText("الصفوف المؤهلة للتوزيع: 4");
  });

  test("mode: selected rows to one employee", async ({ page }) => {
    const ws = workspace(page);
    const dist = ws.getByRole("region", { name: "التوزيع على الموظفين" });
    await ws.getByRole("row").filter({ hasText: "ADHOC-001" }).getByRole("checkbox").first().check();
    await ws.getByRole("row").filter({ hasText: "ADHOC-003" }).getByRole("checkbox").first().check();
    await expect(ws.getByText("المحدد: 2")).toBeVisible();

    await dist.getByRole("radio", { name: "صفوف محددة لموظف" }).check();
    await dist.getByRole("combobox", { name: "تعيين إلى موظف" })
      .selectOption({ label: `${ASSIGNMENTS[0].displayName} (${ASSIGNMENTS[0].username})` });

    const preview = dist.getByRole("status").filter({ hasText: "معاينة التوزيع" });
    await expect(preview).toContainText("إجمالي التخصيصات: 2");
    await expect(preview).toContainText(`${ASSIGNMENTS[0].username}: 2`);
  });

  test("mode: a fixed count per employee", async ({ page }) => {
    const dist = workspace(page).getByRole("region", { name: "التوزيع على الموظفين" });
    await dist.getByRole("radio", { name: "عدد لكل موظف" }).check();
    await dist.getByRole("checkbox", { name: "اختيار الموظف jalgahamdi" }).check();
    await dist.getByRole("checkbox", { name: "اختيار الموظف hihaloraini" }).check();

    // Selecting nobody's count yet leaves the plan empty and says why.
    await expect(preview(page)).toContainText("لم يتم تحديد عدد صفوف لأي موظف");
    await expect(dist.getByRole("button", { name: "تنفيذ التوزيع" })).toBeDisabled();

    await dist.getByRole("spinbutton", { name: "عدد الصفوف للموظف jalgahamdi" }).fill("3");
    await dist.getByRole("spinbutton", { name: "عدد الصفوف للموظف hihaloraini" }).fill("1");
    await expect(preview(page)).toContainText("إجمالي التخصيصات: 4");
    await expect(preview(page)).toContainText("jalgahamdi: 3");
    await expect(preview(page)).toContainText("hihaloraini: 1");
  });

  test("mode: a percentage per employee splits the rows evenly by default", async ({ page }) => {
    const dist = workspace(page).getByRole("region", { name: "التوزيع على الموظفين" });
    await dist.getByRole("radio", { name: "نسبة مئوية" }).check();
    await dist.getByRole("checkbox", { name: "اختيار الموظف jalgahamdi" }).check();
    await dist.getByRole("checkbox", { name: "اختيار الموظف hihaloraini" }).check();

    await expect(preview(page)).toContainText("إجمالي التخصيصات: 4");
    await expect(preview(page)).toContainText("jalgahamdi: 2");
    await expect(preview(page)).toContainText("hihaloraini: 2");
  });

  test("mode: every row to every employee warns and duplicates the workload", async ({ page }) => {
    const dist = workspace(page).getByRole("region", { name: "التوزيع على الموظفين" });
    await dist.getByRole("radio", { name: "كل الصفوف لكل موظف" }).check();
    await expect(dist.getByRole("status").filter({ hasText: "وضع التكرار يضاعف حجم العمل" })).toBeVisible();

    await dist.getByRole("checkbox", { name: "اختيار الموظف jalgahamdi" }).check();
    await dist.getByRole("checkbox", { name: "اختيار الموظف hihaloraini" }).check();

    // 4 rows × 2 reviewers = 8 assignments over the same 4 rows.
    await expect(preview(page)).toContainText("إجمالي التخصيصات: 8");
    await expect(preview(page)).toContainText("الصفوف المشمولة: 4");
  });

  test("an executed and saved import reaches the reviewer's queue as exceptional cases", async ({ page }) => {
    const ws = workspace(page);
    const dist = ws.getByRole("region", { name: "التوزيع على الموظفين" });
    await dist.getByRole("radio", { name: "نسبة مئوية" }).check();
    await dist.getByRole("checkbox", { name: "اختيار الموظف jalgahamdi" }).check();
    await expect(preview(page)).toContainText("jalgahamdi: 4");

    await dist.getByRole("button", { name: "تنفيذ التوزيع" }).click();
    await ws.getByRole("button", { name: "حفظ الاستيراد" }).click();
    await expect(ws.getByRole("status").filter({ hasText: "تم حفظ الاستيراد" })).toContainText("4 صف");

    // The bridge into the regular distribution: her queue grows by 4 and the
    // «حالات استثنائية» chip — 0 in the seed — now counts exactly those rows.
    await openSubTab(page, "إدارة مساحة العمل", "صور الأشعة المحالة", REFERRALS_READY(page));
    await workspace(page).getByRole("combobox", { name: "نطاق العرض" })
      .selectOption({ label: `${ASSIGNMENTS[0].displayName} (${ASSIGNMENTS[0].count + 4})` });
    const chips = workspace(page).getByRole("group", { name: "تصفية الحالات" });
    await expect(chips.getByRole("button", { name: `جميع الحالات ${ASSIGNMENTS[0].count + 4}` })).toBeVisible();
    await expect(chips.getByRole("button", { name: "حالات استثنائية 4" })).toBeVisible();
  });

  test("saving the import puts it in the list of past imports", async ({ page }) => {
    const ws = workspace(page);
    await ws.getByRole("button", { name: "حفظ الاستيراد" }).click();
    await expect(ws.getByRole("status").filter({ hasText: "تم حفظ الاستيراد" })).toBeVisible();
    await ws.getByRole("button", { name: "رجوع للقائمة" }).click();
    await expect(ws.getByText("لا توجد عمليات استيراد بعد.")).toHaveCount(0);
    await expect(ws.getByRole("heading", { name: "عمليات الاستيراد السابقة" })).toBeVisible();
  });
});

test("the historical-study import kind is reachable and asks for its own mapping", async ({ page }) => {
  await startPastedImport(page, "دراسة سابقة مُجابة");
  await expect(workspace(page).getByRole("heading", { name: "مطابقة الأعمدة" })).toBeVisible();
});
