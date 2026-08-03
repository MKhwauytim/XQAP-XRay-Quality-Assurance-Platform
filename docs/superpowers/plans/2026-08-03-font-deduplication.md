# Font Deduplication (§Q) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the duplicate embedding of the Somar Sans font (4 weights, ~239.7KB base64, currently embedded once for the live app's CSS and once for the report/deck HTML builders) — the single largest available bundle-size reduction in the codebase (~7.3% of the current ~3.26MB `dist/index.html`). Bonus fix while in this code: `reportHtmlBuilder.ts`'s standalone Population-report export references the Somar font by name but embeds no `@font-face` at all, so it silently falls back to system fonts once the exported HTML file is opened outside the app.

**Architecture:** One new shared module, `src/branding/somarFonts.ts`, imports the 4 `.woff` files exactly once (mirroring the already-working single-source pattern `src/branding/fonts.ts` already uses for IBM Plex Sans Arabic). The live app's CSS keeps its own family name (`"Somar Sans"`, `font-display: swap`) and the report/deck side keeps its own (`"Somar"`, `font-display: block`) — only the underlying base64 data URIs are shared, not the CSS text, so the report-side `@font-face` block that snapshot tests pin stays byte-identical.

**Tech Stack:** Vite's `?inline` asset-import transform (already used for IBM Plex and, today, for Somar Sans on the report side), Vitest snapshot testing.

## Global Constraints

