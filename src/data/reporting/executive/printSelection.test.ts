/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { buildDeckV2Html } from "./deck2";
import { buildDeckV3Html } from "./deck3";
import { PRINT_SELECT_CSS, PRINT_SELECT_SCRIPT, printSelectBarHtml } from "./printSelection";

function mount(slideCount: number, withExistingToggleOn: number[] = []): void {
  document.title = "تقرير اختبار";
  const slides = Array.from({ length: slideCount }, (_, i) => {
    const ctl = withExistingToggleOn.includes(i)
      ? `<div class="slide-controls"><label class="slide-print-toggle"><input type="checkbox" checked/></label></div>`
      : "";
    return `<section class="slide" id="s${i}">${ctl}</section>`;
  }).join("");
  document.body.innerHTML = `<div class="deck-toolbar-actions">${printSelectBarHtml()}</div>${slides}`;
}

function run(): void {
  new Function(PRINT_SELECT_SCRIPT)();
}

const off = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".slide[data-print-off]")).map((s) => s.id);

describe("print selection", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("CSS hides excluded slides and the controls in print only", () => {
    const print = PRINT_SELECT_CSS.slice(PRINT_SELECT_CSS.indexOf("@media print"));
    expect(print).toContain(".slide[data-print-off]{display:none!important;}");
    expect(print).toContain(".ps-bar,.slide-controls{display:none!important;}");
    expect(PRINT_SELECT_CSS.slice(0, PRINT_SELECT_CSS.indexOf("@media print"))).not.toContain("data-print-off");
  });

  it("both deck editions wire the bar, CSS and script", () => {
    for (const html of [buildDeckV2Html("", "x"), buildDeckV3Html("", "x")]) {
      expect(html).toContain('id="ps-bar"');
      expect(html).toContain(".slide[data-print-off]{display:none!important;}");
      expect(html).toContain("xray_print_sel_v1");
    }
  });

  it("bar uses Arabic labels from the label store", () => {
    const html = printSelectBarHtml();
    expect(html).toContain("تحديد كل الصفحات");
    expect(html).toContain("إلغاء تحديد الكل");
  });

  it("injects a toggle into slides that lack one and reuses existing ones", () => {
    mount(3, [1]);
    run();
    expect(document.querySelectorAll(".slide-print-toggle input")).toHaveLength(3);
    expect(document.querySelectorAll("#s1 .slide-print-toggle")).toHaveLength(1);
  });

  it("unchecking a toggle marks the slide excluded, rechecking restores it", () => {
    mount(3);
    run();
    const box = document.querySelector<HTMLInputElement>("#s2 .slide-print-toggle input")!;
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(off()).toEqual(["s2"]);
    expect(document.getElementById("ps-count")!.textContent).toBe("2 / 3");
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    expect(off()).toEqual([]);
  });

  it("select none / select all", () => {
    mount(4);
    run();
    document.getElementById("ps-none")!.click();
    expect(off()).toHaveLength(4);
    document.getElementById("ps-all")!.click();
    expect(off()).toHaveLength(0);
  });

  it("persists the selection and restores it on the next open", () => {
    mount(3);
    run();
    document.getElementById("ps-none")!.click();
    const first = document.querySelector<HTMLInputElement>("#s0 .slide-print-toggle input")!;
    first.checked = true;
    first.dispatchEvent(new Event("change", { bubbles: true }));
    mount(3);
    run();
    expect(off()).toEqual(["s1", "s2"]);
    expect(document.querySelector<HTMLInputElement>("#s0 .slide-print-toggle input")!.checked).toBe(true);
  });

  it("still works when localStorage throws", () => {
    mount(2);
    const real = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
    try {
      expect(() => run()).not.toThrow();
      document.getElementById("ps-none")!.click();
      expect(off()).toHaveLength(2);
    } finally {
      Object.defineProperty(window, "localStorage", real);
    }
  });
});
