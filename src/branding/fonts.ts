// Self-hosted Arabic webfont (VIS wave, 2026-07-14). IBM Plex Sans Arabic is
// embedded as base64 data-URI @font-face rules so BOTH the app UI and every
// GENERATED report HTML render Arabic identically on any machine, fully offline
// (no network at open time). The .woff2 files are inlined at build time via
// Vite's `?inline` query, so the data URIs live once in the bundle and are
// referenced by every consumer through the single `ARABIC_FONT_FACE_CSS` string.
//
// Weights 400 + 700 only (owner-approved ~116 KB base64 for the two Arabic-
// subset weights). `font-display: swap` so text paints immediately in the
// fallback face and swaps in IBM Plex when ready. This face sits AFTER the
// brand face ("Somar") in every stack — it is a high-quality Arabic fallback,
// not a replacement for the brand typography.

import arabic400 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2?inline";
import arabic700 from "@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-700-normal.woff2?inline";

/** The embedded font-family name — reference this in font stacks. */
export const ARABIC_FONT_FAMILY = "IBM Plex Sans Arabic";

/**
 * Two `@font-face` rules (400 + 700) with the woff2 payloads inlined as
 * base64 data URIs. Prepend this to any `<style>` block (report or app) that
 * needs the font available; it is idempotent to include more than once in a
 * single document, but include it exactly once per generated document.
 */
export const ARABIC_FONT_FACE_CSS =
  `@font-face{font-family:"IBM Plex Sans Arabic";font-style:normal;font-weight:400;` +
  `font-display:swap;src:url(${arabic400}) format("woff2");}` +
  `@font-face{font-family:"IBM Plex Sans Arabic";font-style:normal;font-weight:700;` +
  `font-display:swap;src:url(${arabic700}) format("woff2");}`;
