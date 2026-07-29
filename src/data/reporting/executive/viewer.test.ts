/* @vitest-environment jsdom */
// Regression test for a second-order DOM XSS in the executive report's embedded
// TOC-building script (VIEWER_JS, above). The vulnerable line concatenated the
// HTML-entity-*decoded* `p.dataset.title` value straight into `a.innerHTML`,
// which re-parses it as markup — undoing the `esc()` escaping applied when the
// attribute was written (see document/shared.ts `page()`). Fixed by building the
// TOC entry with `document.createElement` + `textContent` instead (mirrors the
// safe idiom already used by `executive/deck2/index.ts`).
//
// This runs the *actual* generated `<script>` (VIEWER_JS) — not a re-implemented
// copy of its logic — against a real jsdom document, so it fails again if the
// vulnerable string-concat pattern is ever reintroduced.
import { describe, it, expect } from "vitest";
import { buildViewerHtml } from "./viewer";
import { esc } from "./primitives";

/** Minimal DOMParser + IntersectionObserver stub so VIEWER_JS's IIFE can run
 *  unmodified in jsdom (which does not implement IntersectionObserver). */
function runViewerScript(html: string): Document {
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error("VIEWER_JS <script> block not found in output");
  const doc = new DOMParser().parseFromString(html, "text/html");
  class IntersectionObserverStub {
    observe(): void {}
  }
  const run = new Function(
    "document",
    "IntersectionObserver",
    scriptMatch[1]
  ) as (doc: Document, io: typeof IntersectionObserverStub) => void;
  run(doc, IntersectionObserverStub);
  return doc;
}

describe("executive viewer TOC builder (VIEWER_JS) — XSS hardening", () => {
  it("does not let an HTML-injection payload in data-title become a live DOM element", () => {
    const payload = "<img src=x onerror=alert(1)>";
    // Mirrors exactly what document/shared.ts `page()` writes: esc() applied once
    // when the attribute is authored. The browser then HTML-entity-decodes it back
    // to the raw payload on `.dataset.title` read — that decoded string is what
    // VIEWER_JS receives.
    const slide = `<section class="page" id="p1" data-title="${esc(payload)}"></section>`;
    const html = buildViewerHtml(slide, "يوليو 2026");

    const doc = runViewerScript(html);
    const toc = doc.getElementById("toc");
    expect(toc).not.toBeNull();
    expect(toc!.children.length).toBe(1);

    const link = toc!.children[0];
    // No <img> (or any other injected element) was parsed into the DOM.
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelectorAll("*").length).toBe(2); // just the span + b we create

    const span = link.querySelector("span");
    expect(span).not.toBeNull();
    // The payload survives only as inert text, exactly as authored.
    expect(span!.textContent).toBe(payload);
    // Serialised back out it must be re-escaped, never raw markup.
    expect(span!.innerHTML).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("still renders an ordinary title normally (no regression to the happy path)", () => {
    const slide = `<section class="page" id="p1" data-title="${esc("الملخص التنفيذي")}"></section>`;
    const html = buildViewerHtml(slide, "يوليو 2026");

    const doc = runViewerScript(html);
    const link = doc.getElementById("toc")!.children[0];
    expect(link.querySelector("span")!.textContent).toBe("الملخص التنفيذي");
    expect(link.querySelector("b")!.textContent).toBe("01");
    expect(link.getAttribute("href")).toBe("#p1");
  });
});
