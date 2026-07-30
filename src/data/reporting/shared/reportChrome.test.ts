/* @vitest-environment jsdom */
// Regression test for a second-order DOM XSS in the shared report chrome's
// embedded TOC-building script (VIEWER_JS, above) — the sample/distribution
// document viewer's copy of the same vulnerability fixed in
// `executive/viewer.ts`. The vulnerable line concatenated the HTML-entity-
// *decoded* `p.dataset.title` value straight into `a.innerHTML`, which
// re-parses it as markup, undoing the `esc()` escaping applied when the
// attribute was written. Fixed by building the TOC entry with
// `document.createElement` + `textContent` instead.
//
// This runs the *actual* generated `<script>` (VIEWER_JS) — not a
// re-implemented copy of its logic — against a real jsdom document, so it
// fails again if the vulnerable string-concat pattern is ever reintroduced.
// `buildDeckViewer` is intentionally not covered here: it has no `<script>`
// block / TOC-building logic and is unaffected by this vulnerability.
import { describe, it, expect } from "vitest";
import { buildDocViewer } from "./reportChrome";
import { esc } from "../executive/primitives";

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

describe("shared report chrome TOC builder (VIEWER_JS) — XSS hardening", () => {
  it("does not let an HTML-injection payload in data-title become a live DOM element", () => {
    const payload = "<img src=x onerror=alert(1)>";
    const slide = `<section class="page" id="p1" data-title="${esc(payload)}"></section>`;
    const html = buildDocViewer({
      slides: slide,
      docTitle: "تقرير العينة",
      brandTitle: "تقرير العينة",
      brandSub: "يوليو 2026",
    });

    const doc = runViewerScript(html);
    const toc = doc.getElementById("toc");
    expect(toc).not.toBeNull();
    expect(toc!.children.length).toBe(1);

    const link = toc!.children[0];
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelectorAll("*").length).toBe(2); // just the span + b we create

    const span = link.querySelector("span");
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe(payload);
    expect(span!.innerHTML).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });
});
