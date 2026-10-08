/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  TEXT_EDIT_SCRIPT,
  editAttr,
  isEditableText,
  sanitizeOverrides,
  textEditBarHtml,
  textOverridesJson,
} from "./textEdit";

describe("editAttr / isEditableText", () => {
  it("marks plain wording editable", () => {
    expect(editAttr("محتويات التقرير")).toBe(' data-edit="محتويات التقرير"');
  });

  it("locks anything containing a digit — Latin, Arabic-Indic or Persian", () => {
    expect(editAttr("القسم 1")).toBe("");
    expect(editAttr("الصفحة ٣")).toBe("");
    expect(editAttr("نسبة ۵")).toBe("");
    expect(isEditableText("56468 صورة")).toBe(false);
  });

  it("locks empty text and escapes markup in the key", () => {
    expect(editAttr("   ")).toBe("");
    expect(editAttr('a"<b>')).toBe(' data-edit="a&quot;&lt;b&gt;"');
  });

  it("encodes a line break as a character reference", () => {
    expect(editAttr("سطر\nثان")).toBe(' data-edit="سطر&#10;ثان"');
  });
});

describe("sanitizeOverrides", () => {
  it("keeps valid edits only", () => {
    expect(
      sanitizeOverrides({
        "المعجم": "  القاموس ",
        "القسم 1": "x",
        "نتائج": "نتائج 5",
        "مجتمع": "مجتمع",
        "خاطئ": 7,
      }),
    ).toEqual({ "المعجم": "القاموس" });
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides("x")).toEqual({});
  });
});

describe("textOverridesJson", () => {
  it("cannot close its own script tag", () => {
    const html = textOverridesJson({ "المعجم": "</script><img src=x onerror=alert(document.cookie)>" });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script>");
  });
});

function mountDeck(overrides: Record<string, string>): void {
  document.body.innerHTML = `${textEditBarHtml("")}
    <h1 id="t" data-edit="تقرير ضمان جودة&#10;فحص الأشعة">تقرير ضمان جودة<br/>فحص الأشعة</h1>
    <div id="a" data-edit="المعجم">المعجم</div>
    <div id="b" data-edit="المعجم">المعجم</div>
    <div id="n">56468</div>
    ${textOverridesJson(overrides)}`;
  new Function(TEXT_EDIT_SCRIPT)();
}

describe("TEXT_EDIT_SCRIPT", () => {
  it("applies a preset to every matching string and leaves data untouched", () => {
    mountDeck({ "المعجم": "القاموس", "تقرير ضمان جودة\nفحص الأشعة": "تقرير\nالجودة" });
    expect(document.getElementById("a")?.textContent).toBe("القاموس");
    expect(document.getElementById("b")?.textContent).toBe("القاموس");
    expect(document.getElementById("t")?.querySelectorAll("br")).toHaveLength(1);
    expect(document.getElementById("t")?.textContent).toBe("تقريرالجودة");
    expect(document.getElementById("n")?.textContent).toBe("56468");
  });

  it("leaves the default wording when there is no preset", () => {
    mountDeck({});
    expect(document.getElementById("a")?.textContent).toBe("المعجم");
    expect(document.getElementById("t")?.textContent).toBe("تقرير ضمان جودةفحص الأشعة");
  });

  it("only editable elements become contenteditable, and only while editing", () => {
    mountDeck({});
    const toggle = document.getElementById("te-toggle") as HTMLButtonElement;
    expect(document.getElementById("a")?.hasAttribute("contenteditable")).toBe(false);
    toggle.click();
    expect(document.getElementById("a")?.getAttribute("contenteditable")).toBe("plaintext-only");
    expect(document.getElementById("n")?.hasAttribute("contenteditable")).toBe(false);
    toggle.click();
    expect(document.getElementById("a")?.hasAttribute("contenteditable")).toBe(false);
  });

  it("reverts an edit that introduces a digit when the field loses focus", () => {
    mountDeck({});
    (document.getElementById("te-toggle") as HTMLButtonElement).click();
    const a = document.getElementById("a") as HTMLElement;
    a.textContent = "المعجم 2024";
    a.dispatchEvent(new Event("blur"));
    expect(a.textContent).toBe("المعجم");
  });

  it("mirrors an edit to identical strings on blur", () => {
    mountDeck({});
    (document.getElementById("te-toggle") as HTMLButtonElement).click();
    const a = document.getElementById("a") as HTMLElement;
    a.textContent = "القاموس";
    a.dispatchEvent(new Event("blur"));
    expect(document.getElementById("b")?.textContent).toBe("القاموس");
  });

  it("reset restores the default wording", () => {
    mountDeck({ "المعجم": "القاموس" });
    (document.getElementById("te-reset") as HTMLButtonElement).click();
    expect(document.getElementById("a")?.textContent).toBe("المعجم");
  });
});
