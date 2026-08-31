import { expect, test, type Page } from "@playwright/test";
import { gotoSim, openSubTab, workspace } from "./helpers/app";
import { BROWSE_READY, REFERRALS_READY, RESULTS_READY } from "./helpers/sections";

/**
 * Column pickers: that every data table has one, and that the popover it opens
 * can actually be scrolled.
 *
 * Both claims are about rendered geometry and event handling, so both are
 * measured in Chromium. The unit suite covers the mechanism (which scroll
 * events `AnchoredPopover` reacts to, what it divides its offsets by); it
 * cannot cover the consequences, because jsdom performs no layout — nothing
 * overflows there, so the very condition these tests create does not exist.
 */

/** The picker on Population → «استعراض البيانات», which has the most columns. */
async function openBrowsePicker(page: Page) {
  await openSubTab(page, "إدارة بيانات الأشعة", "استعراض البيانات", BROWSE_READY(page));
  await workspace(page).getByRole("button", { name: /^الأعمدة/ }).click();
  const popover = page.locator(".bv-col-picker-dropdown");
  await expect(popover).toBeVisible();
  return popover;
}

test.describe("column-picker popover", () => {
  test("scrolls its own content instead of snapping back to the top", async ({ page }) => {
    // Short enough that the picker cannot fit — 1136px of options in ~276px.
    await page.setViewportSize({ width: 1280, height: 620 });
    await gotoSim(page, "admin");
    const popover = await openBrowsePicker(page);

    const overflow = await popover.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow).toBeGreaterThan(100);

    // The bug: `position()` clears the max-height clamp to re-measure, which
    // un-overflows the box and makes Chromium reset scrollTop to 0. Because a
    // capture-phase listener also caught the popover's OWN scroll event, every
    // wheel notch put the user straight back at the top and the lower options
    // were unreachable.
    await popover.hover();
    await page.mouse.wheel(0, 300);
    await expect.poll(() => popover.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    // And it reaches the end, rather than stalling part-way.
    await popover.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => popover.evaluate((el) => el.scrollTop)).toBe(overflow);
  });

  test("still opens against its anchor when the UI is scaled down", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 620 });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key as string, value as string),
      ["xray_ui_scale_v1", JSON.stringify({ scale: 0.7, tableHeight: 1 })] as const,
    );
    await gotoSim(page, "admin");
    // Opened for its side effect; the geometry is read from the DOM below.
    await openBrowsePicker(page);

    const geometry = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        b.textContent?.trim().startsWith("الأعمدة"),
      )!;
      const anchor = button.getBoundingClientRect();
      const pop = document.querySelector(".bv-col-picker-dropdown")!.getBoundingClientRect();
      return {
        anchorBottom: anchor.bottom, anchorLeft: anchor.left, anchorRight: anchor.right,
        popTop: pop.top, popLeft: pop.left, popRight: pop.right,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      };
    });

    // `getBoundingClientRect` reports device pixels while `style.top` is read as
    // CSS pixels and then multiplied by the zoom, so an uncorrected popover
    // landed at 0.7× its intended position — above and across the button it
    // belongs to. Measured before the fix: anchor bottom 231, popover top 166.
    expect(geometry.popTop).toBeGreaterThanOrEqual(geometry.anchorBottom - 1);
    expect(geometry.popTop).toBeLessThan(geometry.anchorBottom + 40);
    // Horizontally it must simply still be ON the button rather than shifted
    // away from it, and fully on screen. A tighter edge assertion would be
    // pinning `align: "end"`'s RTL edge convention, which is `anchoredPosition`'s
    // own unit-tested business, not this test's.
    expect(geometry.popRight).toBeGreaterThan(geometry.anchorLeft);
    expect(geometry.popLeft).toBeLessThan(geometry.anchorRight);
    expect(geometry.popLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.popRight).toBeLessThanOrEqual(geometry.viewportWidth);
  });
});

