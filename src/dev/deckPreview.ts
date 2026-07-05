// Dev-only live preview for the executive deck rework (deck-preview.html).
// Renders the new deck (v2) and the old deck (v1, reference) from the same
// synthetic demo month into an iframe, with a toggle. Vite reloads the page on
// every edit to deck2/*, so changes appear live.
//
// Perf: nothing heavy runs before first paint. The requested deck is built on
// the next tick (behind a visible loading placeholder) and cached; the v1
// reference deck is only built when its toggle is first clicked.

import { buildExecutiveDeckV2 } from "../data/reporting/executive/deck2";
import { buildExecutiveDeck } from "../data/reporting/executive/deck";
import { buildPreviewInput } from "./deckPreviewFixture";
import type { ExecutiveReportInput } from "../data/reporting/executiveReportTypes";

const frame = document.getElementById("frame") as HTMLIFrameElement;
const btnV2 = document.getElementById("btn-v2") as HTMLButtonElement;
const btnV1 = document.getElementById("btn-v1") as HTMLButtonElement;
const btnTheme = document.getElementById("btn-theme") as HTMLButtonElement;

const LOADING_HTML = `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#04182c;color:#cfe0f0;font-family:system-ui,sans-serif;font-size:0.95rem">جارٍ بناء العرض…</body></html>`;

let input: ExecutiveReportInput | null = null;
const cache: { v1?: string; v2?: string } = {};
let lightTheme = false;

function deckHtml(which: "v2" | "v1"): string {
  input ??= buildPreviewInput();
  if (which === "v2") {
    // Always request variant-preview mode here: this dev tool's whole purpose
    // is style-variant exploration (see deck2/index.ts's `variantPreview` opt).
    // Production callers (once deck2 is wired into the real app) omit `opts`.
    cache.v2 ??= buildExecutiveDeckV2(input, {}, { variantPreview: true });
    return cache.v2;
  }
  cache.v1 ??= buildExecutiveDeck(input);
  return cache.v1;
}

function show(which: "v2" | "v1"): void {
  btnV2.classList.toggle("active", which === "v2");
  btnV1.classList.toggle("active", which === "v1");
  if (cache[which]) {
    frame.srcdoc = cache[which] as string;
    return;
  }
  frame.srcdoc = LOADING_HTML;
  // Let the placeholder paint before the (synchronous) model + deck build.
  setTimeout(() => {
    const t0 = performance.now();
    frame.srcdoc = deckHtml(which);
    console.info(`[deck-preview] built ${which} in ${Math.round(performance.now() - t0)}ms`);
  }, 30);
}

// Re-applies the light-theme class every time the iframe's document reloads
// (srcdoc assignment tears down the previous document, so the class doesn't
// survive a `show()` call on its own).
frame.addEventListener("load", () => {
  if (lightTheme) frame.contentDocument?.body.classList.add("theme-light");
});

btnTheme.addEventListener("click", () => {
  lightTheme = !lightTheme;
  btnTheme.classList.toggle("active", lightTheme);
  frame.contentDocument?.body.classList.toggle("theme-light", lightTheme);
});

btnV2.addEventListener("click", () => show("v2"));
btnV1.addEventListener("click", () => show("v1"));
show("v2");
