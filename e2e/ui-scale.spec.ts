import { expect, test, type Page } from "@playwright/test";
import { gotoSim, openTab, workspace } from "./helpers/app";

/**
 * «مقياس الواجهة» — the app-wide UI scale, measured in a real browser.
 *
 * This feature is a claim about LAYOUT, and layout claims are exactly the kind
 * this repo has shipped wrong from a green unit suite before: `uiScaleStore`'s
 * own tests prove a number reaches a CSS custom property, and prove nothing at
 * all about whether the page then fits the screen. Everything below is measured
 * off real rendered geometry in Chromium.
 *
 * The two properties that matter, and why:
 *
 *  1. **No dead band.** `zoom` scales `vh`-derived heights along with everything
 *     else, so a raw `100vh` under `zoom: 0.7` renders at 70 % of the viewport
 *     and leaves a third of the screen empty. `--app-vh` divides that back out.
 *     If this regresses, the app looks broken at every scale but 100 %.
 *
 *  2. **More horizontal room.** This is the whole point of the feature — the
 *     reviewer's queue («صور الأشعة المحالة») is the screen that scrolls
 *     sideways, and scaling down must measurably reduce how far.
 */

const SCALE_KEY = "xray_ui_scale_v1";

/** Seed the stored preference, then load — this exercises the real boot path. */
async function gotoSimWithScale(page: Page, scale: number, tableHeight = 1): Promise<void> {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key as string, value as string),
    [SCALE_KEY, JSON.stringify({ scale, tableHeight })] as const,
  );
  await gotoSim(page, "employee");
}

async function openQueue(page: Page): Promise<void> {
  await openTab(page, "إدارة مساحة العمل");
  await expect(workspace(page).getByRole("heading", { name: "صور الأشعة المحالة" })).toBeVisible();
}

/** How far the queue table still has to scroll sideways, in device pixels. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.locator(".dt-table-wrap").first().evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
}

test.describe("UI scale", () => {
  test("at 100% the shell fills the viewport and the page does not scroll sideways", async ({ page }) => {
    await gotoSim(page, "employee");
    await openQueue(page);

    const metrics = await page.evaluate(() => ({
      shell: document.querySelector(".app-shell")!.getBoundingClientRect().height,
      viewport: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    }));

    expect(metrics.shell).toBeGreaterThanOrEqual(metrics.viewport - 2);
    // The body must never scroll horizontally; only the table may.
    expect(metrics.docScrollWidth).toBeLessThanOrEqual(metrics.docClientWidth + 1);
  });

  test("scaled down, the shell STILL fills the viewport — no dead band from vh", async ({ page }) => {
    await gotoSimWithScale(page, 0.7);
    await openQueue(page);

    const metrics = await page.evaluate(() => ({
      // getBoundingClientRect reports post-zoom device pixels, which is exactly
      // what "does the user see empty space" needs.
      shell: document.querySelector(".app-shell")!.getBoundingClientRect().height,
      viewport: window.innerHeight,
      appliedScale: getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
    }));

    expect(metrics.appliedScale).toBe("0.7");
    // The regression this pins: with a raw `100vh` the shell would come back at
    // ~0.7 × viewport and a third of the screen would be blank.
    expect(metrics.shell).toBeGreaterThanOrEqual(metrics.viewport - 2);
  });

  test("scaling down gives the queue measurably more horizontal room", async ({ page }) => {
    await gotoSim(page, "employee");
    await openQueue(page);
    const before = await horizontalOverflow(page);

    await gotoSimWithScale(page, 0.7);
    await openQueue(page);
    const after = await horizontalOverflow(page);

    // Not a fixed number — column widths follow content, and pinning an exact
    // pixel count would make this test about the seed data instead of about
    // the feature. The direction and the fact that it MOVED are the claim.
    expect(after).toBeLessThan(before);
  });

  test("the table-height control shortens the table's scroll viewport", async ({ page }) => {
    await gotoSim(page, "employee");
    await openQueue(page);
    const fullHeight = await page.locator(".dt-table-wrap").first().evaluate(
      (el) => el.getBoundingClientRect().height,
    );

    await gotoSimWithScale(page, 1, 0.6);
    await openQueue(page);
    const shortHeight = await page.locator(".dt-table-wrap").first().evaluate(
      (el) => el.getBoundingClientRect().height,
    );

    // Shorter table ⇒ whatever sits below it comes back above the fold, which
    // is the reported complaint («the buttons are off-screen, I have to scroll
    // down»).
    expect(shortHeight).toBeLessThan(fullHeight);
  });

  test("the Settings slider applies live and the reset button restores 100%", async ({ page }) => {
    await gotoSim(page, "admin");
    await openTab(page, "إدارة الإعدادات");

    await workspace(page).getByRole("button", { name: /مقياس الواجهة/ }).click();
    const slider = workspace(page).getByRole("slider", { name: "حجم الواجهة" });
    await expect(slider).toBeVisible();

    await slider.fill("0.8");
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
        ),
      )
      .toBe("0.8");
    // Persisted immediately — there is no save step, so a drag that ends
    // anywhere is already stored.
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), SCALE_KEY))
      .toContain("0.8");

    await workspace(page).getByRole("button", { name: /إعادة الضبط/ }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--ui-scale").trim(),
        ),
      )
      .toBe("1");
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), SCALE_KEY))
      .toBeNull();
  });
});
