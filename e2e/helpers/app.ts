import { expect, type Locator, type Page } from "@playwright/test";

export type SimRole = "guest" | "employee" | "supervisor" | "manager" | "admin";

/**
 * Load the app with the writable simulated workspace mounted and the given
 * role auto-signed-in.
 *
 * Readiness is asserted, never slept on: the sim banner proves the page really
 * is the simulation, and the sidebar's tab navigation proves the workspace
 * finished seeding and the authenticated shell has rendered. A role with no
 * granted tabs (`guest`) still renders that navigation element — empty.
 */
export async function gotoSim(
  page: Page,
  role: SimRole = "admin",
  extraQuery: Record<string, string> = {},
): Promise<void> {
  const params = new URLSearchParams({ sim: "1", role, ...extraQuery });
  await page.goto(`/?${params.toString()}`);
  await expect(page.locator("[data-sim-banner]")).toHaveText(
    "بيانات محاكاة للتطوير فقط — SIMULATED DATA, NOT REAL",
  );
  await expect(page.getByRole("navigation", { name: "تبويبات النظام" })).toBeAttached();
  // The workspace chip only carries the simulated handle's name once the
  // provider has mounted it, so this is also the "workspace is up" signal.
  await expect(sidebar(page).getByText("Simulated-Workspace")).toBeVisible();
}

/** The sidebar rail: month selector, workspace chip, tab tree, identity, logout. */
export function sidebar(page: Page): Locator {
  return page.getByRole("complementary", { name: "القائمة الجانبية" });
}

/** The main content region every tab renders into. */
export function workspace(page: Page): Locator {
  return page.getByRole("region", { name: "مساحة العمل" });
}

/** Click a top-level tab or one of its sub-tabs in the sidebar rail. */
export async function openTab(page: Page, name: string): Promise<void> {
  await sidebar(page).getByRole("button", { name, exact: true }).click();
}

/**
 * Open a top-level tab and then one of its sub-tabs, and wait until that
 * sub-tab's own content is on screen.
 *
 * `ready` is not defensive padding — it is the only trustworthy signal.
 * Sub-tab selection is a fire-and-forget `window` CustomEvent
 * (`pop-set-subtab`, dispatched by `Sidebar.handleSubTabClick`) that a tab
 * component only listens for once it has mounted, while the rail's own
 * `aria-current` is set synchronously by the click. Click a sub-tab of a tab
 * that is not mounted yet — which is what happens on the first visit to a lazy
 * tab — and the event is dropped: the rail highlights what you clicked and the
 * content shows the parent's DEFAULT sub-tab. That is a real app bug (see
 * docs/development/E2E_TESTS.md § "Bugs this suite found"), so the click is
 * retried until the content agrees rather than trusted once.
 */
export async function openSubTab(
  page: Page,
  parent: string,
  child: string,
  ready: Locator,
): Promise<void> {
  await openTab(page, parent);
  const sub = page
    .getByRole("navigation", { name: "تبويبات النظام" })
    .getByRole("button", { name: child, exact: true });
  await expect(sub).toBeVisible();

  await expect(async () => {
    await sub.click();
    await expect(ready).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

/** The shared DataTable's free-text filter, scoped to the active tab. */
export function tableSearch(page: Page): Locator {
  return workspace(page).getByRole("textbox", { name: "بحث في جميع الأعمدة..." });
}

/**
 * Narrow a DataTable to a single known row and return that row.
 *
 * Search rather than nth-child: the queue's default order is an implementation
 * detail, but "the row whose id is X" is the thing every spec actually means.
 */
export function findRow(page: Page, xrayImageId: string): Locator {
  return workspace(page).getByRole("row").filter({
    has: page.getByRole("cell", { name: xrayImageId, exact: true }),
  });
}

/**
 * Paste a TSV block into an element that listens for `paste` (the ad-hoc
 * import's drop zone is a focusable div, not a textarea, so `fill` cannot
 * reach it and `keyboard.press('Control+V')` would need a populated system
 * clipboard the headless runner does not have).
 */
export async function pasteInto(page: Page, selector: string, tsv: string): Promise<void> {
  await page.locator(selector).waitFor();
  await page.evaluate(
    ({ sel, text }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`paste target not found: ${sel}`);
      const data = new DataTransfer();
      data.setData("text/plain", text);
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { sel: selector, text: tsv },
  );
}

/**
 * One tile of the reviewer's stats strip, e.g. `statToken(page, "مكتملة")`.
 *
 * The tiles are `<em>label</em><strong>value</strong>` pairs with no accessible
 * name of their own, so there is no role query that can name one. Rather than
 * add a test-only attribute to production markup this reaches for the
 * component's own class name and filters by the visible label — structural,
 * but not invented for the test.
 */
export function statToken(page: Page, label: string): Locator {
  return page
    .getByRole("region", { name: "إحصائياتي" })
    .locator(".ew-ref-stat-token")
    .filter({ has: page.getByText(label, { exact: true }) });
}
