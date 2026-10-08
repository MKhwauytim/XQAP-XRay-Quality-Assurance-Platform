/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DECK_TEXT_EDIT_SCRIPT,
  DECK_TEXT_TEMPLATE_MESSAGE,
  inlineJson,
  sanitizeEntries,
  textEditBarHtml,
  textEditDataHtml,
} from "./textEdit";
import { buildDeckV3Html } from "./index";

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.body.className = "";
  Object.defineProperty(window, "opener", { value: null, configurable: true });
  vi.restoreAllMocks();
});

const SLIDES = `
<section class="slide v3" data-section="s1" data-section-label="أ"><h2 class="v3-h2">العنوان الأول</h2><p>نص <b>غامق</b></p><footer><span class="v3-page-num">01 / 2</span></footer></section>
<section class="slide v3" data-section="s1" data-section-label="أ"><h2 class="v3-h2">العنوان الثاني</h2><svg><text>رسم</text></svg></section>`;

function mount(entries: unknown): void {
  document.body.innerHTML = `${textEditBarHtml()}${SLIDES}${textEditDataHtml(entries as never)}`;
  new Function(DECK_TEXT_EDIT_SCRIPT)();
}

function click(id: string): void {
  (document.getElementById(id) as HTMLButtonElement).click();
}

describe("sanitizeEntries", () => {
  it("keeps well-formed entries and drops everything else", () => {
    expect(
      sanitizeEntries({
        "s1|0|0": { from: "a", to: "b" },
        "bad key": { from: "a", to: "b" },
        "s1|0|1": { from: "same", to: "same" },
        "s1|0|2": { from: 1, to: "b" },
        "s1|0|3": "nope",
      }),
    ).toEqual({ "s1|0|0": { from: "a", to: "b" } });
    expect(sanitizeEntries(null)).toEqual({});
    expect(sanitizeEntries("x")).toEqual({});
  });

  it("drops over-long text", () => {
    expect(sanitizeEntries({ "s1|0|0": { from: "a", to: "x".repeat(2001) } })).toEqual({});
  });
});

describe("inlineJson", () => {
  it("cannot close the surrounding script element", () => {
    const out = inlineJson({ t: "</script><b>" });
    expect(out).not.toContain("</script>");
    expect(JSON.parse(out)).toEqual({ t: "</script><b>" });
  });
});

describe("in-viewer edit script", () => {
  it("applies a template entry only where the original text still matches", () => {
    mount({
      "s1|0|0": { from: "العنوان الأول", to: "عنوان معدّل" },
      "s1|1|0": { from: "نص مختلف تماماً", to: "لن يُطبَّق" },
    });
    const titles = Array.from(document.querySelectorAll("h2")).map((h) => h.textContent);
    expect(titles).toEqual(["عنوان معدّل", "العنوان الثاني"]);
  });

  it("makes only leaf text editable (not page numbers, svg text, or mixed elements)", () => {
    mount({});
    click("ed-toggle");
    const editable = Array.from(document.querySelectorAll("[contenteditable]")).map((e) => e.textContent);
    expect(editable).toEqual(["العنوان الأول", "غامق", "العنوان الثاني"]);
    expect(document.body.classList.contains("deck-editing")).toBe(true);
    expect((document.getElementById("ed-save") as HTMLButtonElement).hidden).toBe(false);
    click("ed-toggle");
    expect(document.querySelectorAll("[contenteditable]").length).toBe(0);
  });

  it("posts only the changed leaves, with original and new text, to the opener", () => {
    const post = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage: post, closed: false }, configurable: true });
    vi.spyOn(window, "prompt").mockReturnValue("  قالب الاختبار ");
    mount({});
    click("ed-toggle");
    const h2 = document.querySelector("h2") as HTMLElement;
    h2.textContent = "نص جديد";
    h2.dispatchEvent(new Event("input", { bubbles: true }));
    click("ed-save");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toEqual({
      type: DECK_TEXT_TEMPLATE_MESSAGE,
      name: "قالب الاختبار",
      entries: { "s1|0|0": { from: "العنوان الأول", to: "نص جديد" } },
    });
  });

  it("posts nothing when nothing changed, and reset restores the original text", () => {
    const post = vi.fn();
    Object.defineProperty(window, "opener", { value: { postMessage: post, closed: false }, configurable: true });
    const prompt = vi.spyOn(window, "prompt");
    mount({});
    click("ed-toggle");
    click("ed-save");
    expect(prompt).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    const h2 = document.querySelector("h2") as HTMLElement;
    h2.textContent = "تغيير";
    click("ed-reset");
    expect(h2.textContent).toBe("العنوان الأول");
  });
});

describe("deck3 page", () => {
  it("ships the edit toolbar, the inlined template, and the edit script", () => {
    const html = buildDeckV3Html(SLIDES, "فبراير 2026", {}, "", { "s1|0|0": { from: "a", to: "b" } });
    expect(html).toContain('id="ed-toggle"');
    expect(html).toContain('id="deck-text-template"');
    expect(html).toContain('"s1|0|0"');
    expect(html).toContain("xray-deck-template-save");
  });
});
