// Shared XSS payload corpus + a framework-agnostic live-injection detector for the
// report-builder escaping tests (D2, Batch 3). Defined ONCE so every builder test
// (Population report, executive document, executive deck v1 + v2, management report)
// exercises the identical injection vectors, and any new builder adopts the corpus by
// import rather than copy-paste.
//
// This file is pure data + pure functions — NO test-framework imports — so it is safe
// to live under src/ next to production code and be type-checked by `tsc -b`. It is only
// ever imported by *.test.ts files, so the app bundle tree-shakes it out.

/** Marker embedded in every payload — its presence in output proves an injected field
 *  was actually rendered (escaped), guarding against a false pass where the malicious
 *  field is simply dropped and `findLiveInjection` trivially returns null. */
export const XSS_MARKER = "XSSPROBE";

/**
 * Canonical injection payloads. Each carries the `XSS_MARKER` and a live-markup fragment:
 * a `<script>`, an `<img … onerror>`, an `<svg … onload>`, an attribute-breaking
 * `"><b … onmouseover>`, and structure-breaking `</td></table><marquee>`. A builder that
 * routes user data through esc()/escapeHtml()/escText() renders every `<` as `&lt;`, so
 * none of the raw fragments below can survive in the output.
 */
export const XSS_PAYLOADS = {
  scriptTag: `<script>alert('XSSPROBE')</script>`,
  imgOnerror: `"><img src=x onerror="alert('XSSPROBE')">`,
  svgOnload: `<svg onload="alert('XSSPROBE')">`,
  attrBreak: `"><b onmouseover="alert('XSSPROBE')">XSSPROBE</b>`,
  structureBreak: `</td></table><marquee>XSSPROBE</marquee>`,
} as const;

/** The payloads as a flat list — the identical corpus every builder test injects. */
export const XSS_PAYLOAD_LIST: readonly string[] = Object.values(XSS_PAYLOADS);

/** All payloads joined into one string, for loading a full corpus into a single field. */
export const XSS_COMBINED: string = XSS_PAYLOAD_LIST.join(" ");

/**
 * Raw live-markup fragments that must NEVER appear verbatim in escaped output. They are
 * intentionally distinct from the builders' OWN legitimate chrome — the deck nav
 * `<script>(function(){…})()` IIFEs, `onclick="window.print()"`, the theme-toggle
 * `onchange="…"`, and the ZATCA logo's `<img src="https://…" … onerror="this.style…">` —
 * so a match here means a real injection, not a false positive.
 */
const LIVE_FRAGMENTS: readonly string[] = [
  "<script>alert",
  "<img src=x onerror",
  "<svg onload",
  "<b onmouseover",
  "<marquee>",
];

/**
 * Scan rendered HTML for a LIVE (unescaped) injection originating from the payload corpus.
 * Returns the first offending raw fragment, or null when the output is safe. Framework-
 * agnostic so any test can assert `expect(findLiveInjection(html)).toBeNull()`.
 */
export function findLiveInjection(html: string): string | null {
  for (const frag of LIVE_FRAGMENTS) {
    if (html.includes(frag)) return frag;
  }
  return null;
}
