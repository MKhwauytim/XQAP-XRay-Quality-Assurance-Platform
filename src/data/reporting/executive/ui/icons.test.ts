import { describe, it, expect } from "vitest";
import { icon, ICON_NAMES, shield, gauge, check, expand, compress } from "./icons";

// Detects the vast majority of emoji codepoints (pictographic, symbols, dingbats,
// regional indicators) plus the variation-selector / ZWJ / keycap joiners that
// only appear in emoji sequences. Split into separate alternatives so combining
// marks are not placed inside a character class (no-misleading-character-class).
const EMOJI_RE = new RegExp(
  "[\\u{1F000}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{2B00}-\\u{2BFF}\\u{1F1E6}-\\u{1F1FF}]" +
    "|\\u{FE0F}|\\u{200D}|\\u{20E3}",
  "u",
);

describe("icons", () => {
  it("exposes a non-empty icon name registry", () => {
    expect(Array.isArray(ICON_NAMES)).toBe(true);
    expect(ICON_NAMES.length).toBeGreaterThanOrEqual(12);
  });

  it("includes every required icon name", () => {
    const required = [
      "shield",
      "port",
      "scan",
      "gauge",
      "flag",
      "alert",
      "check",
      "layers",
      "users",
      "document",
      "chart",
      "arrow",
    ];
    for (const name of required) {
      expect(ICON_NAMES).toContain(name);
    }
  });

  it("each registered icon returns a valid stroke-based svg string", () => {
    for (const name of ICON_NAMES) {
      const svg = icon(name);
      expect(typeof svg).toBe("string");
      expect(svg).toContain("<svg");
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('stroke="currentColor"');
      expect(svg).toContain('fill="none"');
      expect(svg).toContain("</svg>");
      // no baked-in color fills, no emoji
      expect(EMOJI_RE.test(svg)).toBe(false);
    }
  });

  it("respects a custom size", () => {
    const svg = icon("shield", 40);
    expect(svg).toContain('width="40"');
    expect(svg).toContain('height="40"');
  });

  it("defaults to a sensible size when omitted", () => {
    const svg = icon("gauge");
    expect(svg).toMatch(/width="\d+"/);
    expect(svg).toMatch(/height="\d+"/);
  });

  it("returns a neutral fallback for an unknown icon name", () => {
    const svg = icon("does-not-exist");
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(EMOJI_RE.test(svg)).toBe(false);
  });

  it("named exports return the same markup as the lookup", () => {
    expect(shield()).toBe(icon("shield"));
    expect(gauge()).toBe(icon("gauge"));
    expect(check()).toBe(icon("check"));
  });

  it("includes expand/compress icons for the deck2 slideshow fullscreen control", () => {
    expect(ICON_NAMES).toContain("expand");
    expect(ICON_NAMES).toContain("compress");
    expect(expand()).toBe(icon("expand"));
    expect(compress()).toBe(icon("compress"));
  });

  it("no icon contains any emoji glyph", () => {
    const all = ICON_NAMES.map((n) => icon(n)).join("");
    expect(EMOJI_RE.test(all)).toBe(false);
  });
});
