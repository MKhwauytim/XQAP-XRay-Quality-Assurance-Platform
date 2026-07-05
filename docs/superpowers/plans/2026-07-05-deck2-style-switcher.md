# Deck2 Style Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dev-only, per-slide "style variant" arrow-switcher to `deck-preview.html` (4 variants per slide, instant client-side cycling, choices persisted to a JSON file, plus a light/dark theme toggle) without changing the production executive deck's output at all.

**Architecture:** Every deck2 slide-building function gains a `variantPreview: boolean` parameter and produces 4 body-HTML variants instead of 1; a shared `renderVariants()` helper either emits only variant 0 (production — byte-identical to today) or wraps all 4 in switcher chrome (preview). A Vite dev-server middleware persists the chosen variant per slide to `dev-workspace/6-templates/deck-style-choices.json`, shaped with the app's real `JsonEnvelope`. This plan builds the **plumbing only**: variants 1-3 are intentionally literal duplicates of variant 0 for now (proving the mechanism end-to-end); a follow-up plan fills in the real alternate designs (KPI cards, mini charts, heatmap, compare-bars) documented in the design spec's variant catalog.

**Tech Stack:** TypeScript, Vite (dev middleware via `configureServer`), Vitest, vanilla inline JS (no framework, matching the existing `DECK_NAV_SCRIPT` pattern), Node `fs`.

## Global Constraints

- No change to slide physical size, aspect ratio, or pagination/row-budget math (`TABLE_BUDGET_PX`, `BASE_ROWS_PER_PAGE`, `COMPRESS_OVERFLOW_MAX` are untouched).
- Production path (`buildExecutiveDeckV2(input)` with no `opts`, or `variantPreview: false`) must render **byte-identical** output to before this change.
- No fabricated data: variants 1-3 in this plan render the exact same real data as variant 0 (literal duplicate markup), never placeholder/fake numbers.
- No role gating, no wiring into the real app/auth system — `deck-preview.html` stays a standalone dev-only Vite entry (per user decision, 2026-07-05).
- Persistence file lives at `dev-workspace/6-templates/deck-style-choices.json`, envelope-shaped via the existing `wrap`/`unwrap`/`isEnvelope` from `src/data/storage/jsonEnvelope.ts` — do not reinvent hashing/versioning.
- Before applying any edit in this plan, log it in `docs/EDIT_LOG.md` per `CLAUDE.md` (version bump, date, before/after snippet).

---

## Task 1: Persistence helpers (TDD)

**Files:**
- Create: `src/dev/deckStyleChoices.ts`
- Test: `src/dev/deckStyleChoices.test.ts`

**Interfaces:**
- Produces: `readChoices(path: string): { metadata: { schemaVersion: number; revision: number; contentHash: string; writtenAt: string }; data: Record<string, number> }`, `writeChoice(path: string, slideId: string, variantIndex: number): void` — used by Task 2's Vite middleware.

- [ ] **Step 1: Write the failing test**

```typescript
// src/dev/deckStyleChoices.test.ts
import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readChoices, writeChoice } from "./deckStyleChoices";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("deckStyleChoices", () => {
  it("readChoices returns an empty envelope when the file doesn't exist", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({});
    expect(envelope.metadata.revision).toBe(0);
  });

  it("writeChoice creates the file and parent directories, and readChoices reads it back", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "6-templates", "choices.json");
    writeChoice(filePath, "slide-cover", 2);
    expect(existsSync(filePath)).toBe(true);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 2 });
    expect(envelope.metadata.revision).toBe(1);
  });

  it("writeChoice merges into existing choices and increments the revision", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    writeChoice(filePath, "slide-toc", 3);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 1, "slide-toc": 3 });
    expect(envelope.metadata.revision).toBe(2);
  });

  it("writeChoice overwrites an existing slide's choice", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    writeChoice(filePath, "slide-cover", 3);
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({ "slide-cover": 3 });
  });

  it("readChoices recovers an empty envelope if the file contains invalid JSON", () => {
    dir = mkdtempSync(join(tmpdir(), "deck-style-"));
    const filePath = join(dir, "choices.json");
    writeChoice(filePath, "slide-cover", 1);
    // Corrupt the file.
    const fs = require("node:fs") as typeof import("node:fs");
    fs.writeFileSync(filePath, "{not json", "utf-8");
    const envelope = readChoices(filePath);
    expect(envelope.data).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/dev/deckStyleChoices.test.ts`
Expected: FAIL — `Cannot find module './deckStyleChoices'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/dev/deckStyleChoices.ts
// Dev-only persistence for the deck-preview style switcher. Plain Node `fs`
// (not the browser safeWriteJson/File System Access flow the real app uses
// for user workspaces) — this file is imported only from a Vite dev-server
// middleware (deckStyleChoicesPlugin.ts), never from browser or app code.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { wrap, isEnvelope, type JsonEnvelope } from "../data/storage/jsonEnvelope";

export type DeckStyleChoices = Record<string, number>;

const EMPTY_ENVELOPE: JsonEnvelope<DeckStyleChoices> = {
  metadata: { schemaVersion: 1, revision: 0, contentHash: "", writtenAt: "" },
  data: {},
};

/** Reads the choices envelope from `path`, recovering to an empty envelope
 *  (revision 0) if the file is missing, unreadable, or not a valid envelope. */
export function readChoices(path: string): JsonEnvelope<DeckStyleChoices> {
  if (!existsSync(path)) return EMPTY_ENVELOPE;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf-8"));
    if (isEnvelope(raw)) return raw as JsonEnvelope<DeckStyleChoices>;
    return EMPTY_ENVELOPE;
  } catch {
    return EMPTY_ENVELOPE;
  }
}

/** Merges `{ [slideId]: variantIndex }` into the choices at `path` and writes
 *  the result back as a `JsonEnvelope`, creating parent directories as needed. */
export function writeChoice(path: string, slideId: string, variantIndex: number): void {
  const current = readChoices(path);
  const next: DeckStyleChoices = { ...current.data, [slideId]: variantIndex };
  const envelope = wrap(next, current.metadata.revision);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(envelope, null, 2), "utf-8");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/dev/deckStyleChoices.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Log the edit and commit**

Add a `docs/EDIT_LOG.md` entry (version bump per `CLAUDE.md` — this is new functionality, bump the whole number) with before/after for the two new files (before = "did not exist").

```bash
git add src/dev/deckStyleChoices.ts src/dev/deckStyleChoices.test.ts docs/EDIT_LOG.md
git commit -m "feat(dev): add deck style-choices persistence helpers"
```

---

## Task 2: Vite dev middleware + gitignore

**Files:**
- Create: `src/dev/deckStyleChoicesPlugin.ts`
- Modify: `vite.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `readChoices(path)`, `writeChoice(path, slideId, variantIndex)` from Task 1 (`src/dev/deckStyleChoices.ts`).
- Produces: a Vite `Plugin` (`deckStyleChoicesPlugin()`) registered in `vite.config.ts`, exposing `GET /__deck-style-choices` (returns `Record<string, number>`) and `POST /__deck-style-choices` (body `{ slideId: string; variantIndex: number }`) — consumed by Task 6's client script.

- [ ] **Step 1: Add the gitignore entry**

Edit `.gitignore`, add after the `dist-ssr` line:

```
dist-ssr
*.local
dev-workspace
```

- [ ] **Step 2: Write the plugin**

```typescript
// src/dev/deckStyleChoicesPlugin.ts
// Vite dev-server middleware exposing the deck-preview style-switcher's
// persistence endpoint. Dev-only: only registered by vite.config.ts's plugin
// list, never runs in `npm run build` output.
import type { Plugin } from "vite";
import { readChoices, writeChoice } from "./deckStyleChoices";

const ENDPOINT = "/__deck-style-choices";
const CHOICES_PATH = "dev-workspace/6-templates/deck-style-choices.json";

export function deckStyleChoicesPlugin(): Plugin {
  return {
    name: "deck-style-choices",
    configureServer(server) {
      server.middlewares.use(ENDPOINT, (req, res) => {
        if (req.method === "GET") {
          const envelope = readChoices(CHOICES_PATH);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(envelope.data));
          return;
        }
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              const parsed = JSON.parse(body) as { slideId?: unknown; variantIndex?: unknown };
              if (typeof parsed.slideId !== "string" || typeof parsed.variantIndex !== "number") {
                res.statusCode = 400;
                res.end("bad request");
                return;
              }
              writeChoice(CHOICES_PATH, parsed.slideId, parsed.variantIndex);
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ ok: true }));
            } catch {
              res.statusCode = 400;
              res.end("bad request");
            }
          });
          return;
        }
        res.statusCode = 405;
        res.end("method not allowed");
      });
    },
  };
}
```

