// src/data/reporting/executive/deck2/theme.test.ts
//
// Regression tests for the 2026-07-28 whole-branch-review fixes to the
// degenerate-reuse Grid pages' CSS (slide-toc / slide-glossary-levels /
// slide-glossary-1 / slide-closing) — G1 (chrome consistency) and G2
// (box-shadow leaks + padding/tint-alpha drift). These read the CSS rule
// TEXT (this module has no DOM/browser access), which is the minimum bar
// the review itself asked for; the actual computed-style/visual claim was
// separately verified live in a browser against deck-preview.html.
import { describe, expect, it } from "vitest";
import { DECK_V2_CSS } from "./theme";

/** Extract a CSS rule's declaration block by its exact selector text. */
function ruleBody(css: string, selector: string): string {
  const idx = css.indexOf(`${selector}{`);
  expect(idx, `selector not found: ${selector}`).toBeGreaterThan(-1);
  const start = idx + selector.length + 1;
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

describe("Grid degenerate-reuse pages — chrome consistency (G1, 2026-07-28 fix)", () => {
  it("toc / glossary-levels / glossary-1 / closing all use 0 radius, 0 border, transparent background on their reused-body wrapper", () => {
    const cases: Array<[string, string]> = [
      [".v2-gd-toc", ".v2-toc-card"],
      [".v2-gd-glossary-levels", ".v2-level-card"],
      [".v2-gd-glossary-terms", ".v2-term-card"],
    ];
    for (const [page, child] of cases) {
      const body = ruleBody(DECK_V2_CSS, `${page} ${child}`);
      expect(body).toContain("border-radius:0");
      expect(body).toContain("border:0");
      expect(body).toContain("background:transparent");
    }
    // closing's card is the SAME element the Ledger slot renders (no
    // wrapper class collision), so its own selector shape differs slightly
    // but must land on the identical 3 values.
    const closingBody = ruleBody(DECK_V2_CSS, ".v2-gd-closing .v2-lg-table-card");
    expect(closingBody).toContain("border-radius:0");
    expect(closingBody).toContain("border:0");
    expect(closingBody).toContain("background:transparent");
  });

  it("closing no longer carries a visible border its 3 siblings never had (the pre-fix inconsistency)", () => {
    const closingBody = ruleBody(DECK_V2_CSS, ".v2-gd-closing .v2-lg-table-card");
    expect(closingBody).not.toMatch(/border:1px solid/);
    expect(DECK_V2_CSS).not.toContain("body.theme-light .v2-gd-closing .v2-lg-table-card");
  });
});

describe("Grid degenerate-reuse pages — box-shadow leaks (G2, 2026-07-28 fix)", () => {
  it("toc and glossary-1's light-theme card overrides explicitly clear box-shadow:none", () => {
    const tocLight = ruleBody(DECK_V2_CSS, "body.theme-light .v2-gd-toc .v2-toc-card");
    expect(tocLight).toContain("box-shadow:none");
    const termsLight = ruleBody(DECK_V2_CSS, "body.theme-light .v2-gd-glossary-terms .v2-term-card");
    expect(termsLight).toContain("box-shadow:none");
  });
});

describe("Grid degenerate-reuse pages — padding/tint-alpha unification (G2, 2026-07-28 fix)", () => {
  it("toc, glossary-levels, and glossary-1 share the SAME cell padding", () => {
    const tocPadding = ruleBody(DECK_V2_CSS, ".v2-gd-toc .v2-toc-card").match(/padding:([^;]+);/)?.[1];
    const levelsPadding = ruleBody(DECK_V2_CSS, ".v2-gd-glossary-levels .v2-level-card").match(
      /padding:([^;]+);/,
    )?.[1];
    const termsPadding = ruleBody(DECK_V2_CSS, ".v2-gd-glossary-terms .v2-term-card").match(
      /padding:([^;]+);/,
    )?.[1];
    expect(tocPadding).toBeTruthy();
    expect(levelsPadding).toBe(tocPadding);
    expect(termsPadding).toBe(tocPadding);
  });

  it("toc and glossary-levels share the SAME 4 per-tone tint alphas", () => {
    const tones = ["blue", "green", "coral"] as const;
    for (const tone of tones) {
      const tocTint = ruleBody(DECK_V2_CSS, `.v2-gd-toc .v2-toc-card.${tone} .v2-toc-side`).match(
        /--gd-tint:([^;]+);/,
      )?.[1];
      const levelsTint = ruleBody(
        DECK_V2_CSS,
        `.v2-gd-glossary-levels .v2-level-card.${tone} .v2-level-share`,
      ).match(/--gd-tint:([^;]+);/)?.[1];
      expect(tocTint).toBeTruthy();
      expect(levelsTint).toBe(tocTint);
    }
    // The default (gold) tint, embedded inline in the background-image
    // fallback rather than a per-tone override, must also match.
    const tocGold = ruleBody(DECK_V2_CSS, ".v2-gd-toc .v2-toc-side").match(
      /var\(--gd-tint,(rgba\([^)]+\))\)/,
    )?.[1];
    const levelsGold = ruleBody(DECK_V2_CSS, ".v2-gd-glossary-levels .v2-level-share").match(
      /var\(--gd-tint,(rgba\([^)]+\))\)/,
    )?.[1];
    expect(tocGold).toBeTruthy();
    expect(levelsGold).toBe(tocGold);
  });
});

describe(".v2-bf-lede-figure .insuff — muted placeholder (B2, 2026-07-28 fix)", () => {
  it("mutes color, resets weight/size, and clears the tone glow that .v2-bf-lede-figure otherwise applies", () => {
    const body = ruleBody(DECK_V2_CSS, ".v2-bf-lede-figure .insuff");
    expect(body).toContain("color:var(--slate)");
    expect(body).toContain("text-shadow:none");
    // Must NOT still be the huge 3.2rem/900 the parent .v2-bf-lede-figure sets.
    expect(body).not.toContain("3.2rem");
    expect(body).not.toContain("font-weight:900");
  });
});
