// Seeded generative-art helpers for the executive deck (VIS wave, 2026-07-14).
// Both outputs are DETERMINISTIC on their seed string, so the same report always
// regenerates byte-identical art (no churn between opens), and PURE SVG strings
// (no canvas, no DOM, no network) so they inline into the self-contained report.
//
// Security: the seed strings can carry user-controlled data (e.g. a malicious
// monthFolderName). Neither library echoes the seed into its output — trianglify
// and geopattern hash it into geometry/colour only — but as defence in depth
// `sanitizeSelfSvg` still gates every return on the expected `<svg` prefix and
// discards anything else, so no unescaped input can ever flow into the markup.

// trianglify's default entry does `require('canvas')` (a native node addon) at
// module top level, which neither the browser nor node/vitest can load here; its
// pre-bundled browser build (`dist/trianglify.bundle.js`) drops that require and
// still exposes the headless `toSVGTree().toString()` path we use.
import trianglify from "trianglify/dist/trianglify.bundle.js";
import GeoPattern from "geopattern";

/** Return the SVG only if it is genuinely an `<svg …>` string; else "". */
function sanitizeSelfSvg(svg: unknown): string {
  return typeof svg === "string" && svg.trimStart().startsWith("<svg") ? svg : "";
}

/**
 * Full-bleed low-poly cover mesh in the brand navy range, seeded by the month
 * key so a given report's cover is always the same. Large cells (institutional,
 * not confetti), low variance, dark-blues-only palette. Serialized via
 * trianglify's SVG tree (never rasterized). Returns "" on any failure so the
 * cover degrades gracefully to its gradient background.
 */
export function coverMeshSvg(seed: string): string {
  try {
    const pattern = trianglify({
      width: 960,
      height: 540,
      cellSize: 150,
      variance: 0.55,
      seed,
      xColors: ["#020e1c", "#03152b", "#062a48", "#073257", "#0a3a5f"],
      colorSpace: "lab",
    });
    return sanitizeSelfSvg(pattern.toSVGTree().toString());
  } catch {
    return "";
  }
}

/**
 * Subtle seeded geometric pattern for a section-separator background, tinted to
 * the section tone. Rendered at very low opacity by the caller's CSS so it never
 * reduces headline contrast. Returns "" on any failure (separator keeps its
 * color-blocked design).
 */
export function dividerPatternSvg(seed: string, colorHex: string): string {
  try {
    return sanitizeSelfSvg(GeoPattern.generate(seed, { color: colorHex }).toString());
  } catch {
    return "";
  }
}