- [ ] **Step 3: Register the plugin in vite.config.ts**

Modify `vite.config.ts`:

Before:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
```

After:
```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { deckStyleChoicesPlugin } from "./src/dev/deckStyleChoicesPlugin";

export default defineConfig({
  plugins: [react(), viteSingleFile(), deckStyleChoicesPlugin()],
```

- [ ] **Step 4: Manually verify the endpoint**

Run: `npm run dev` (background), then in another shell:

```bash
curl -s http://localhost:5173/__deck-style-choices
```
Expected: `{}`

```bash
curl -s -X POST http://localhost:5173/__deck-style-choices -H "Content-Type: application/json" -d '{"slideId":"slide-cover","variantIndex":2}'
```
Expected: `{"ok":true}`

```bash
curl -s http://localhost:5173/__deck-style-choices
```
Expected: `{"slide-cover":2}`

Confirm the file now exists: `cat dev-workspace/6-templates/deck-style-choices.json` shows a `JsonEnvelope` with `data: { "slide-cover": 2 }`. Delete `dev-workspace/` afterward so the next task starts clean (`rm -rf dev-workspace`).

- [ ] **Step 5: Log the edit and commit**

Add a `docs/EDIT_LOG.md` entry (decimal bump — this extends Task 1's feature) covering `vite.config.ts`'s before/after and the two new/modified files.

```bash
git add src/dev/deckStyleChoicesPlugin.ts vite.config.ts .gitignore docs/EDIT_LOG.md
git commit -m "feat(dev): add Vite middleware for deck style-choice persistence"
```

---

## Task 3: Variant-switcher CSS + light theme

**Files:**
- Modify: `src/data/reporting/executive/deck2/theme.ts`

**Interfaces:**
- Produces: CSS classes `.v2-variant-stack`, `.v2-variant-panel` (+ `.active`), `.v2-variant-switcher`, `.v2-variant-prev`/`.v2-variant-next`, `.v2-variant-label`, and a `body.theme-light` re-skin — consumed by Task 4's `renderVariants()` markup and Task 7's toggle button.

- [ ] **Step 1: Append the variant-switcher CSS**

Modify `src/data/reporting/executive/deck2/theme.ts`, add before the final closing backtick (after the `@media(max-width:820px)` block, i.e. append to the end of the `DECK_V2_CSS` template string):

```css

/* ── Style-variant switcher (dev-preview only, never in production output) ── */
/* .v2-variant-stack takes over the flex-sizing role of whatever container it
   sits in (`.slide-body` or directly `.slide-inner`), so wrapping existing
   content in it does not change any pixel-budget math (TABLE_BUDGET_PX etc.)
   — only the ACTIVE panel is flex/visible, matching the original single-child
   layout the budget math was measured against. */
.v2-variant-stack{
  flex:1 1 auto;min-height:0;display:flex;flex-direction:column;position:relative;
}
.v2-variant-panel{display:none;flex:1 1 auto;min-height:0;flex-direction:column;}
.v2-variant-panel.active{display:flex;}
.v2-variant-switcher{
  position:absolute;top:6px;left:6px;z-index:5;
  display:flex;align-items:center;gap:6px;
  background:rgba(2,16,30,.72);border:1px solid rgba(255,255,255,.16);border-radius:999px;
  padding:3px 8px;font-size:0.68rem;font-weight:700;color:rgba(255,255,255,.75);
}
.v2-variant-switcher button{
  border:0;background:rgba(255,255,255,.08);color:#fff;border-radius:999px;
  width:20px;height:20px;display:grid;place-items:center;cursor:pointer;font-size:0.85rem;line-height:1;
  padding:0;
}
.v2-variant-switcher button:hover{background:var(--gold);color:var(--navy);}
.v2-variant-label{min-width:32px;text-align:center;font-variant-numeric:tabular-nums;}
@media print{.v2-variant-switcher{display:none!important;}}

/* ── Light theme re-skin (dev-preview toggle) ────────────────────────────── */
/* Mirrors the old deck's `.page.light` pattern (theme.ts / EXEC_CSS): swap
   background/ink/border colors on top of whatever variant is currently
   showing, no new markup. Applies to both slides.ts's v1-shared components
   (kpi-tile, deck-table) and deck2-only components (v2-term-card, v2-stage-
   card, v2-port-col). */
body.theme-light{background:#eef2f6;}
body.theme-light .slide{
  background:linear-gradient(150deg,#ffffff,#f4f6f9 65%);
  border-color:#dde4ea;color:#0a2d4a;
}
body.theme-light .slide-headline,body.theme-light h2{color:#0a2d4a;}
body.theme-light .slide-subhead{color:#8a6d1f;}
body.theme-light .muted,body.theme-light .v2-stage-row span{color:#607386;}
body.theme-light .kpi-tile,body.theme-light .v2-term-card,body.theme-light .v2-stage-card{
  background:#ffffff;border-color:#dde4ea;color:#0a2d4a;box-shadow:0 6px 16px rgba(10,45,74,.08);
}
body.theme-light .v2-port-col{
  background:linear-gradient(180deg,#eef7ee,#e4f1e4);box-shadow:0 6px 16px rgba(10,45,74,.08);
}
body.theme-light .v2-port-col.sea{background:linear-gradient(180deg,#eaf2fb,#dfeaf8);}
body.theme-light .deck-table{background:#ffffff;color:#0a2d4a;}
body.theme-light .deck-table th{background:#0e3a5f;color:#fff;}
body.theme-light .deck-table td{border-color:#e3e8ee;}
body.theme-light .v2-rail{background:linear-gradient(180deg,#f4f6f9,#e7edf2);border-color:#dde4ea;}
body.theme-light .v2-rail-title,body.theme-light .v2-rail-tab{color:#5b6b78;}
body.theme-light .v2-variant-switcher{background:rgba(255,255,255,.85);border-color:#dde4ea;color:#3a4a58;}
body.theme-light .v2-variant-switcher button{background:rgba(10,45,74,.08);color:#0a2d4a;}
```

- [ ] **Step 2: Log the edit**

Add a `docs/EDIT_LOG.md` entry (decimal bump) with the before/after (before = file's current final lines; after = same + this appended block).

- [ ] **Step 3: Commit**

```bash
git add src/data/reporting/executive/deck2/theme.ts docs/EDIT_LOG.md
git commit -m "style(deck2): add variant-switcher chrome and light-theme CSS"
```

---

## Task 4: `renderVariants()` helper + `v2Slide()` migration

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts:113-143` (the `v2Slide` helper and its call sites listed in Tasks 5-6)

**Interfaces:**
- Produces: `function renderVariants(slideId: string, bodies: readonly [string, string, string, string], variantPreview: boolean): string` and an updated `v2Slide(opts)` signature — `body: string` becomes `bodyVariants: readonly [string, string, string, string]; variantPreview: boolean`. Every caller of `v2Slide` (Tasks 5-6) must be updated in the same commit or the file won't compile.

- [ ] **Step 1: Add `renderVariants()` and update `v2Slide()`**

Modify `src/data/reporting/executive/deck2/slides.ts`.

Before (lines 106-143):
```typescript
/** Footer page number, centered with short gold rules either side (the
 *  references' bottom-of-page device). Absolutely positioned inside the
 *  slide's existing bottom padding band — no impact on the body budget. */
function pageFoot(num: number, total: number): string {
  return `<div class="v2-page-foot" dir="ltr">${pad(num)} / ${pad(total)}</div>`;
}

// ── v2 slide shell — rail + eyebrow + headline + body + footer page num. ────
// Unlike v1 there is no "decision footer"; the footer concept is gone in v2.
function v2Slide(opts: {
  id: string;
  title: string;
  eyebrow: string;
  iconName: string;
  headline: string;
  subhead?: string;
  body: string;
  num: number;
  total: number;
  slideClass?: string;
  section: NavSectionKey;
}): string {
  const cls = `slide v2${opts.slideClass ? " " + opts.slideClass : ""}`;
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}" data-section="${opts.section}" data-section-label="${esc(NAV_SECTIONS[opts.section])}">
  ${printToggle()}
  ${sideRail(opts.section)}
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(opts.iconName, 16)}</span>
      <span>${esc(opts.eyebrow)}</span>
    </div>
    <div class="slide-headline">${esc(opts.headline)}</div>
    ${opts.subhead ? `<div class="slide-subhead">${esc(opts.subhead)}</div>` : ""}
    <div class="slide-body">${opts.body}</div>
  </div>
  ${pageFoot(opts.num, opts.total)}
</section>`;
}
```

After:
```typescript
/** Footer page number, centered with short gold rules either side (the
 *  references' bottom-of-page device). Absolutely positioned inside the
 *  slide's existing bottom padding band — no impact on the body budget. */
function pageFoot(num: number, total: number): string {
  return `<div class="v2-page-foot" dir="ltr">${pad(num)} / ${pad(total)}</div>`;
}

/**
 * Wraps a slide's varying content into 1-of-4 selectable style variants.
 * Production (`variantPreview=false`) renders ONLY `bodies[0]` — byte-identical
 * to the single-variant output that existed before the switcher (a dev-preview
 * feature; see docs/superpowers/specs/2026-07-05-deck2-style-switcher-design.md).
 * Preview mode renders all 4, one visible via CSS (`.v2-variant-panel.active`),
 * plus an arrow-cycle control; the inline script in deck2/index.ts
 * (DECK_VARIANT_SCRIPT) does the cycling and persists the choice.
 */
function renderVariants(
  slideId: string,
  bodies: readonly [string, string, string, string],
  variantPreview: boolean,
): string {
  if (!variantPreview) return bodies[0];
  const panels = bodies
    .map(
      (html, i) =>
        `<div class="v2-variant-panel${i === 0 ? " active" : ""}" data-variant-index="${i}">${html}</div>`,
    )
    .join("");
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="0">
    <div class="v2-variant-switcher">
      <button type="button" class="v2-variant-prev" aria-label="النمط السابق">‹</button>
      <span class="v2-variant-label">1 / 4</span>
      <button type="button" class="v2-variant-next" aria-label="النمط التالي">›</button>
    </div>
    ${panels}
  </div>`;
}

// ── v2 slide shell — rail + eyebrow + headline + body + footer page num. ────
// Unlike v1 there is no "decision footer"; the footer concept is gone in v2.
function v2Slide(opts: {
  id: string;
  title: string;
  eyebrow: string;
  iconName: string;
  headline: string;
  subhead?: string;
  bodyVariants: readonly [string, string, string, string];
  variantPreview: boolean;
  num: number;
  total: number;
  slideClass?: string;
  section: NavSectionKey;
}): string {
  const cls = `slide v2${opts.slideClass ? " " + opts.slideClass : ""}`;
  const body = renderVariants(opts.id, opts.bodyVariants, opts.variantPreview);
  return `<section class="${cls}" id="${esc(opts.id)}" data-title="${esc(opts.title)}" data-section="${opts.section}" data-section-label="${esc(NAV_SECTIONS[opts.section])}">
  ${printToggle()}
  ${sideRail(opts.section)}
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(opts.iconName, 16)}</span>
      <span>${esc(opts.eyebrow)}</span>
    </div>
    <div class="slide-headline">${esc(opts.headline)}</div>
    ${opts.subhead ? `<div class="slide-subhead">${esc(opts.subhead)}</div>` : ""}
    <div class="slide-body">${body}</div>
  </div>
  ${pageFoot(opts.num, opts.total)}
</section>`;
}
```

This alone will not compile (every caller of `v2Slide` still passes `body`, not `bodyVariants`/`variantPreview`) — Tasks 5 and 6 fix every call site in the same file. Do not attempt to run `npx tsc -b` until Task 6's last step.

- [ ] **Step 2: Commit as part of Task 6** (this task has no independent compile-clean checkpoint; its steps are verified together with Tasks 5-6's last step).

---

## Task 5: Migrate cover, TOC, glossary, and separator builders

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts` (functions `coverSlide`, `tocSlide`, `glossarySlideBuilders`, `sectionSeparatorSlide`)

**Interfaces:**
- Consumes: `renderVariants()`, updated `v2Slide()` from Task 4.
- Produces: `coverSlide(model, generatedAt, variantPreview)`, `tocSlide(items, num, total, variantPreview)`, `glossarySlideBuilders(variantPreview)`, `sectionSeparatorSlide(sectionNo, sectionKey, iconName, title, blurb, num, total, variantPreview)` — consumed by Task 6's `buildDeckV2Slides`.

- [ ] **Step 1: Migrate `coverSlide`**

Before (lines 145-185):
```typescript
// ── Page 1 — الغلاف ─────────────────────────────────────────────────────────
export function coverSlide(model: ReportModel, generatedAt: Date): string {
  const [, department, section] = ORGANIZATION_PATH;
  const meta = [
    { label: "فترة الدراسة (عيّنة شهر)", value: model.summary.periodId, iconName: "layers" },
    { label: "تاريخ إصدار التقرير", value: formatDate(generatedAt), iconName: "document" },
    { label: "الإدارة", value: department, iconName: "users" },
    { label: "القسم", value: section, iconName: "shield" },
  ]
    .map(
      (m) => `<div class="v2-cover-meta-item">
        <span class="v2-cover-meta-icon">${badgeIcon(m.iconName, 20)}</span>
        <span class="v2-cover-meta-text">
          <span class="v2-cover-meta-label">${esc(m.label)}</span>
          <span class="v2-cover-meta-value">${esc(m.value)}</span>
        </span>
      </div>`,
    )
    .join("");
  // Org header block (per the reference mockups): logo + gold divider + the
  // organizational hierarchy lines, top-start of the page.
  const orgBlock = `<div class="v2-org">
      <img class="v2-org-logo" src="${ZATCA_LOGO_URL}" alt="هيئة الزكاة والضريبة والجمارك"/>
      <div class="v2-org-lines">
        <b>هيئة الزكاة والضريبة والجمارك</b>
        ${ORGANIZATION_PATH.map((line) => `<span>${esc(line)}</span>`).join("")}
      </div>
    </div>`;
  return `<section class="slide v2 title-slide" id="slide-cover" data-title="الغلاف" data-section="cover" data-section-label="${esc(NAV_SECTIONS.cover)}">
    ${printToggle()}
    <div class="slide-art" aria-hidden="true"></div>
    ${orgBlock}
    <div class="slide-inner">
      <div class="title-kicker">عرض تنفيذي</div>
      <h1>تقرير ضمان جودة فحص الأشعة</h1>
      <div class="title-rule"></div>
      <div class="v2-cover-meta">${meta}</div>
      <div class="title-classify"><span>${icon("shield", 14)}</span>داخلي — للاستخدام التنفيذي</div>
    </div>
  </section>`;
}
```

After:
```typescript
// ── Page 1 — الغلاف ─────────────────────────────────────────────────────────
export function coverSlide(model: ReportModel, generatedAt: Date, variantPreview: boolean): string {
  const [, department, section] = ORGANIZATION_PATH;
  const meta = [
    { label: "فترة الدراسة (عيّنة شهر)", value: model.summary.periodId, iconName: "layers" },
    { label: "تاريخ إصدار التقرير", value: formatDate(generatedAt), iconName: "document" },
    { label: "الإدارة", value: department, iconName: "users" },
    { label: "القسم", value: section, iconName: "shield" },
  ]
    .map(
      (m) => `<div class="v2-cover-meta-item">
        <span class="v2-cover-meta-icon">${badgeIcon(m.iconName, 20)}</span>
        <span class="v2-cover-meta-text">
          <span class="v2-cover-meta-label">${esc(m.label)}</span>
          <span class="v2-cover-meta-value">${esc(m.value)}</span>
        </span>
      </div>`,
    )
    .join("");
  // Org header block (per the reference mockups): logo + gold divider + the
  // organizational hierarchy lines, top-start of the page.
  const orgBlock = `<div class="v2-org">
      <img class="v2-org-logo" src="${ZATCA_LOGO_URL}" alt="هيئة الزكاة والضريبة والجمارك"/>
      <div class="v2-org-lines">
        <b>هيئة الزكاة والضريبة والجمارك</b>
        ${ORGANIZATION_PATH.map((line) => `<span>${esc(line)}</span>`).join("")}
      </div>
    </div>`;
  const coverBody = `<div class="title-kicker">عرض تنفيذي</div>
      <h1>تقرير ضمان جودة فحص الأشعة</h1>
      <div class="title-rule"></div>
      <div class="v2-cover-meta">${meta}</div>
      <div class="title-classify"><span>${icon("shield", 14)}</span>داخلي — للاستخدام التنفيذي</div>`;
  const body = renderVariants("slide-cover", [coverBody, coverBody, coverBody, coverBody], variantPreview);
  return `<section class="slide v2 title-slide" id="slide-cover" data-title="الغلاف" data-section="cover" data-section-label="${esc(NAV_SECTIONS.cover)}">
    ${printToggle()}
    <div class="slide-art" aria-hidden="true"></div>
    ${orgBlock}
    <div class="slide-inner">
      ${body}
    </div>
  </section>`;
}
```

- [ ] **Step 2: Migrate `tocSlide`**

Before (lines 187-212):
```typescript
export function tocSlide(items: TocItem[], num: number, total: number): string {
  const body = `<div class="deck-agenda">${items
    .map(
      (it, i) => `<div class="deck-agenda-item">
        <div class="deck-agenda-num">${pad(i + 1)}</div>
        <div class="deck-agenda-body"><h4><span class="deck-agenda-icon">${icon(it.iconName, 15)}</span>${esc(it.title)}</h4><p>${esc(it.goal)}</p></div>
        <div class="deck-agenda-range" dir="ltr">${esc(it.range)}</div>
      </div>`,
    )
    .join("")}</div>`;
  return v2Slide({
    id: "slide-toc",
    title: "المحتويات",
    eyebrow: "المحتويات",
    iconName: "layers",
    headline: "محتويات التقرير",
    subhead: "أقسام التقرير والهدف من كل قسم.",
    body,
    num,
    total,
    section: "toc",
  });
}
```

After:
```typescript
export function tocSlide(items: TocItem[], num: number, total: number, variantPreview: boolean): string {
  const body = `<div class="deck-agenda">${items
    .map(
      (it, i) => `<div class="deck-agenda-item">
        <div class="deck-agenda-num">${pad(i + 1)}</div>
        <div class="deck-agenda-body"><h4><span class="deck-agenda-icon">${icon(it.iconName, 15)}</span>${esc(it.title)}</h4><p>${esc(it.goal)}</p></div>
        <div class="deck-agenda-range" dir="ltr">${esc(it.range)}</div>
      </div>`,
    )
    .join("")}</div>`;
  return v2Slide({
    id: "slide-toc",
    title: "المحتويات",
    eyebrow: "المحتويات",
    iconName: "layers",
    headline: "محتويات التقرير",
    subhead: "أقسام التقرير والهدف من كل قسم.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "toc",
  });
}
```

- [ ] **Step 3: Migrate `glossarySlideBuilders`**

Before (lines 247-270):
```typescript
/** Build one or more المعجم slides (paginated card grid, per the reference design). */
export function glossarySlideBuilders(): SlideBuilder[] {
  const pages = Math.max(1, Math.ceil(GLOSSARY.length / GLOSSARY_TERMS_PER_PAGE));
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < pages; page++) {
    const chunk = GLOSSARY.slice(page * GLOSSARY_TERMS_PER_PAGE, (page + 1) * GLOSSARY_TERMS_PER_PAGE);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) =>
      v2Slide({
        id: `slide-glossary-${page + 1}`,
        title: `المعجم${cont}`,
        eyebrow: "المعجم",
        iconName: "document",
        headline: `المعجم — المصطلحات الرئيسية${cont}`,
        subhead: "توحيد المصطلحات قبل قراءة النتائج.",
        body: `<div class="v2-term-grid">${chunk.map(termCard).join("")}</div>`,
        num,
        total,
        section: "glossary",
      }),
    );
  }
  return builders;
}
```

After:
```typescript
/** Build one or more المعجم slides (paginated card grid, per the reference design). */
export function glossarySlideBuilders(variantPreview: boolean): SlideBuilder[] {
  const pages = Math.max(1, Math.ceil(GLOSSARY.length / GLOSSARY_TERMS_PER_PAGE));
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < pages; page++) {
    const chunk = GLOSSARY.slice(page * GLOSSARY_TERMS_PER_PAGE, (page + 1) * GLOSSARY_TERMS_PER_PAGE);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-term-grid">${chunk.map(termCard).join("")}</div>`;
      return v2Slide({
        id: `slide-glossary-${page + 1}`,
        title: `المعجم${cont}`,
        eyebrow: "المعجم",
        iconName: "document",
        headline: `المعجم — المصطلحات الرئيسية${cont}`,
        subhead: "توحيد المصطلحات قبل قراءة النتائج.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "glossary",
      });
    });
  }
  return builders;
}
```

- [ ] **Step 4: Migrate `sectionSeparatorSlide`**

Before (lines 272-301):
```typescript
// ── Section separator (page 4 pattern) ──────────────────────────────────────
export function sectionSeparatorSlide(
  sectionNo: number,
  sectionKey: NavSectionKey,
  iconName: string,
  title: string,
  blurb: string,
  num: number,
  total: number,
): string {
  return `<section class="slide v2" id="slide-sep-${sectionNo}" data-title="${esc(title)}" data-section="${sectionKey}" data-section-label="${esc(NAV_SECTIONS[sectionKey])}">
  ${printToggle()}
  ${sideRail(sectionKey)}
  <div class="v2-sep-bg" aria-hidden="true"></div>
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(iconName, 16)}</span>
      <span>القسم ${esc(String(sectionNo))}</span>
    </div>
    <div class="v2-sep">
      <div class="v2-sep-icon">${badgeIcon(iconName, 30)}</div>
      <div class="v2-sep-num">${pad(sectionNo)}</div>
      <h2>${esc(title)}</h2>
      <div class="v2-sep-rule"></div>
      <p>${esc(blurb)}</p>
    </div>
  </div>
  ${pageFoot(num, total)}
</section>`;
}
```

After:
```typescript
// ── Section separator (page 4 pattern) ──────────────────────────────────────
export function sectionSeparatorSlide(
  sectionNo: number,
  sectionKey: NavSectionKey,
  iconName: string,
  title: string,
  blurb: string,
  num: number,
  total: number,
  variantPreview: boolean,
): string {
  const sepBody = `<div class="v2-sep">
      <div class="v2-sep-icon">${badgeIcon(iconName, 30)}</div>
      <div class="v2-sep-num">${pad(sectionNo)}</div>
      <h2>${esc(title)}</h2>
      <div class="v2-sep-rule"></div>
      <p>${esc(blurb)}</p>
    </div>`;
  const body = renderVariants(`slide-sep-${sectionNo}`, [sepBody, sepBody, sepBody, sepBody], variantPreview);
  return `<section class="slide v2" id="slide-sep-${sectionNo}" data-title="${esc(title)}" data-section="${sectionKey}" data-section-label="${esc(NAV_SECTIONS[sectionKey])}">
  ${printToggle()}
  ${sideRail(sectionKey)}
  <div class="v2-sep-bg" aria-hidden="true"></div>
  <div class="slide-inner">
    <div class="slide-eyebrow">
      <span class="slide-eyebrow-icon">${icon(iconName, 16)}</span>
      <span>القسم ${esc(String(sectionNo))}</span>
    </div>
    ${body}
  </div>
  ${pageFoot(num, total)}
</section>`;
}
```

- [ ] **Step 5: Do not run the build yet** — `riskStagesSlide` and the port-table builders (Task 6) still pass the old `body:` shape to `v2Slide`, and `buildDeckV2Slides` still calls all of these with their old (pre-`variantPreview`) signatures. Compilation is verified at the end of Task 6.

---

## Task 6: Migrate risk-stages, port-table builders, and the assembly function

**Files:**
- Modify: `src/data/reporting/executive/deck2/slides.ts` (functions `riskStagesSlide`, `portPopulationSlideBuilders`, `portSampleSlideBuilders`, `qualityPortSlideBuilders`, `accuracyPortSlideBuilders`, `buildDeckV2Slides`)

**Interfaces:**
- Consumes: `renderVariants()`/`v2Slide()` from Task 4, migrated builders from Task 5.
- Produces: `buildDeckV2Slides(model, generatedAt, variantPreview)` — the full signature consumed by Task 7's `deck2/index.ts`.

- [ ] **Step 1: Migrate `riskStagesSlide`**

Before (lines 316-354):
```typescript
export function riskStagesSlide(model: ReportModel, num: number, total: number): string {
  const stages = model.population.byStage;
  const tiles = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const tag = STAGE_SHORT_TAG[s.stageLabel] ?? `المستوى ${i + 1}`;
      return `<div class="v2-stage-card ${tone}">
        <div class="v2-stage-head">
          <span class="v2-stage-num">${i + 1}</span>
          <b>${esc(s.stageLabel)}</b>
        </div>
        <div class="v2-stage-list">
          <div class="v2-stage-row"><span>الحالات</span><b>${fmtNum(s.population)}</b></div>
          <div class="v2-stage-row"><span>العيّنة</span><b>${fmtNum(s.sampleSize)}</b></div>
          <div class="v2-stage-row"><span>التغطية</span><b>${fmtPct(s.coverage)}</b></div>
        </div>
        <div class="v2-stage-tag">${esc(tag)}</div>
      </div>`;
    })
    .join("");
  const totals = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 18)}</span><span><b>${fmtNum(model.population.total)}</b><small>إجمالي المجتمع (حالة)</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("scan", 18)}</span><span><b>${fmtNum(model.sample.total)}</b><small>إجمالي العيّنة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("gauge", 18)}</span><span><b>${fmtPct(model.sample.coverage)}</b><small>التغطية الكلية</small></span></div>
  </div>`;
  const body = `<div class="kpi-band n${Math.min(4, Math.max(2, stages.length))}">${tiles}</div>${totals}`;
  return v2Slide({
    id: "slide-risk-stages",
    title: "مجتمع الحالات بناءً على المخاطر",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "gauge",
    headline: "مجتمع الحالات بناءً على المخاطر",
    subhead: "توزيع المجتمع بعد المعالجة على مستويات المخاطر الأربعة، وحصة كل مستوى من العيّنة.",
    body,
    num,
    total,
    section: "section1",
  });
}
```

After (only the last two blocks change — the `tiles`/`totals`/`body` construction is untouched):
```typescript
export function riskStagesSlide(model: ReportModel, num: number, total: number, variantPreview: boolean): string {
  const stages = model.population.byStage;
  const tiles = stages
    .map((s, i) => {
      const tone = STAGE_TONES[i % STAGE_TONES.length];
      const tag = STAGE_SHORT_TAG[s.stageLabel] ?? `المستوى ${i + 1}`;
      return `<div class="v2-stage-card ${tone}">
        <div class="v2-stage-head">
          <span class="v2-stage-num">${i + 1}</span>
          <b>${esc(s.stageLabel)}</b>
        </div>
        <div class="v2-stage-list">
          <div class="v2-stage-row"><span>الحالات</span><b>${fmtNum(s.population)}</b></div>
          <div class="v2-stage-row"><span>العيّنة</span><b>${fmtNum(s.sampleSize)}</b></div>
          <div class="v2-stage-row"><span>التغطية</span><b>${fmtPct(s.coverage)}</b></div>
        </div>
        <div class="v2-stage-tag">${esc(tag)}</div>
      </div>`;
    })
    .join("");
  const totals = `<div class="v2-totals-band">
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("layers", 18)}</span><span><b>${fmtNum(model.population.total)}</b><small>إجمالي المجتمع (حالة)</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("scan", 18)}</span><span><b>${fmtNum(model.sample.total)}</b><small>إجمالي العيّنة</small></span></div>
    <div class="v2-totals-item"><span class="v2-totals-icon">${icon("gauge", 18)}</span><span><b>${fmtPct(model.sample.coverage)}</b><small>التغطية الكلية</small></span></div>
  </div>`;
  const body = `<div class="kpi-band n${Math.min(4, Math.max(2, stages.length))}">${tiles}</div>${totals}`;
  return v2Slide({
    id: "slide-risk-stages",
    title: "مجتمع الحالات بناءً على المخاطر",
    eyebrow: "القسم 1 — مجتمع الفحص",
    iconName: "gauge",
    headline: "مجتمع الحالات بناءً على المخاطر",
    subhead: "توزيع المجتمع بعد المعالجة على مستويات المخاطر الأربعة، وحصة كل مستوى من العيّنة.",
    bodyVariants: [body, body, body, body],
    variantPreview,
    num,
    total,
    section: "section1",
  });
}
```

- [ ] **Step 2: Migrate `portPopulationSlideBuilders`**

Before (lines 530-555):
```typescript
/** Build one or more port-population slides (paginated land/sea in parallel). */
export function portPopulationSlideBuilders(model: ReportModel): SlideBuilder[] {
  const { land, sea } = collectPortStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) =>
      v2Slide({
        id: `slide-port-population-${page + 1}`,
        title: `مجتمع حالات الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `مجتمع حالات الفحص لشهر ${model.summary.periodId}${cont}`,
        subhead: "منهجية التصنيف: تُصنَّف الحالة اشتباهًا إذا كانت نتيجة المستوى الأول أو الثاني اشتباهًا، وفي غير ذلك تُصنَّف سليمة.",
        body: `<div class="v2-port-split">${portTable("المنافذ البرية", landChunk, "population", "land", plan.compact)}${portTable("المنافذ البحرية", seaChunk, "population", "sea", plan.compact)}</div>`,
        num,
        total,
        section: "section1",
      }),
    );
  }
  return builders;
}
```

After:
```typescript
/** Build one or more port-population slides (paginated land/sea in parallel). */
export function portPopulationSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${portTable("المنافذ البرية", landChunk, "population", "land", plan.compact)}${portTable("المنافذ البحرية", seaChunk, "population", "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-port-population-${page + 1}`,
        title: `مجتمع حالات الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `مجتمع حالات الفحص لشهر ${model.summary.periodId}${cont}`,
        subhead: "منهجية التصنيف: تُصنَّف الحالة اشتباهًا إذا كانت نتيجة المستوى الأول أو الثاني اشتباهًا، وفي غير ذلك تُصنَّف سليمة.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section1",
      });
    });
  }
  return builders;
}
```

- [ ] **Step 3: Migrate `portSampleSlideBuilders`**

Before (lines 557-582):
```typescript
/** Sample mirror of the population page: sample figures stacked over their population base + coverage. */
export function portSampleSlideBuilders(model: ReportModel): SlideBuilder[] {
  const { land, sea } = collectPortStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) =>
      v2Slide({
        id: `slide-port-sample-${page + 1}`,
        title: `عيّنة الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `عيّنة الفحص المسحوبة لشهر ${model.summary.periodId}${cont}`,
        subhead: "الصفحة نفسها بأرقام العيّنة: كل رقم عيّنة وتحته أساسه من المجتمع، مع نسبة التغطية.",
        body: `<div class="v2-port-split">${portTable("المنافذ البرية", landChunk, "sample", "land", plan.compact)}${portTable("المنافذ البحرية", seaChunk, "sample", "sea", plan.compact)}</div>`,
        num,
        total,
        section: "section1",
      }),
    );
  }
  return builders;
}
```

After:
```typescript
/** Sample mirror of the population page: sample figures stacked over their population base + coverage. */
export function portSampleSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${portTable("المنافذ البرية", landChunk, "sample", "land", plan.compact)}${portTable("المنافذ البحرية", seaChunk, "sample", "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-port-sample-${page + 1}`,
        title: `عيّنة الفحص${cont}`,
        eyebrow: "القسم 1 — مجتمع الفحص",
        iconName: "port",
        headline: `عيّنة الفحص المسحوبة لشهر ${model.summary.periodId}${cont}`,
        subhead: "الصفحة نفسها بأرقام العيّنة: كل رقم عيّنة وتحته أساسه من المجتمع، مع نسبة التغطية.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section1",
      });
    });
  }
  return builders;
}
```

- [ ] **Step 4: Migrate `qualityPortSlideBuilders`**

Before (lines 700-725):
```typescript
/** Build one or more image-quality slides (paginated land/sea in parallel). */
export function qualityPortSlideBuilders(model: ReportModel): SlideBuilder[] {
  const { land, sea } = collectPortQualityStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) =>
      v2Slide({
        id: `slide-quality-ports-${page + 1}`,
        title: `نتائج جودة الصور${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "scan",
        headline: `نتائج جودة الصور في المنافذ${cont}`,
        subhead: "توزيع مستويات جودة الصورة (عالي / متوسط / منخفض) ونسبة وجود التحديد في كل منفذ.",
        body: `<div class="v2-port-split">${qualityTable("المنافذ البرية", landChunk, "land", plan.compact)}${qualityTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`,
        num,
        total,
        section: "section2",
      }),
    );
  }
  return builders;
}
```

After:
```typescript
/** Build one or more image-quality slides (paginated land/sea in parallel). */
export function qualityPortSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortQualityStats(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${qualityTable("المنافذ البرية", landChunk, "land", plan.compact)}${qualityTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-quality-ports-${page + 1}`,
        title: `نتائج جودة الصور${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "scan",
        headline: `نتائج جودة الصور في المنافذ${cont}`,
        subhead: "توزيع مستويات جودة الصورة (عالي / متوسط / منخفض) ونسبة وجود التحديد في كل منفذ.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section2",
      });
    });
  }
  return builders;
}
```

- [ ] **Step 5: Migrate `accuracyPortSlideBuilders`**

Before (lines 816-841):
```typescript
/** Build one or more port-accuracy slides (paginated land/sea in parallel). */
export function accuracyPortSlideBuilders(model: ReportModel): SlideBuilder[] {
  const { land, sea } = collectPortAccuracyRows(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) =>
      v2Slide({
        id: `slide-quality-accuracy-${page + 1}`,
        title: `دقة نتائج المنافذ${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "gauge",
        headline: `نتائج دقة نتائج المنافذ (اشتباه / سليمة)${cont}`,
        subhead: "الدقة العامة، ودقة اكتشاف الاشتباه، ودقة تأكيد السليمة.",
        body: `<div class="v2-port-split">${accuracyTable("المنافذ البرية", landChunk, "land", plan.compact)}${accuracyTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`,
        num,
        total,
        section: "section2",
      }),
    );
  }
  return builders;
}
```

After:
```typescript
/** Build one or more port-accuracy slides (paginated land/sea in parallel). */
export function accuracyPortSlideBuilders(model: ReportModel, variantPreview: boolean): SlideBuilder[] {
  const { land, sea } = collectPortAccuracyRows(model);
  const plan = planPortPages(land.length, sea.length, BASE_ROWS_PER_PAGE);
  const builders: SlideBuilder[] = [];
  for (let page = 0; page < plan.pages; page++) {
    const landChunk = land.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const seaChunk = sea.slice(page * plan.rowsPerPage, (page + 1) * plan.rowsPerPage);
    const cont = page > 0 ? " (تابع)" : "";
    builders.push((num, total) => {
      const body = `<div class="v2-port-split">${accuracyTable("المنافذ البرية", landChunk, "land", plan.compact)}${accuracyTable("المنافذ البحرية", seaChunk, "sea", plan.compact)}</div>`;
      return v2Slide({
        id: `slide-quality-accuracy-${page + 1}`,
        title: `دقة نتائج المنافذ${cont}`,
        eyebrow: "القسم 2 — نتائج فحص الجودة",
        iconName: "gauge",
        headline: `نتائج دقة نتائج المنافذ (اشتباه / سليمة)${cont}`,
        subhead: "الدقة العامة، ودقة اكتشاف الاشتباه، ودقة تأكيد السليمة.",
        bodyVariants: [body, body, body, body],
        variantPreview,
        num,
        total,
        section: "section2",
      });
    });
  }
  return builders;
}
```

- [ ] **Step 6: Migrate `buildDeckV2Slides`**

Before (lines 849-928, the whole assembly function):
```typescript
export function buildDeckV2Slides(model: ReportModel, generatedAt = new Date()): string {
  const glossaryBuilders = glossarySlideBuilders(); // 1..N pages, paginated by term count

  // Section 1 — مجتمع الفحص: separator + risk stages + port tables (1..N pages).
  const sectionOne: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(
        1,
        "section1",
        "layers",
        "مجتمع الفحص",
        "التعريف بمجتمع الحالات لهذا الشهر: حجمه، توزيعه على مستويات المخاطر، وتوزيعه على المنافذ البرية والبحرية — الأساس الذي سُحبت منه العيّنة.",
        num,
        total,
      ),
    (num, total) => riskStagesSlide(model, num, total),
    ...portPopulationSlideBuilders(model),
    ...portSampleSlideBuilders(model),
  ];

  // Section 2 — نتائج فحص الجودة: separator + image-quality page(s) + accuracy page(s).
  const sectionTwo: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(
        2,
        "section2",
        "gauge",
        "نتائج فحص الجودة",
        "جودة الصور المفحوصة في كل منفذ (التوفر والتحديد والجودة المقبولة)، ودقة قرارات الفحص بين الاشتباه والسليمة.",
        num,
        total,
      ),
    ...qualityPortSlideBuilders(model),
    ...accuracyPortSlideBuilders(model),
  ];

  const total = 2 + glossaryBuilders.length + sectionOne.length + sectionTwo.length; // cover + toc + glossary(N) + section 1 + section 2
  const glossaryStart = 3;
  const glossaryEnd = 2 + glossaryBuilders.length;
  const sectionOneStart = glossaryEnd + 1;
  const sectionOneEnd = sectionOneStart + sectionOne.length - 1;
  const sectionTwoStart = sectionOneEnd + 1;

  const tocItems: TocItem[] = [
    {
      title: "المعجم",
      goal: "توحيد المصطلحات الرئيسية قبل قراءة النتائج.",
      range: glossaryEnd > glossaryStart ? `${pad(glossaryStart)}–${pad(glossaryEnd)}` : pad(glossaryStart),
      iconName: "document",
    },
    {
      title: "القسم الأول — مجتمع الفحص",
      goal: "التعريف بمجتمع الحالات وتوزيعه بحسب المخاطر والمنافذ، وأساس سحب العيّنة.",
      range: `${pad(sectionOneStart)}–${pad(sectionOneEnd)}`,
      iconName: "layers",
    },
    {
      title: "القسم الثاني — نتائج فحص الجودة",
      goal: "جودة الصور المفحوصة، ودقة قرارات الفحص بين الاشتباه والسليمة، لكل منفذ.",
      range: `${pad(sectionTwoStart)}–${pad(total)}`,
      iconName: "gauge",
    },
  ];

  const slides: string[] = [coverSlide(model, generatedAt), tocSlide(tocItems, 2, total)];
  let num = glossaryStart;
  for (const build of glossaryBuilders) {
    slides.push(build(num, total));
    num += 1;
  }
  for (const build of sectionOne) {
    slides.push(build(num, total));
    num += 1;
  }
  for (const build of sectionTwo) {
    slides.push(build(num, total));
    num += 1;
  }
  return slides.join("\n");
}
```

After:
```typescript
export function buildDeckV2Slides(
  model: ReportModel,
  generatedAt = new Date(),
  variantPreview = false,
): string {
  const glossaryBuilders = glossarySlideBuilders(variantPreview); // 1..N pages, paginated by term count

  // Section 1 — مجتمع الفحص: separator + risk stages + port tables (1..N pages).
  const sectionOne: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(
        1,
        "section1",
        "layers",
        "مجتمع الفحص",
        "التعريف بمجتمع الحالات لهذا الشهر: حجمه، توزيعه على مستويات المخاطر، وتوزيعه على المنافذ البرية والبحرية — الأساس الذي سُحبت منه العيّنة.",
        num,
        total,
        variantPreview,
      ),
    (num, total) => riskStagesSlide(model, num, total, variantPreview),
    ...portPopulationSlideBuilders(model, variantPreview),
    ...portSampleSlideBuilders(model, variantPreview),
  ];

  // Section 2 — نتائج فحص الجودة: separator + image-quality page(s) + accuracy page(s).
  const sectionTwo: SlideBuilder[] = [
    (num, total) =>
      sectionSeparatorSlide(
        2,
        "section2",
        "gauge",
        "نتائج فحص الجودة",
        "جودة الصور المفحوصة في كل منفذ (التوفر والتحديد والجودة المقبولة)، ودقة قرارات الفحص بين الاشتباه والسليمة.",
        num,
        total,
        variantPreview,
      ),
    ...qualityPortSlideBuilders(model, variantPreview),
    ...accuracyPortSlideBuilders(model, variantPreview),
  ];

  const total = 2 + glossaryBuilders.length + sectionOne.length + sectionTwo.length; // cover + toc + glossary(N) + section 1 + section 2
  const glossaryStart = 3;
  const glossaryEnd = 2 + glossaryBuilders.length;
  const sectionOneStart = glossaryEnd + 1;
  const sectionOneEnd = sectionOneStart + sectionOne.length - 1;
  const sectionTwoStart = sectionOneEnd + 1;

  const tocItems: TocItem[] = [
    {
      title: "المعجم",
      goal: "توحيد المصطلحات الرئيسية قبل قراءة النتائج.",
      range: glossaryEnd > glossaryStart ? `${pad(glossaryStart)}–${pad(glossaryEnd)}` : pad(glossaryStart),
      iconName: "document",
    },
    {
      title: "القسم الأول — مجتمع الفحص",
      goal: "التعريف بمجتمع الحالات وتوزيعه بحسب المخاطر والمنافذ، وأساس سحب العيّنة.",
      range: `${pad(sectionOneStart)}–${pad(sectionOneEnd)}`,
      iconName: "layers",
    },
    {
      title: "القسم الثاني — نتائج فحص الجودة",
      goal: "جودة الصور المفحوصة، ودقة قرارات الفحص بين الاشتباه والسليمة، لكل منفذ.",
      range: `${pad(sectionTwoStart)}–${pad(total)}`,
      iconName: "gauge",
    },
  ];

  const slides: string[] = [
    coverSlide(model, generatedAt, variantPreview),
    tocSlide(tocItems, 2, total, variantPreview),
  ];
  let num = glossaryStart;
  for (const build of glossaryBuilders) {
    slides.push(build(num, total));
    num += 1;
  }
  for (const build of sectionOne) {
    slides.push(build(num, total));
    num += 1;
  }
  for (const build of sectionTwo) {
    slides.push(build(num, total));
    num += 1;
  }
  return slides.join("\n");
}
```

- [ ] **Step 7: Verify the file compiles**

Run: `npx tsc -b --noEmit`
Expected: no errors referencing `slides.ts`. (`deck2/index.ts` still calls `buildDeckV2Slides(model)` with 2 args — that remains valid since `generatedAt` and `variantPreview` both have defaults — so this compiles cleanly even before Task 7.)

- [ ] **Step 8: Log the edit and commit**

Add one `docs/EDIT_LOG.md` entry (major bump — this is the architectural change enabling the switcher) covering all of Tasks 4-6's changes to `slides.ts` (list each function touched).

```bash
git add src/data/reporting/executive/deck2/slides.ts docs/EDIT_LOG.md
git commit -m "feat(deck2): add 4-variant plumbing to every slide builder"
```

---

## Task 7: Wire `variantPreview` through `deck2/index.ts`

**Files:**
- Modify: `src/data/reporting/executive/deck2/index.ts`

**Interfaces:**
- Consumes: `buildDeckV2Slides(model, generatedAt, variantPreview)` from Task 6.
- Produces: `buildExecutiveDeckV2(input, employeeDisplayNames?, opts?: { variantPreview?: boolean })` — consumed by Task 8's `deckPreview.ts`.

- [ ] **Step 1: Add the variant-cycling client script and thread `variantPreview`**

Before (lines 74-131, the whole remainder of the file):
```typescript
export function buildDeckV2Html(slides: string, monthLabel: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>العرض التنفيذي — ${esc(monthLabel)}</title>
<style>${DECK_CSS}${DECK_V2_CSS}</style>
</head>
<body>
<nav class="deck-nav" id="deck-nav" aria-label="التنقّل بين أقسام العرض">
  <div class="deck-nav-brand">
    <span class="deck-nav-brand-icon">${icon("shield", 20)}</span>
    <span>العرض التنفيذي</span>
  </div>
  <div class="deck-nav-progress">
    <div class="deck-nav-progress-bar"><div class="deck-nav-progress-fill" id="deck-nav-fill"></div></div>
    <div class="deck-nav-progress-text" id="deck-nav-progress-text">الصفحة 1</div>
  </div>
  <ol class="deck-nav-sections" id="deck-nav-sections"></ol>
</nav>
<div class="deck-viewer deck-viewer-v2">
  <div class="deck-toolbar">
    <div class="deck-brand">
      <div class="brand-mark">${icon("shield", 22)}</div>
      <div>
        <strong>العرض التنفيذي</strong>
        <span>ضمان جودة الأشعة — ${esc(monthLabel)}</span>
      </div>
    </div>
    <button class="btn" onclick="window.print()">طباعة / PDF</button>
  </div>
${slides}
</div>
<script>${DECK_NAV_SCRIPT}</script>
</body>
</html>`;
}

export function buildExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): string {
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = buildDeckV2Slides(model);
  return buildDeckV2Html(slides, formatMonthLabel(input.monthFolderName));
}

export function openExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  openOrDownload(
    buildExecutiveDeckV2(input, employeeDisplayNames),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}
```

After:
```typescript
/**
 * Style-variant arrow-cycling + persistence, dev-preview only (only appended
 * to the document when `variantPreview` is true — see buildDeckV2Html below).
 * Cycles `.v2-variant-panel.active` within each `.v2-variant-stack` and POSTs
 * the choice to the Vite dev middleware at /__deck-style-choices
 * (deckStyleChoicesPlugin.ts), which persists it to
 * dev-workspace/6-templates/deck-style-choices.json. On load, fetches the
 * saved choices and applies them before the user interacts with anything.
 */
const DECK_VARIANT_SCRIPT = `(function(){
  var stacks = Array.prototype.slice.call(document.querySelectorAll('.v2-variant-stack'));
  if (!stacks.length) return;
  function apply(stack, index){
    var panels = Array.prototype.slice.call(stack.querySelectorAll('.v2-variant-panel'));
    panels.forEach(function(p, i){ p.classList.toggle('active', i === index); });
    stack.setAttribute('data-active-index', String(index));
    var label = stack.querySelector('.v2-variant-label');
    if (label) label.textContent = (index + 1) + ' / ' + panels.length;
  }
  function persist(slideId, index){
    fetch('/__deck-style-choices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId: slideId, variantIndex: index })
    }).catch(function(){});
  }
  stacks.forEach(function(stack){
    var slideId = stack.getAttribute('data-slide-id');
    var panelCount = stack.querySelectorAll('.v2-variant-panel').length;
    function step(delta){
      var cur = Number(stack.getAttribute('data-active-index') || '0');
      var next = (cur + delta + panelCount) % panelCount;
      apply(stack, next);
      persist(slideId, next);
    }
    stack.querySelector('.v2-variant-prev').addEventListener('click', function(){ step(-1); });
    stack.querySelector('.v2-variant-next').addEventListener('click', function(){ step(1); });
  });
  fetch('/__deck-style-choices').then(function(r){ return r.json(); }).then(function(saved){
    stacks.forEach(function(stack){
      var slideId = stack.getAttribute('data-slide-id');
      if (Object.prototype.hasOwnProperty.call(saved, slideId)) {
        apply(stack, saved[slideId]);
      }
    });
  }).catch(function(){});
})();`;

export function buildDeckV2Html(slides: string, monthLabel: string, variantPreview = false): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>العرض التنفيذي — ${esc(monthLabel)}</title>
<style>${DECK_CSS}${DECK_V2_CSS}</style>
</head>
<body>
<nav class="deck-nav" id="deck-nav" aria-label="التنقّل بين أقسام العرض">
  <div class="deck-nav-brand">
    <span class="deck-nav-brand-icon">${icon("shield", 20)}</span>
    <span>العرض التنفيذي</span>
  </div>
  <div class="deck-nav-progress">
    <div class="deck-nav-progress-bar"><div class="deck-nav-progress-fill" id="deck-nav-fill"></div></div>
    <div class="deck-nav-progress-text" id="deck-nav-progress-text">الصفحة 1</div>
  </div>
  <ol class="deck-nav-sections" id="deck-nav-sections"></ol>
</nav>
<div class="deck-viewer deck-viewer-v2">
  <div class="deck-toolbar">
    <div class="deck-brand">
      <div class="brand-mark">${icon("shield", 22)}</div>
      <div>
        <strong>العرض التنفيذي</strong>
        <span>ضمان جودة الأشعة — ${esc(monthLabel)}</span>
      </div>
    </div>
    <button class="btn" onclick="window.print()">طباعة / PDF</button>
  </div>
${slides}
</div>
<script>${DECK_NAV_SCRIPT}${variantPreview ? DECK_VARIANT_SCRIPT : ""}</script>
</body>
</html>`;
}

