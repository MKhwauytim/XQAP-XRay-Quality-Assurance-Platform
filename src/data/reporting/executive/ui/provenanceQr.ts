// Provenance QR for the executive deck's closing slide (VIS wave, 2026-07-14).
// Encodes a compact, human-unreadable provenance string (month key + source
// file:revision pairs + generation date) into a QR so an offline PDF/print can
// still be tied back to the exact data snapshot it was built from.
//
// `qrcode`'s SVG output is ASYNC and the deck build path is synchronous, so the
// QR is generated BEFORE the deck is built (see openExecutiveDeckV2WithQr) and
// threaded in as a prebuilt string. Dark modules on a WHITE background (never
// gold-on-navy) so scanners get the contrast they need. The QR encodes text as
// modules only — the source string is never embedded literally in the markup.

import QRCode from "qrcode";
import type { SourceRevisions } from "../../sourceRevisions";
import { sourceRevisionEntries } from "../../sourceRevisions";

/** Compact provenance string: `{month}|{file:rev};{file:rev}|{YYYY-MM-DD}`. */
export function buildProvenanceString(
  monthFolderName: string,
  revisions: SourceRevisions | undefined,
  generatedAt: Date,
): string {
  const revPart = sourceRevisionEntries(revisions)
    .map(([file, rev]) => `${file}:${rev}`)
    .join(";");
  const date =
    `${generatedAt.getFullYear()}-` +
    `${String(generatedAt.getMonth() + 1).padStart(2, "0")}-` +
    `${String(generatedAt.getDate()).padStart(2, "0")}`;
  return [monthFolderName, revPart, date].filter((p) => p.length > 0).join("|");
}

/**
 * Generate the provenance QR as an SVG string. Dark-on-white with a quiet zone
 * (margin) so it stays scannable. Returns "" on any failure so the closing slide
 * degrades to its text-only provenance block.
 */
export async function generateProvenanceQrSvg(text: string): Promise<string> {
  try {
    const svg = await QRCode.toString(text, {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#0a2d4a", light: "#ffffff" },
    });
    return typeof svg === "string" && svg.trimStart().startsWith("<svg") ? svg : "";
  } catch {
    return "";
  }
}