test.describe("every data table can choose its columns", () => {
  test("«نتائج فحص الأشعة» has a column picker", async ({ page }) => {
    await gotoSim(page, "supervisor");
    await openSubTab(page, "إدارة مساحة العمل", "نتائج فحص الأشعة", RESULTS_READY(page));

    const columns = workspace(page).getByRole("button", { name: /^الأعمدة/ });
    await expect(columns).toBeVisible();
    await columns.click();
    await expect(page.getByRole("dialog", { name: "الأعمدة" })).toBeVisible();
  });

  test("hiding a column in «نتائج فحص الأشعة» actually removes it", async ({ page }) => {
    await gotoSim(page, "supervisor");
    await openSubTab(page, "إدارة مساحة العمل", "نتائج فحص الأشعة", RESULTS_READY(page));

    const ws = workspace(page);
    await expect(ws.getByRole("columnheader", { name: /المنفذ/ })).toBeVisible();

    await ws.getByRole("button", { name: /^الأعمدة/ }).click();
    const picker = page.getByRole("dialog", { name: "الأعمدة" });
    await picker
      .locator(".dt-col-item", { hasText: "المنفذ" })
      .first()
      .getByRole("button")
      .click();

    await expect(ws.getByRole("columnheader", { name: /المنفذ/ })).toHaveCount(0);
  });
});

/**
 * Sticky columns («صور الأشعة المحالة» pins the select checkbox + معرف الأشعة
 * on the RTL start edge) pin themselves via a `right` offset computed from the
 * OTHER visible columns' rendered widths. `.dt-table` deliberately uses
 * `table-layout: auto` (widthFr is a preference, not a hard percentage — see
 * DataTable.css), so that offset has to come from real DOM measurement, not
 * from the widthFr percentages: a table reordered or given more columns
 * changes what actually renders before a sticky column without changing that
 * column's own share, and a stale/percentage-based offset then pins the
 * sticky header (and its body cells) on top of whatever now actually occupies
 * that space. Only Chromium can show this — jsdom performs no table layout,
 * so nothing here would ever overlap there.
 */
test.describe("sticky columns stay aligned after the column set changes", () => {
  test("no header cell overlaps another after a column is dragged ahead of the sticky ones", async ({ page }) => {
    await gotoSim(page, "admin");
    await openSubTab(page, "إدارة مساحة العمل", "صور الأشعة المحالة", REFERRALS_READY(page));
    const ws = workspace(page);

    // Widen the column set first — matches the reported repro ("adding or
    // moving columns") and gives the layout more columns to actually diverge on.
    await ws.getByRole("button", { name: /^الأعمدة/ }).click();
    const picker = page.getByRole("dialog", { name: "الأعمدة" });
    await expect(picker).toBeVisible();
    const hiddenItems = picker.locator(".dt-col-item.dt-col-hidden");
    const toAdd = Math.min(3, await hiddenItems.count());
    for (let i = 0; i < toAdd; i++) {
      await hiddenItems.first().getByRole("button").click();
    }
    await page.keyboard.press("Escape");

    const headers = ws.locator("th.dt-th");
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThanOrEqual(4);

    // Drag the LAST header still fully on-screen to the very first position —
    // ahead of every sticky column, the exact shape of the bug. Deliberately
    // NOT the table's actual last column: with this many columns the table
    // overflows the viewport, and Playwright's dragTo() auto-scrolls an
    // off-screen source/target into view mid-drag, which is its own source of
    // flakiness unrelated to the app. Restricting the drag to two cells that
    // are already both on-screen keeps the test about the app's layout, not
    // about drag-and-drop-across-a-scroll automation mechanics.
    const wrapBox = (await ws.locator(".dt-table-wrap").boundingBox())!;
    const visibleIdxs: number[] = [];
    for (let i = 0; i < headerCount; i += 1) {
      const box = await headers.nth(i).boundingBox();
      if (box && box.x >= wrapBox.x && box.x + box.width <= wrapBox.x + wrapBox.width) visibleIdxs.push(i);
    }
    expect(visibleIdxs.length).toBeGreaterThanOrEqual(2);
    await headers.nth(visibleIdxs[visibleIdxs.length - 1]!).dragTo(headers.nth(visibleIdxs[0]!));

    const overlaps = await page.evaluate(() => {
      const rects = Array.from(document.querySelectorAll("th.dt-th")).map((th) => {
        const r = th.getBoundingClientRect();
        return { label: th.querySelector(".dt-th-label")?.textContent ?? "(checkbox)", left: r.left, right: r.right };
      });
      const found: string[] = [];
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]!, b = rects[j]!;
          const overlapPx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          if (overlapPx > 1) found.push(`${a.label} <-> ${b.label}: ${overlapPx.toFixed(1)}px`);
        }
      }
      return found;
    });
    expect(overlaps, `overlapping header cells: ${overlaps.join(", ")}`).toEqual([]);
  });
});