- Every edit needs a `docs/edit logs/YYYY-MM-DD.md` entry (today's file) per CLAUDE.md: version bump (semver-lite), category prefix, Before/After snippets, `**Lines:**` stat from `npm run count-lines -- --quiet` before/after.
- Pathspec-scoped git commits only (`git add <files>` then `git commit -m "..." -- <same files>`) — never a bare `git commit`; this repo routinely has unrelated pre-existing uncommitted work in the tree from other sessions.
- Repo-level gates: `npm run test:run`, `npm run typecheck`, `npm run lint` after every task.
- **Zero snapshot deltas is the hard gate for Task 1.** `theme.ts`'s `EXEC_CSS` output (font-face block specifically) must be byte-identical before and after — the 5 report/deck snapshot files listed in Task 1 must show no diff. If any snapshot changes, the refactor introduced a real difference and must be fixed, not accepted by updating the snapshot.
- Do not rename any CSS font-family anywhere (`"Somar Sans"` stays `"Somar Sans"` in the app, `"Somar"` stays `"Somar"` in reports) — this plan deduplicates the underlying binary data only, never the family names, to avoid a much wider blast radius (dozens of component `.css` files reference `"Somar Sans"` via `--font-sans`).

---

### Task 1: Shared `somarFonts.ts` module — dedupe the live app and report-side embeddings

**Files:**
- Create: `src/branding/somarFonts.ts`
- Modify: `src/data/reporting/executive/theme.ts` (import from the new module instead of importing the raw `.woff` files itself)
- Modify: `src/index.css` (delete the 4 static `@font-face` rules — Vite's CSS asset pipeline was independently inlining these, which is the actual second copy)
- Modify: `src/main.tsx` (inject the app-side `@font-face` CSS at runtime, mirroring the existing `ARABIC_FONT_FACE_CSS` pattern exactly)
- Test: no new test file — this task's correctness gate is "zero snapshot deltas" on the 5 existing report/deck snapshot files (see Step 5)

**Interfaces:**
- Produces: `export const SOMAR_SANS_WOFF: { light: string; regular: string; medium: string; bold: string }` (the 4 base64 data URIs, single source), `export const SOMAR_SANS_APP_FONT_FACE_CSS: string` (ready-to-inject CSS text for the live app, family `"Somar Sans"`, `font-display: swap`, matching `index.css`'s current 4 rules exactly in weight/style/order).
- Consumes (in `theme.ts`): `SOMAR_SANS_WOFF` — replaces its own direct `?inline` imports of the 4 `.woff` files. `theme.ts`'s own `EXEC_CSS` font-face text (family `"Somar"`, `font-display: block`) is otherwise unchanged.

- [ ] **Step 1: Create the shared module**

Create `src/branding/somarFonts.ts`:

```ts
// Single source for the Somar Sans brand font's 4 weights, so the live app
// and every generated report/deck HTML embed the SAME base64 payload once
// instead of two independent copies (§Q — was ~239.7KB duplicated, ~7.3% of
// the built bundle). Each consumer keeps its own font-family name and
// font-display value (the app uses "Somar Sans"/swap; reports use "Somar"/
// block, since report HTML is a standalone file with no network fetch to
// avoid blocking on) -- only the woff data URIs are shared here.
import somarLight from "../assets/fonts/SomarSans-Light.woff?inline";
import somarRegular from "../assets/fonts/SomarSans-Regular.woff?inline";
import somarMedium from "../assets/fonts/SomarSans-Medium.woff?inline";
import somarBold from "../assets/fonts/SomarSans-Bold.woff?inline";

export const SOMAR_SANS_WOFF = {
  light: somarLight,
  regular: somarRegular,
  medium: somarMedium,
  bold: somarBold,
} as const;

/**
 * Live-app @font-face block: family "Somar Sans", font-display: swap.
 * Matches the weight/style/order of the @font-face rules this replaces in
 * index.css exactly (Light 300, Regular 400, Medium 500, Bold 700).
 */
export const SOMAR_SANS_APP_FONT_FACE_CSS =
  `@font-face{font-family:"Somar Sans";src:url(${SOMAR_SANS_WOFF.light}) format("woff");font-weight:300;font-style:normal;font-display:swap;}` +
  `@font-face{font-family:"Somar Sans";src:url(${SOMAR_SANS_WOFF.regular}) format("woff");font-weight:400;font-style:normal;font-display:swap;}` +
  `@font-face{font-family:"Somar Sans";src:url(${SOMAR_SANS_WOFF.medium}) format("woff");font-weight:500;font-style:normal;font-display:swap;}` +
  `@font-face{font-family:"Somar Sans";src:url(${SOMAR_SANS_WOFF.bold}) format("woff");font-weight:700;font-style:normal;font-display:swap;}`;
```

- [ ] **Step 2: Point `theme.ts` at the shared module**

In `src/data/reporting/executive/theme.ts`, replace:

```ts
// Fonts are embedded as base64 data URIs so exported reports stay self-contained
// even when the HTML file is moved away from the app folder.
import somarRegular from "../../../assets/fonts/SomarSans-Regular.woff?inline";
import somarBold from "../../../assets/fonts/SomarSans-Bold.woff?inline";
import somarMedium from "../../../assets/fonts/SomarSans-Medium.woff?inline";
import somarLight from "../../../assets/fonts/SomarSans-Light.woff?inline";

export const EXEC_CSS = `
@font-face{font-family:"Somar";src:url("${somarRegular}") format("woff");font-weight:400;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url("${somarBold}") format("woff");font-weight:700;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url("${somarMedium}") format("woff");font-weight:500;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url("${somarLight}") format("woff");font-weight:300;font-style:normal;font-display:block;}
```

with:

```ts
// Fonts are embedded as base64 data URIs so exported reports stay self-contained
// even when the HTML file is moved away from the app folder. Single-sourced
// from src/branding/somarFonts.ts (§Q) -- the live app embeds the same 4
// files under its own family name/font-display via that module too, instead
// of each side carrying its own independent copy.
import { SOMAR_SANS_WOFF } from "../../../branding/somarFonts";

export const EXEC_CSS = `
@font-face{font-family:"Somar";src:url("${SOMAR_SANS_WOFF.regular}") format("woff");font-weight:400;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url("${SOMAR_SANS_WOFF.bold}") format("woff");font-weight:700;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url("${SOMAR_SANS_WOFF.medium}") format("woff");font-weight:500;font-style:normal;font-display:block;}
@font-face{font-family:"Somar";src:url("${SOMAR_SANS_WOFF.light}") format("woff");font-weight:300;font-style:normal;font-display:block;}
```

Leave everything below this point in `theme.ts` (the `:root{...}` tokens and every rule after) completely untouched — only the import lines and the 4 `@font-face` lines change, and the resulting `EXEC_CSS` string must be byte-identical to before (same data URIs, since it's the same files through the same `?inline` transform, just imported from one hop further away; same family name, weight, style, font-display, order).

- [ ] **Step 3: Remove the static `@font-face` rules from `index.css`**

Delete these 29 lines from the top of `src/index.css`:

```css
/* ── Somar Sans ────────────────────────────────────────────── */
@font-face {
  font-family: "Somar Sans";
  src: url("./assets/fonts/SomarSans-Light.woff") format("woff");
  font-weight: 300;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Somar Sans";
  src: url("./assets/fonts/SomarSans-Regular.woff") format("woff");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Somar Sans";
  src: url("./assets/fonts/SomarSans-Medium.woff") format("woff");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Somar Sans";
  src: url("./assets/fonts/SomarSans-Bold.woff") format("woff");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

Leave the blank line and everything after (`═══... X-Ray QC Product Tokens ...`) exactly as-is — this removal is the entire diff to this file. This is what stops Vite's CSS asset pipeline from independently base64-inlining these 4 files a second time (the actual duplication).

- [ ] **Step 4: Inject the app-side font-face CSS at runtime, mirroring the existing Arabic-font pattern**

In `src/main.tsx`, replace:

```tsx
import { ARABIC_FONT_FACE_CSS } from "./branding/fonts";

import "./index.css";
import "./styles/primitives.css";

// Embed the IBM Plex Sans Arabic @font-face (base64 data-URI woff2) into the app
// document from the SAME single source the generated reports use, so the UI and
// its reports render Arabic identically and fully offline.
const fontStyle = document.createElement("style");
fontStyle.setAttribute("data-arabic-font", "");
fontStyle.textContent = ARABIC_FONT_FACE_CSS;
document.head.appendChild(fontStyle);
```

with:

```tsx
import { ARABIC_FONT_FACE_CSS } from "./branding/fonts";
import { SOMAR_SANS_APP_FONT_FACE_CSS } from "./branding/somarFonts";

import "./index.css";
import "./styles/primitives.css";

// Embed the IBM Plex Sans Arabic @font-face (base64 data-URI woff2) into the app
// document from the SAME single source the generated reports use, so the UI and
// its reports render Arabic identically and fully offline.
const fontStyle = document.createElement("style");
fontStyle.setAttribute("data-arabic-font", "");
fontStyle.textContent = ARABIC_FONT_FACE_CSS;
document.head.appendChild(fontStyle);

// Embed the Somar Sans brand font the same way, from the same shared source
// the report/deck builders use (§Q) -- previously index.css's own static
// @font-face rules caused Vite to inline a second, independent copy of the
// same 4 files into the built bundle.
const somarFontStyle = document.createElement("style");
somarFontStyle.setAttribute("data-somar-font", "");
somarFontStyle.textContent = SOMAR_SANS_APP_FONT_FACE_CSS;
document.head.appendChild(somarFontStyle);
```

- [ ] **Step 5: Run the full report/deck snapshot suite and confirm zero deltas**

Run: `npx vitest run src/data/reporting/distributionReport.test.ts src/data/reporting/sampleReport.test.ts src/data/reporting/executiveReport.test.ts src/data/reporting/executive/deck2/deck2.test.ts src/data/reporting/management/managementDeck.test.ts`

Expected: PASS, with **zero snapshot deltas** across all 5 files listed in the Global Constraints. If any snapshot fails, the `EXEC_CSS` text changed — find the exact character difference (likely the import path context or an accidental change to the font-face text) and fix `theme.ts` until it's byte-identical. Do NOT run `-u` to update a snapshot to make this pass — a delta here means the refactor is wrong, not the snapshot.

- [ ] **Step 6: Run the full suite, typecheck, lint, and a real build**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean.

Run: `npm run build`
Expected: succeeds. Then check `dist/index.html`'s file size (`ls -la dist/index.html` or equivalent) and confirm it's smaller than the pre-change baseline by roughly 230-240KB (one full duplicate Somar Sans copy, ~239.7KB base64). Run `npm run check:bundle-size` and confirm it still passes (this change should only help the budget, never hurt it).

- [ ] **Step 7: Manual visual smoke check (optional but recommended given this touches every page's typography)**

If a browser preview is available, load the app and confirm Arabic/Latin text still renders with the Somar Sans brand font (not a fallback) across at least one page each of: Population, Reports (KPI dashboard), a generated executive report/deck preview. This step has no automated gate — it's a sanity check for a change that touches global typography, not a blocking step if no browser is available in this environment.

- [ ] **Step 8: Edit log + version bump + commit**

Category: `Fix:` (bug: byte duplication) or `Change:` — use `Fix:` since a redundant ~240KB payload shipped to every user is a real defect being corrected. Insert at the TOP of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/branding/somarFonts.ts src/data/reporting/executive/theme.ts src/index.css src/main.tsx "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (branding): deduplicate Somar Sans font embedding, single-sourced via branding/somarFonts.ts (§Q, ~240KB/~7.3% bundle reduction)" -- src/branding/somarFonts.ts src/data/reporting/executive/theme.ts src/index.css src/main.tsx "docs/edit logs/2026-08-03.md" package.json
```

---

### Task 2: Fix the missing `@font-face` in standalone Population report exports

**Files:**
- Modify: `src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.ts`
- Test: Create `src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.test.ts`

**Interfaces:**
- Consumes: `SOMAR_SANS_WOFF` from `src/branding/somarFonts.ts` (Task 1).
- `buildPopulationReportHtml`'s exported signature and return type are unchanged — only the HTML string it returns gains one `<style>` block's worth of `@font-face` rules.

**Background:** `buildCss()` in this file sets `font-family: "Somar", "Somar Sans", "Segoe UI", Tahoma, Arial, sans-serif;` on `body` (line 719), but this file embeds no `@font-face` rule at all for either family name. `exportPopulationReport` (`reportExporter.ts`) saves this HTML as a standalone file the user opens outside the app (no network access to the app's own fonts), so today it silently falls back past both named families straight to Segoe UI/Tahoma — a real, user-visible bug, not a hypothetical one. No snapshot/golden test exists yet for this builder's HTML output (only an XSS-focused test does) — per CLAUDE.md's determinism rule, characterize the current output before changing it.

- [ ] **Step 1: Write a characterization test pinning the current (buggy) output, then the target output**

Create `src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPopulationReportHtml } from "./reportHtmlBuilder";
import type { PopulationReportData } from "./reportTypes";

function minimalReportData(): PopulationReportData {
  return {
    title: "تقرير اختبار",
    generatedAt: "2026-08-03T00:00:00.000Z",
    monthLabel: "أغسطس 2026",
    // Fill in only the fields buildPopulationReportHtml/buildCss/buildToolbar
    // actually require to not throw -- check reportTypes.ts for the full
    // PopulationReportData shape and any other mandatory fields; this
    // fixture only needs to be valid enough to render, not realistic.
  } as PopulationReportData;
}

describe("buildPopulationReportHtml — font embedding (§Q bonus fix)", () => {
  it("embeds a @font-face rule for the Somar font family referenced by body{font-family}", () => {
    const html = buildPopulationReportHtml(minimalReportData());
    expect(html).toContain("@font-face");
    expect(html).toMatch(/@font-face\{font-family:"Somar"/);
  });

  it("the embedded font-face src is a real data: URI, not an empty/broken value", () => {
    const html = buildPopulationReportHtml(minimalReportData());
    const match = html.match(/@font-face\{font-family:"Somar"[^}]*src:url\(([^)]+)\)/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toMatch(/^data:font\/woff/);
  });
});
```

Adjust `minimalReportData()`'s fixture shape to satisfy `PopulationReportData`'s actual required fields (read `reportTypes.ts` in this directory first) — the two assertions above are what matter; the fixture just needs to not throw when passed through `buildPopulationReportHtml`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.test.ts`
Expected: FAIL — no `@font-face` currently exists in the output.

- [ ] **Step 3: Embed the font-face block**

In `src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.ts`, add the import near the top of the file (alongside the existing `reportTypes` import):

```ts
import { SOMAR_SANS_WOFF } from "../../../../../branding/somarFonts";
```

(adjust the relative path depth to actually match this file's location — `src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.ts` to `src/branding/somarFonts.ts` — count the directory levels precisely rather than guessing)

Then change `buildPopulationReportHtml`'s `<style>` line from:

```ts
  <style>${buildCss()}</style>
```

to:

```ts
  <style>${buildSomarFontFaceCss()}${buildCss()}</style>
```

and add a small new function near `buildCss` (same file, private, not exported):

```ts
function buildSomarFontFaceCss(): string {
  return (
    `@font-face{font-family:"Somar";src:url("${SOMAR_SANS_WOFF.regular}") format("woff");font-weight:400;font-style:normal;font-display:block;}` +
    `@font-face{font-family:"Somar";src:url("${SOMAR_SANS_WOFF.bold}") format("woff");font-weight:700;font-style:normal;font-display:block;}` +
    `@font-face{font-family:"Somar";src:url("${SOMAR_SANS_WOFF.medium}") format("woff");font-weight:500;font-style:normal;font-display:block;}` +
    `@font-face{font-family:"Somar";src:url("${SOMAR_SANS_WOFF.light}") format("woff");font-weight:300;font-style:normal;font-display:block;}`
  );
}
```

(`font-display: block` matches the report/deck side's existing convention for standalone HTML exports, per Task 1/§Q — the document is self-contained with no network fetch to avoid blocking on.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite, typecheck, lint**

Run: `npm run typecheck && npm run lint && npm run test:run`
Expected: all clean. Also re-run the XSS test file for this same module (`reportHtmlBuilder.xss.test.ts`) explicitly to confirm this change didn't alter escaping/structure it depends on.

- [ ] **Step 6: Edit log + version bump + commit**

Category: `Fix:`. Insert at the TOP of the edit log. Bump `package.json`. Confirm `npm run check:release`.

```bash
git add src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.ts src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.test.ts "docs/edit logs/2026-08-03.md" package.json
git commit -m "Fix (population-report): embed the Somar font-face in standalone report exports instead of silently falling back to system fonts" -- src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.ts src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.test.ts "docs/edit logs/2026-08-03.md" package.json
```

---

## Testing summary

Task 1's hard gate is zero snapshot deltas across the 5 listed report/deck snapshot files — this is non-negotiable per CLAUDE.md's determinism rule. Task 2 adds new coverage where none existed. Both tasks run `npm run test:run`/`typecheck`/`lint` before commit.

## Key files touched

| Task | Files |
|---|---|
| 1 | `src/branding/somarFonts.ts` (new), `src/data/reporting/executive/theme.ts`, `src/index.css`, `src/main.tsx` |
| 2 | `src/components/Sidebar/Tabs/Population/reporting/reportHtmlBuilder.ts`, `.test.ts` (new) |