export function buildExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
  opts?: { variantPreview?: boolean },
): string {
  const variantPreview = opts?.variantPreview ?? false;
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = buildDeckV2Slides(model, new Date(), variantPreview);
  return buildDeckV2Html(slides, formatMonthLabel(input.monthFolderName), variantPreview);
}

export function openExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
): void {
  openOrDownload(
    buildExecutiveDeckV2(input, employeeDisplayNames),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 3: Log the edit and commit**

Add a `docs/EDIT_LOG.md` entry (decimal bump) with the before/after above.

```bash
git add src/data/reporting/executive/deck2/index.ts docs/EDIT_LOG.md
git commit -m "feat(deck2): thread variantPreview through buildExecutiveDeckV2"
```

---

## Task 8: Preview harness — always request preview mode + light/dark toggle

**Files:**
- Modify: `src/dev/deckPreview.ts`
- Modify: `deck-preview.html`

**Interfaces:**
- Consumes: `buildExecutiveDeckV2(input, employeeDisplayNames, opts)` from Task 7.

- [ ] **Step 1: Add the theme-toggle button to the toolbar**

Modify `deck-preview.html`.

Before:
```html
    <div id="bar">
      <strong>معاينة العرض التنفيذي</strong>
      <button id="btn-v2" class="active">النسخة الجديدة (v2)</button>
      <button id="btn-v1">النسخة القديمة (مرجع)</button>
      <span class="hint">بيانات تجريبية — مايو 2026 · يُعاد التحميل تلقائيًا مع كل تعديل</span>
    </div>
```

After:
```html
    <div id="bar">
      <strong>معاينة العرض التنفيذي</strong>
      <button id="btn-v2" class="active">النسخة الجديدة (v2)</button>
      <button id="btn-v1">النسخة القديمة (مرجع)</button>
      <button id="btn-theme">فاتح / داكن</button>
      <span class="hint">بيانات تجريبية — مايو 2026 · يُعاد التحميل تلقائيًا مع كل تعديل</span>
    </div>
```

- [ ] **Step 2: Wire preview mode and the theme toggle**

Modify `src/dev/deckPreview.ts`.

Before:
```typescript
const frame = document.getElementById("frame") as HTMLIFrameElement;
const btnV2 = document.getElementById("btn-v2") as HTMLButtonElement;
const btnV1 = document.getElementById("btn-v1") as HTMLButtonElement;

const LOADING_HTML = `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#04182c;color:#cfe0f0;font-family:system-ui,sans-serif;font-size:0.95rem">جارٍ بناء العرض…</body></html>`;

let input: ExecutiveReportInput | null = null;
const cache: { v1?: string; v2?: string } = {};

function deckHtml(which: "v2" | "v1"): string {
  input ??= buildPreviewInput();
  if (which === "v2") {
    cache.v2 ??= buildExecutiveDeckV2(input);
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

btnV2.addEventListener("click", () => show("v2"));
btnV1.addEventListener("click", () => show("v1"));
show("v2");
```

After:
```typescript
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
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`, open `http://localhost:5173/deck-preview.html`.

Expected:
- Every slide shows a small `‹ 1 / 4 ›` control in its top-left corner.
- Clicking `›` on any slide advances to `2 / 4`, `3 / 4`, `4 / 4`, then wraps to `1 / 4` — content is visually identical across all 4 (Plan A duplicates variant 0), confirming the mechanism works without yet having new designs.
- Reloading the page keeps whatever variant index was last clicked per slide (check `dev-workspace/6-templates/deck-style-choices.json` on disk — it should list every slide id you clicked).
- Clicking "فاتح / داكن" switches the deck to a light paper background; clicking again returns to dark.
- Switching to "النسخة القديمة (مرجع)" (v1) and back to v2 does not error.

- [ ] **Step 4: Log the edit and commit**

Add a `docs/EDIT_LOG.md` entry (decimal bump) with both files' before/after.

```bash
git add deck-preview.html src/dev/deckPreview.ts docs/EDIT_LOG.md
git commit -m "feat(dev): enable variant-preview mode and light/dark toggle in deck-preview"
```

---

## Task 9: Production-path regression test

**Files:**
- Create: `src/data/reporting/executive/deck2/deck2.test.ts`

**Interfaces:**
- Consumes: `buildExecutiveDeckV2` from `./index` (Task 7).

- [ ] **Step 1: Write the regression test**

```typescript
// src/data/reporting/executive/deck2/deck2.test.ts
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG } from "../../executiveReportTypes";
import type { ExecutiveReportInput } from "../../executiveReportTypes";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { buildExecutiveDeckV2 } from "./index";

function popRow(overrides: Partial<PreparedPopulationRow> = {}): PreparedPopulationRow {
  return {
    stage: "المستوى الثاني",
    xrayImageId: "XR-1",
    xrayEntryDate: null,
    portCode: "P1",
    portType: "منفذ بري",
    portName: "منفذ الاختبار",
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "بري",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanStatus: "NonCertscan",
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "Sheet1",
    sourceRowNumber: 1,
    ...overrides,
  };
}

function input(populationRows: PreparedPopulationRow[]): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
  };
}

describe("buildExecutiveDeckV2 — production path (no opts)", () => {
  it("never emits variant-switcher chrome when opts is omitted", () => {
    const html = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    expect(html).not.toContain("v2-variant-stack");
    expect(html).not.toContain("v2-variant-switcher");
  });

  it("never emits variant-switcher chrome when variantPreview is explicitly false", () => {
    const html = buildExecutiveDeckV2(
      input([popRow(), popRow({ xrayImageId: "XR-2" })]),
      {},
      { variantPreview: false },
    );
    expect(html).not.toContain("v2-variant-stack");
  });

  it("produces byte-identical output for the same input regardless of the opts param shape", () => {
    const fixture = input([popRow(), popRow({ xrayImageId: "XR-2" })]);
    const a = buildExecutiveDeckV2(fixture);
    const b = buildExecutiveDeckV2(fixture, {}, { variantPreview: false });
    expect(a).toBe(b);
  });
});

describe("buildExecutiveDeckV2 — preview mode", () => {
  it("emits exactly one variant-stack per slide with 4 panels each, and DECK_VARIANT_SCRIPT", () => {
    const html = buildExecutiveDeckV2(
      input([popRow(), popRow({ xrayImageId: "XR-2" })]),
      {},
      { variantPreview: true },
    );
    // Match the opening tag, not the bare class name — the CSS block (added in
    // Task 3) also contains the literal substring "v2-variant-stack" as a
    // selector, which would otherwise throw off a plain substring count.
    const stackOpens = [...html.matchAll(/<div class="v2-variant-stack"/g)];
    const panelOpens = [...html.matchAll(/<div class="v2-variant-panel(?: active)?" data-variant-index="\d"/g)];
    const slideSections = [...html.matchAll(/<section class="slide v2/g)];
    expect(stackOpens.length).toBeGreaterThan(0);
    expect(stackOpens.length).toBe(slideSections.length);
    expect(panelOpens.length).toBe(stackOpens.length * 4);
    expect(html).toContain("__deck-style-choices");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts`
Expected: PASS (4 tests). If the byte-identity test fails, it means some code path changed production output — re-check every `v2Slide`/`renderVariants` call site from Tasks 4-7 for a stray `variantPreview: true` default or a body/variant mismatch.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test:run`
Expected: all existing tests still pass (no regressions in `deck.test.ts`, `model.test.ts`, etc. — this change never touches the v1 deck or the report model).

- [ ] **Step 4: Log the edit and commit**

Add a `docs/EDIT_LOG.md` entry (decimal bump) noting the new test file (before = did not exist).

```bash
git add src/data/reporting/executive/deck2/deck2.test.ts docs/EDIT_LOG.md
git commit -m "test(deck2): lock production-path output and verify variant-preview markup"
```

---

## Self-review notes (already applied above)

- **Spec coverage:** preview-mode flag (Task 7), 4-variant plumbing (Tasks 4-6), JSON persistence (Tasks 1-2), light/dark toggle (Tasks 3, 8), no role gating (confirmed — no auth code touched), no format/budget change (confirmed — `TABLE_BUDGET_PX`/`BASE_ROWS_PER_PAGE`/`COMPRESS_OVERFLOW_MAX` untouched), byte-identical production path (Task 9). Variant *content* catalog (§3 of the design spec) is explicitly out of scope for this plan — flagged as follow-up work below.
- **Type consistency:** `SlideBuilder` type (`(num, total) => string`) is unchanged throughout; every builder factory (`glossarySlideBuilders`, `portPopulationSlideBuilders`, etc.) takes `variantPreview: boolean` as its own parameter, not part of `SlideBuilder`'s signature — verified consistent across Tasks 5-6.
- **Placeholder scan:** none found — every step contains complete, real code; variants 1-3 are real (if intentionally duplicate) markup, not TBD stubs.

## Follow-up (separate plan, not part of this one)

Once this plan is merged and manually verified, a second plan should implement the design spec's §3 variant catalog: 3 real alternate designs per slide type (KPI cards, mini bar/line/donut charts, risk heatmap, compare-bars), built on the `renderVariants()`/`.v2-variant-panel` mechanism this plan lands. That plan should also extract the shared visual components (KPI card, mini chart, heatmap, compare-bars) into a new `deck2/ui/variantComponents.ts` so they're written once and reused across slides, per the design spec's §2.2.
