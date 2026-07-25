# Admin Report Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin open an in-app preview of the current month's real executive report, cycle each page through its design variants, save the combination, and have every subsequent real export use it.

**Architecture:** A new workspace-persisted `deck2.style-choices.json` (global, CAS-protected, modeled on `templateSelectionStorage.ts`) holds `{ slideId: variantIndex }`. `buildExecutiveDeckV2` threads these choices through a module-level getter/setter in `slideKit.ts` so `renderVariants` — the single choke point every slide already funnels through — picks the saved variant in production and pre-selects it in preview mode, with zero signature changes to any of the ~18 individual slide-builder functions. A new admin-only React component renders the real report in an iframe (`variantPreview: true`), listens for variant choices via `postMessage` (one new line added to the existing switcher script), and saves on an explicit button click.

**Tech Stack:** TypeScript, React 19, Vitest, `createMemoryDirectory()` for storage tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-admin-report-customization-design.md`.
- Choices are **global** (one file, not per-month).
- Persistence file: `6-templates/deck2.style-choices.json`, via `getTemplatesRoot`, same CAS pattern (`withResourceLock` + `casLoop`, revision + `_writeToken`) as `templateSelectionStorage.ts`.
- **Zero changes** to any slide-builder function signature in `deck2/slides.ts` or `deck2/section3/*.ts`. All plumbing is confined to `slideKit.ts` and `deck2/index.ts`.
- **Zero changes** to `src/dev/deckPreview.ts`, `deckPreviewFixture.ts`, `deckStyleChoicesPlugin.ts` (the existing dev-only tool stays untouched).
- Backward compatible: `buildExecutiveDeckV2` called with no `styleChoices` opt (or an empty object) must produce byte-identical output to today.
- New button/component is admin-only, gated via `readSession()?.role === "admin"` (from `src/auth/authSession.ts`), independent of the existing `canMutate("export-reports")` gate (which is broader — supervisor/manager can export, but only admin can customize).
- Per `CLAUDE.md`: every code edit needs an entry in `docs/edit logs/2026-07-25.md` (append as the new first/most-recent entry; today's file already exists) plus a version bump. Check the current `package.json` version at the start of each task and bump the decimal.

---

### Task 1: Style-choices persistence module

**Files:**
- Create: `src/data/reporting/executive/deck2/styleChoices.ts`
- Create: `src/data/reporting/executive/deck2/styleChoices.test.ts`

**Interfaces:**
- Consumes: `DirectoryHandleLike` (`../../../storage/fileSystemAccess`), `safeReadJson`/`safeWriteJson` (`../../../storage/safeWrite`), `casLoop` (`../../../storage/casLoop`), `withResourceLock` (`../../../storage/webLocks`), `getTemplatesRoot` (`../../../workspace/workspacePaths`), `createMemoryDirectory` (`../../../storage/memoryDirectory`, test-only).
- Produces: `type DeckStyleChoices = { choices: Record<string, number>; updatedAt: string; updatedBy: string; revision?: number; _writeToken?: string }`, `loadDeckStyleChoices(directoryHandle: DirectoryHandleLike): Promise<DeckStyleChoices | null>`, `saveDeckStyleChoices(directoryHandle: DirectoryHandleLike, choices: Record<string, number>, updatedBy: string): Promise<{ ok: true } | { ok: false; error: string }>` — both used by Task 3's React component.

- [ ] **Step 1: Write the failing tests**

Create `src/data/reporting/executive/deck2/styleChoices.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../../storage/memoryDirectory";
import { loadDeckStyleChoices, saveDeckStyleChoices } from "./styleChoices";

describe("styleChoices", () => {
  it("returns null when no choices have been saved yet", async () => {
    const root = createMemoryDirectory();
    const loaded = await loadDeckStyleChoices(root);
    expect(loaded).toBeNull();
  });

  it("round-trips saved choices", async () => {
    const root = createMemoryDirectory();
    const result = await saveDeckStyleChoices(root, { "slide-risk-stages": 1 }, "admin");
    expect(result.ok).toBe(true);

    const loaded = await loadDeckStyleChoices(root);
    expect(loaded?.choices).toEqual({ "slide-risk-stages": 1 });
    expect(loaded?.updatedBy).toBe("admin");
    expect(loaded?.revision).toBe(1);
  });

  it("re-saving replaces the choices (last-writer-wins is the intended contract)", async () => {
    const root = createMemoryDirectory();
    await saveDeckStyleChoices(root, { "slide-risk-stages": 1 }, "admin");
    await saveDeckStyleChoices(root, { "slide-risk-stages": 2, "slide-cover": 1 }, "admin2");

    const loaded = await loadDeckStyleChoices(root);
    expect(loaded?.choices).toEqual({ "slide-risk-stages": 2, "slide-cover": 1 });
    expect(loaded?.updatedBy).toBe("admin2");
    expect(loaded?.revision).toBe(2);
  });

  it("serializes concurrent saves via CAS (revision advances past both attempts)", async () => {
    const root = createMemoryDirectory();
    await Promise.all([
      saveDeckStyleChoices(root, { "slide-cover": 1 }, "admin"),
      saveDeckStyleChoices(root, { "slide-cover": 2 }, "admin"),
    ]);
    const loaded = await loadDeckStyleChoices(root);
    expect(loaded?.revision).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/styleChoices.test.ts`
Expected: FAIL — `Cannot find module './styleChoices'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/data/reporting/executive/deck2/styleChoices.ts`:

```ts
import type { DirectoryHandleLike } from "../../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../../storage/safeWrite";
import { casLoop } from "../../../storage/casLoop";
import { withResourceLock } from "../../../storage/webLocks";
import { getTemplatesRoot } from "../../../workspace/workspacePaths";

const CHOICES_FILE = "deck2.style-choices.json";

/** Global (not per-month) admin-chosen variant index (0-3) per deck2 slide
 *  id, persisted to the workspace's templates root — same shape and CAS
 *  contract as `templateSelectionStorage.ts`'s selection file. */
export type DeckStyleChoices = {
  choices: Record<string, number>;
  updatedAt: string;
  updatedBy: string;
  /** Monotonic CAS revision for this shared, multi-admin choices file. */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
};

async function getStyleChoicesDir(
  directoryHandle: DirectoryHandleLike,
): Promise<DirectoryHandleLike> {
  return getTemplatesRoot(directoryHandle, true);
}

export async function loadDeckStyleChoices(
  directoryHandle: DirectoryHandleLike,
): Promise<DeckStyleChoices | null> {
  try {
    const dir = await getStyleChoicesDir(directoryHandle);
    const result = await safeReadJson<DeckStyleChoices>(dir, CHOICES_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

export async function saveDeckStyleChoices(
  directoryHandle: DirectoryHandleLike,
  choices: Record<string, number>,
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getStyleChoicesDir(directoryHandle);
    // Shared, multi-admin choices file: CAS (revision + _writeToken, verified
    // on read-back) so a concurrent save on another machine is not silently
    // clobbered. The `:rmw` outer lock serializes same-tab writers.
    const outcome = await withResourceLock(`${dir.name}/deck2-style-choices:rmw`, () =>
      casLoop<{ ok: true }>(
        async (writeToken) => {
          const existing = await safeReadJson<DeckStyleChoices>(dir, CHOICES_FILE);
          const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
          const updated: DeckStyleChoices = {
            choices,
            updatedAt: new Date().toISOString(),
            updatedBy,
            revision: nextRevision,
            _writeToken: writeToken,
          };
          await safeWriteJson(dir, CHOICES_FILE, updated);
          const verify = await safeReadJson<DeckStyleChoices>(dir, CHOICES_FILE);
          if (
            verify.ok &&
            verify.value.revision === nextRevision &&
            verify.value._writeToken === writeToken
          ) {
            return {
              done: true,
              result: { ok: true as const },
              verify: async () => {
                const recheck = await safeReadJson<DeckStyleChoices>(dir, CHOICES_FILE);
                return (
                  recheck.ok &&
                  recheck.value.revision === nextRevision &&
                  recheck.value._writeToken === writeToken
                );
              },
            };
          }
          return { done: false };
        },
        { conflictError: "تعذّر حفظ تخصيص التصميم: تعارض في الكتابة بعد عدة محاولات." },
      ),
    );
    if (!outcome.ok) {
      return { ok: false, error: outcome.error };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/reporting/executive/deck2/styleChoices.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck` and `npm run lint` — expect clean.

- [ ] **Step 6: Edit log + version bump + commit**

Check current `package.json` version, bump the decimal by 1 (e.g. `X.Y.0` → `X.Y+1.0`, same in `package-lock.json`'s two occurrences). Add a new entry at the top of `docs/edit logs/2026-07-25.md` (category `Add (executive-deck/deck2):`, describing the new persistence module, with real before/after `npm run count-lines -- --quiet` totals and `git diff --stat`).

```bash
git add src/data/reporting/executive/deck2/styleChoices.ts src/data/reporting/executive/deck2/styleChoices.test.ts package.json package-lock.json "docs/edit logs/2026-07-25.md"
git commit -m "Add (executive-deck/deck2): style-choices persistence module (deck2.style-choices.json)"
```

---

### Task 2: Thread style choices through rendering + postMessage bridge

**Files:**
- Modify: `src/data/reporting/executive/deck2/slideKit.ts` (add module-level getter/setter, change `renderVariants`)
- Modify: `src/data/reporting/executive/deck2/index.ts` (`buildExecutiveDeckV2`'s opts, `openExecutiveDeckV2`'s param, `DECK_VARIANT_SCRIPT`'s `persist()`)
- Modify: `src/data/reporting/executive/deck2/deck2.test.ts` (new assertions)

**Interfaces:**
- Consumes: Task 1's `DeckStyleChoices` type is NOT used here — this task only deals with the plain `Record<string, number>` shape (`.choices`), decoupled from persistence.
- Produces: `setActiveStyleChoices(choices: Record<string, number> | null): void` and `getActiveStyleChoices(): Record<string, number> | null` (both exported from `slideKit.ts`, used internally by `renderVariants` and by `buildExecutiveDeckV2`); `buildExecutiveDeckV2`'s `opts` gains `styleChoices?: Record<string, number>`; `openExecutiveDeckV2` gains a third param `styleChoices?: Record<string, number>`.

- [ ] **Step 1: Write the failing tests**

Open `src/data/reporting/executive/deck2/deck2.test.ts`. Append this new `describe` block at the end of the file:

```ts
describe("style choices — production selection + backward compatibility (2026-07-25)", () => {
  it("with no styleChoices opt, output is byte-identical to today (regression guard)", () => {
    const a = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]));
    const b = buildExecutiveDeckV2(input([popRow(), popRow({ xrayImageId: "XR-2" })]), {}, {});
    expect(a).toBe(b);
  });

  it("with styleChoices selecting slot 1 for slide-risk-stages, production output renders variant 1's markup instead of variant 0's", () => {
    const fixture = input([
      popRow({ stage: "المستوى الأول" }),
      popRow({ xrayImageId: "XR-2", stage: "المستوى الثالث" }),
    ]);
    const defaultHtml = buildExecutiveDeckV2(fixture);
    const customHtml = buildExecutiveDeckV2(fixture, {}, { styleChoices: { "slide-risk-stages": 1 } });

    // Variant 0 (today's tiles + proportion bar) markers are present by default...
    expect(defaultHtml).toContain("v2-risk-tile-grid");
    expect(defaultHtml).not.toContain("v2-cbar");
    expect(defaultHtml).not.toContain("v2-level-table-card");

    // ...but with the style choice applied, the SAME slide now renders variant 1's markup instead.
    expect(customHtml).not.toContain("v2-risk-tile-grid");
    expect(customHtml).toContain("v2-cbar");
    expect(customHtml).toContain("v2-level-table-card");

    // Every other slide is unaffected by a choice scoped to slide-risk-stages only.
    expect(customHtml).toContain("v2-toc-card");
  });

  it("an out-of-range or unknown slide id in styleChoices is ignored (falls back to variant 0), never throws", () => {
    const fixture = input([popRow()]);
    expect(() =>
      buildExecutiveDeckV2(fixture, {}, { styleChoices: { "slide-risk-stages": 99, "no-such-slide": 2 } }),
    ).not.toThrow();
    const html = buildExecutiveDeckV2(fixture, {}, { styleChoices: { "slide-risk-stages": 99 } });
    expect(html).toContain("v2-risk-tile-grid"); // fell back to variant 0, not a crash or an out-of-bounds undefined render
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "style choices"`
Expected: FAIL — `buildExecutiveDeckV2`'s third argument doesn't accept `styleChoices` yet (TypeScript error) and/or the assertions about variant-1 markup fail since nothing reads the opt yet.

- [ ] **Step 3: Add the getter/setter and change `renderVariants` in slideKit.ts**

Find this exact block in `src/data/reporting/executive/deck2/slideKit.ts`:

```ts
/**
 * Wraps a slide's varying content into 1-of-4 selectable style variants.
 * Production (`variantPreview=false`) renders ONLY `bodies[0]` — byte-identical
 * to the single-variant output that existed before the switcher (a dev-preview
 * feature; see docs/superpowers/specs/2026-07-05-deck2-style-switcher-design.md).
 * Preview mode renders all 4, one visible via CSS (`.v2-variant-panel.active`).
 * The arrow-cycle control that drives this lives separately in
 * `slideControls()`/`variantSwitcher()`; the inline script in deck2/index.ts
 * (DECK_VARIANT_SCRIPT) wires the two together by matching `data-for` to
 * `data-slide-id` and persists the choice.
 */
export function renderVariants(
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
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="0">${panels}</div>`;
}
```

Replace it with:

```ts
/**
 * Module-level "active style choices" for the duration of one
 * `buildExecutiveDeckV2` call — set once at the top of that function, read by
 * `renderVariants` below. Deliberately NOT a parameter threaded through every
 * one of the ~18 slide-builder functions: `renderVariants` is already the
 * single choke point every slide (via `v2Slide`, plus the two direct callers
 * `coverSlide`/`sectionSeparatorSlide`) funnels through, so scoping the state
 * here confines this whole feature to this file + deck2/index.ts. Reports are
 * always built synchronously within one JS turn (no concurrent
 * `buildExecutiveDeckV2` calls can interleave), so there's no cross-call
 * interference risk. See
 * docs/superpowers/specs/2026-07-25-admin-report-customization-design.md.
 */
let activeStyleChoices: Record<string, number> | null = null;

export function setActiveStyleChoices(choices: Record<string, number> | null): void {
  activeStyleChoices = choices;
}

export function getActiveStyleChoices(): Record<string, number> | null {
  return activeStyleChoices;
}

/** Clamps a saved/requested variant index to a valid 0-3 slot, defaulting to
 *  0 for anything missing, non-numeric, or out of range — an admin choice
 *  saved against a slide id that no longer exists, or a stale/corrupt file,
 *  must never throw or render `undefined`. */
function resolveVariantIndex(slideId: string): number {
  const choice = activeStyleChoices?.[slideId];
  return typeof choice === "number" && Number.isInteger(choice) && choice >= 0 && choice <= 3 ? choice : 0;
}

/**
 * Wraps a slide's varying content into 1-of-4 selectable style variants.
 * Production (`variantPreview=false`) renders `bodies[resolveVariantIndex(slideId)]`
 * — `bodies[0]` when no admin choice is saved for this slide, byte-identical
 * to the single-variant output that existed before the switcher (a
 * dev-preview feature; see
 * docs/superpowers/specs/2026-07-05-deck2-style-switcher-design.md — and now
 * also the production selection mechanism for the in-app admin customizer,
 * docs/superpowers/specs/2026-07-25-admin-report-customization-design.md).
 * Preview mode renders all 4, one visible via CSS (`.v2-variant-panel.active`),
 * initially the saved choice (or panel 0) instead of always panel 0, so
 * re-opening the customizer shows what's currently saved.
 * The arrow-cycle control that drives interactive switching lives separately
 * in `slideControls()`/`variantSwitcher()`; the inline script in
 * deck2/index.ts (DECK_VARIANT_SCRIPT) wires the two together by matching
 * `data-for` to `data-slide-id` and persists the choice.
 */
export function renderVariants(
  slideId: string,
  bodies: readonly [string, string, string, string],
  variantPreview: boolean,
): string {
  const initialIndex = resolveVariantIndex(slideId);
  if (!variantPreview) return bodies[initialIndex];
  const panels = bodies
    .map(
      (html, i) =>
        `<div class="v2-variant-panel${i === initialIndex ? " active" : ""}" data-variant-index="${i}">${html}</div>`,
    )
    .join("");
  return `<div class="v2-variant-stack" data-slide-id="${esc(slideId)}" data-active-index="${initialIndex}">${panels}</div>`;
}
```

- [ ] **Step 4: Wire `buildExecutiveDeckV2`/`openExecutiveDeckV2` and the `persist()` postMessage bridge in deck2/index.ts**

First, add the import. Find:

```ts
import { DECK_CSS } from "../deck/deckTheme";
import { DECK_V2_CSS } from "./theme";
```

Replace with:

```ts
import { DECK_CSS } from "../deck/deckTheme";
import { DECK_V2_CSS } from "./theme";
import { setActiveStyleChoices } from "./slideKit";
```

Next, find this exact block (the `persist` function inside `DECK_VARIANT_SCRIPT`):

```ts
  function persist(slideId, index){
    fetch('/__deck-style-choices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId: slideId, variantIndex: index })
    }).catch(function(){});
  }
```

Replace it with (adds one unconditional `postMessage` call, alongside the existing dev-tool `fetch`):

```ts
  function persist(slideId, index){
    // Dev-tool persistence (Vite middleware, harmless 404 in the real app).
    fetch('/__deck-style-choices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slideId: slideId, variantIndex: index })
    }).catch(function(){});
    // In-app admin customizer bridge: this script only ever runs inside a
    // variantPreview=true document, which is always embedded (the dev tool's
    // own iframe, or the in-app customizer's iframe) — never the standalone
    // opened/downloaded report, which is never in variantPreview mode. A
    // parentless top-level window would just message itself here, which is
    // harmless (nothing listens).
    window.parent.postMessage({ type: 'deck2-style-choice', slideId: slideId, variantIndex: index }, '*');
  }
```

Next, find:

```ts
export function buildExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
  opts?: { variantPreview?: boolean },
): string {
  const variantPreview = opts?.variantPreview ?? false;
  const model = buildReportModel(input, employeeDisplayNames);
  const slides = buildDeckV2Slides(
    model,
    new Date(),
    variantPreview,
    input.sourceRevisions,
    input.monthFolderName,
  );
  return buildDeckV2Html(
    slides,
    formatMonthFolderShortLabel(input.monthFolderName),
    variantPreview,
    sourceRevisionsFooterHtml(input.sourceRevisions, esc),
  );
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

Replace it with:

```ts
export function buildExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
  opts?: { variantPreview?: boolean; styleChoices?: Record<string, number> },
): string {
  const variantPreview = opts?.variantPreview ?? false;
  setActiveStyleChoices(opts?.styleChoices ?? null);
  try {
    const model = buildReportModel(input, employeeDisplayNames);
    const slides = buildDeckV2Slides(
      model,
      new Date(),
      variantPreview,
      input.sourceRevisions,
      input.monthFolderName,
    );
    return buildDeckV2Html(
      slides,
      formatMonthFolderShortLabel(input.monthFolderName),
      variantPreview,
      sourceRevisionsFooterHtml(input.sourceRevisions, esc),
    );
  } finally {
    setActiveStyleChoices(null);
  }
}

export function openExecutiveDeckV2(
  input: ExecutiveReportInput,
  employeeDisplayNames: Record<string, string> = {},
  styleChoices?: Record<string, number>,
): void {
  openOrDownload(
    buildExecutiveDeckV2(input, employeeDisplayNames, { styleChoices }),
    `العرض_التنفيذي_${input.monthFolderName}.html`,
  );
}
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `npx vitest run src/data/reporting/executive/deck2/deck2.test.ts -t "style choices"`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite, typecheck, lint**

Run: `npm run test:run` — expect all tests passing (baseline + 3 new = same file count, +3 tests).
Run: `npm run typecheck` and `npm run lint` — expect clean.

- [ ] **Step 7: Edit log + version bump + commit**

Same procedure as Task 1 Step 6 (new entry, bump the decimal again from Task 1's new version, real `count-lines`/`git diff --stat` numbers).

```bash
git add src/data/reporting/executive/deck2/slideKit.ts src/data/reporting/executive/deck2/index.ts src/data/reporting/executive/deck2/deck2.test.ts package.json package-lock.json "docs/edit logs/2026-07-25.md"
git commit -m "Add (executive-deck/deck2): thread style choices through production rendering + postMessage bridge"
```

---

### Task 3: Admin-only in-app customizer component + button wiring

**Files:**
- Create: `src/components/Sidebar/Tabs/Reports/DeckDesignCustomizer.tsx`
- Modify: `src/components/Sidebar/Tabs/Reports/index.tsx` (new state, new button, both `openExecutiveDeckV2` call sites pass loaded choices)

**Interfaces:**
- Consumes: Task 1's `loadDeckStyleChoices`/`saveDeckStyleChoices` (`../../../../data/reporting/executive/deck2/styleChoices`), Task 2's `buildExecutiveDeckV2` (now accepting `styleChoices` in its opts) and `openExecutiveDeckV2` (now accepting a third `styleChoices` param), `readSession` (`../../../../auth/authSession`), `ExecutiveReportInput` (already imported in `Reports/index.tsx`).
- Produces: default export `DeckDesignCustomizer` component, props `{ execInput: ExecutiveReportInput; employeeDisplayNames: Record<string, string>; directoryHandle: DirectoryHandleLike; onClose: () => void }`.

- [ ] **Step 1: Write the component**

Create `src/components/Sidebar/Tabs/Reports/DeckDesignCustomizer.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { X, Save } from "lucide-react";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import type { ExecutiveReportInput } from "../../../../data/reporting/executiveReportTypes";
import { buildExecutiveDeckV2 } from "../../../../data/reporting/executive/deck2";
import { loadDeckStyleChoices, saveDeckStyleChoices } from "../../../../data/reporting/executive/deck2/styleChoices";
import { readSession } from "../../../../auth/authSession";

type Props = {
  execInput: ExecutiveReportInput;
  employeeDisplayNames: Record<string, string>;
  directoryHandle: DirectoryHandleLike;
  onClose: () => void;
};

type MessageEventLike = { data?: { type?: string; slideId?: string; variantIndex?: number } };

/**
 * Admin-only in-app design customizer: renders the CURRENT REAL month's
 * report (variantPreview=true, so every slide's arrow-cycle switcher is
 * live) into an iframe, listens for choices via postMessage (the bridge
 * DECK_VARIANT_SCRIPT's persist() now emits unconditionally), and saves the
 * accumulated combination on an explicit Save click — never auto-saves per
 * click, matching "customize... and save it" as one deliberate action.
 * See docs/superpowers/specs/2026-07-25-admin-report-customization-design.md.
 */
export default function DeckDesignCustomizer({ execInput, employeeDisplayNames, directoryHandle, onClose }: Props) {
  const [loadedChoices, setLoadedChoices] = useState<Record<string, number> | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const pendingChoices = useRef<Record<string, number>>({});

  useEffect(() => {
    let cancelled = false;
    void loadDeckStyleChoices(directoryHandle).then((saved) => {
      if (cancelled) return;
      const choices = saved?.choices ?? {};
      pendingChoices.current = { ...choices };
      setLoadedChoices(choices);
      setReady(true);
    });
    return () => { cancelled = true; };
  }, [directoryHandle]);

  useEffect(() => {
    function onMessage(event: MessageEventLike) {
      if (event.data?.type !== "deck2-style-choice") return;
      const { slideId, variantIndex } = event.data;
      if (typeof slideId !== "string" || typeof variantIndex !== "number") return;
      pendingChoices.current = { ...pendingChoices.current, [slideId]: variantIndex };
    }
    window.addEventListener("message", onMessage as EventListener);
    return () => window.removeEventListener("message", onMessage as EventListener);
  }, []);

  const html = useMemo(() => {
    if (!ready) return null;
    return buildExecutiveDeckV2(execInput, employeeDisplayNames, {
      variantPreview: true,
      styleChoices: loadedChoices ?? {},
    });
  }, [ready, execInput, employeeDisplayNames, loadedChoices]);

  async function handleSave() {
    const session = readSession();
    setSaving(true);
    setStatus(null);
    const result = await saveDeckStyleChoices(directoryHandle, pendingChoices.current, session?.username ?? "admin");
    setSaving(false);
    setStatus(result.ok ? { kind: "ok", text: "تم حفظ تخصيص التصميم." } : { kind: "error", text: result.error });
  }

  return (
    <div className="rh-customizer-overlay" role="dialog" aria-modal="true" aria-label="تخصيص تصميم العرض التنفيذي">
      <div className="rh-customizer-panel">
        <div className="rh-customizer-toolbar">
          <span className="rh-customizer-title">تخصيص تصميم العرض التنفيذي</span>
          <div className="rh-customizer-actions">
            {status ? <span className={`rh-customizer-status rh-customizer-status-${status.kind}`}>{status.text}</span> : null}
            <button type="button" className="rh-btn rh-btn-teal" onClick={() => { void handleSave(); }} disabled={!ready || saving}>
              {saving ? <span className="rh-spinner" /> : <Save size={15} strokeWidth={2} />}
              حفظ
            </button>
            <button type="button" className="rh-btn" onClick={onClose} aria-label="إغلاق">
              <X size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
        <div className="rh-customizer-frame-wrap">
          {html ? <iframe title="معاينة تخصيص العرض التنفيذي" className="rh-customizer-frame" srcDoc={html} /> : <div className="rh-customizer-loading">جارٍ التحميل…</div>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the minimal overlay/panel/frame CSS**

Open `src/components/Sidebar/Tabs/Reports/Reports.css` and append:

```css
.rh-customizer-overlay{position:fixed;inset:0;z-index:1000;background:rgba(4,18,32,.72);display:flex;align-items:center;justify-content:center;padding:24px;}
.rh-customizer-panel{width:100%;height:100%;max-width:1400px;background:#fff;border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.35);}
.rh-customizer-toolbar{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid #e4e9ee;gap:12px;}
.rh-customizer-title{font-weight:800;font-size:1rem;color:#0a2d4a;}
.rh-customizer-actions{display:flex;align-items:center;gap:10px;}
.rh-customizer-status{font-size:.82rem;font-weight:700;}
.rh-customizer-status-ok{color:#2e7d32;}
.rh-customizer-status-error{color:#c62828;}
.rh-customizer-frame-wrap{flex:1;min-height:0;}
.rh-customizer-frame{width:100%;height:100%;border:0;}
.rh-customizer-loading{display:flex;align-items:center;justify-content:center;height:100%;color:#607386;font-size:.9rem;}
```

- [ ] **Step 3: Wire the button and state into `Reports/index.tsx`**

Add the `readSession` import and a `DeckDesignCustomizer` import. Find:

```ts
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
```

Replace with:

```ts
import { useWorkspace } from "../../../../data/workspace/useWorkspace";
import { readSession } from "../../../../auth/authSession";
import { loadDeckStyleChoices } from "../../../../data/reporting/executive/deck2/styleChoices";
import DeckDesignCustomizer from "./DeckDesignCustomizer";
```

Add one more icon to the existing lucide-react import line. Find:

```ts
import { AlertTriangle, BarChart2, BarChart3, Building2, Check, ClipboardList, Database, Download, FileStack, FileText, Filter, FolderOpen, Globe, History, Presentation, User, Users, X } from "lucide-react";
```

Replace with:

```ts
import { AlertTriangle, BarChart2, BarChart3, Building2, Check, ClipboardList, Database, Download, FileStack, FileText, Filter, FolderOpen, Globe, History, Presentation, Settings2, User, Users, X } from "lucide-react";
```

Find the `canExportReports` line:

```ts
  const canExportReports = can("export-reports");
```

Replace with (adds the admin-only gate and the panel's open/data state, right after it):

```ts
  const canExportReports = can("export-reports");
  const isAdmin = readSession()?.role === "admin";
  const [customizerOpen, setCustomizerOpen] = useState(false);
  const [customizerInput, setCustomizerInput] = useState<{ execInput: ExecutiveReportInput; names: Record<string, string> } | null>(null);
```

Add a handler right after `handleExport` (find the closing `}` of `handleExport` — the block ending with `setExporting(null); } }` before `async function handlePbiExport()`):

```ts
  async function handleOpenCustomizer(): Promise<void> {
    if (!directoryHandle || !selectedMonth) return;
    const execInput = await loadExecInput();
    if (!execInput) { showToast("error", "لم يتم العثور على بيانات المجتمع. يجب معالجة المجتمع أولاً."); return; }
    setCustomizerInput({ execInput, names: buildDisplayNameMap() });
    setCustomizerOpen(true);
  }
```

Add the button right after the existing deck export button. Find:

```tsx
          <button
            type="button"
            className="rh-btn rh-btn-navy"
            disabled={exporting !== null || !selectedMonth || !canExportReports}
            title={exportDisabledTitle()}
            onClick={() => { void handleExport("deck"); }}
          >
            {exporting === "deck" ? <span className="rh-spinner" /> : <BarChart2 size={15} strokeWidth={2} />}
            فتح العرض التنفيذي (HTML)
          </button>
```

Replace with:

```tsx
          <button
            type="button"
            className="rh-btn rh-btn-navy"
            disabled={exporting !== null || !selectedMonth || !canExportReports}
            title={exportDisabledTitle()}
            onClick={() => { void handleExport("deck"); }}
          >
            {exporting === "deck" ? <span className="rh-spinner" /> : <BarChart2 size={15} strokeWidth={2} />}
            فتح العرض التنفيذي (HTML)
          </button>
          {isAdmin ? (
            <button
              type="button"
              className="rh-btn"
              disabled={exporting !== null || !selectedMonth || !canExportReports}
              title="تخصيص تصميم العرض التنفيذي (للمدير فقط)"
              onClick={() => { void handleOpenCustomizer(); }}
            >
              <Settings2 size={15} strokeWidth={2} />
              تخصيص تصميم العرض
            </button>
          ) : null}
```

`ReportsContent`'s root return is a single unwrapped `<section className="rh-page" dir="rtl">` (verified: opens at line 846, closes at line 1146-1147 with `</section>` then the function's closing `}` at 1148) — it needs a fragment wrapper so the new modal can render as a sibling. Find:

```tsx
  return (
    <section className="rh-page" dir="rtl">
```

Replace with:

```tsx
  return (
    <>
    <section className="rh-page" dir="rtl">
```

Find the matching close (this exact sequence — the section's own close, immediately followed by the component's closing brace and the module comment before `ReportsTab`):

```tsx
    </section>
  );
}

// Wrapper that handles sub-tab routing for "مصمم التقارير" sub-tab.
```

Replace with:

```tsx
    </section>
    {customizerOpen && customizerInput && directoryHandle ? (
      <DeckDesignCustomizer
        execInput={customizerInput.execInput}
        employeeDisplayNames={customizerInput.names}
        directoryHandle={directoryHandle}
        onClose={() => setCustomizerOpen(false)}
      />
    ) : null}
    </>
  );
}

// Wrapper that handles sub-tab routing for "مصمم التقارير" sub-tab.
```

Update both `openExecutiveDeckV2` call sites to pass saved choices. Find:

```ts
      } else if (kind === "deck") {
        openExecutiveDeckV2(execInput, names);
        showToast("ok", "تم فتح العرض التنفيذي.");
```

Replace with:

```ts
      } else if (kind === "deck") {
        const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
        openExecutiveDeckV2(execInput, names, saved?.choices);
        showToast("ok", "تم فتح العرض التنفيذي.");
```

Find:

```ts
        } else if (type === "executive-deck") {
          openExecutiveDeckV2(execInput, names);
          showToast("ok", "تم فتح العرض التنفيذي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
```

Replace with:

```ts
        } else if (type === "executive-deck") {
          const saved = directoryHandle ? await loadDeckStyleChoices(directoryHandle) : null;
          openExecutiveDeckV2(execInput, names, saved?.choices);
          showToast("ok", "تم فتح العرض التنفيذي. استخدم أمر الطباعة للحفظ بصيغة PDF.");
```

- [ ] **Step 4: Typecheck and lint**

Run: `npm run typecheck` — fix any JSX-structure mismatch from Step 3's root-return note above if the file's actual structure differs from the plan's assumption.
Run: `npm run lint` — expect clean.

- [ ] **Step 5: Run the full suite**

Run: `npm run test:run` — expect all tests still passing (this task adds no new automated tests — there is no existing test file for `Reports/index.tsx` to extend, and the component's real value is only verifiable by driving the browser; see Step 6).

- [ ] **Step 6: Manual verification**

If you have a way to drive a browser in this environment: start the dev server, open the app, mount a workspace with a processed month, log in (or switch preview role to) admin, go to the Reports tab, confirm the new "تخصيص تصميم العرض" button appears (and does NOT appear for a non-admin role), click it, confirm the real month's report renders in the panel with working arrow switchers, cycle a slide, click "حفظ", confirm a success toast/status, close and reopen the customizer and confirm it reopens showing the saved choice (not reset to variant 0), then click "فتح العرض التنفيذي (HTML)" and confirm the exported report reflects the saved choice. If you have no way to drive a browser in this environment, say so explicitly instead of claiming this was verified.

- [ ] **Step 7: Edit log + version bump + commit**

Same procedure as prior tasks.

```bash
git add src/components/Sidebar/Tabs/Reports/DeckDesignCustomizer.tsx src/components/Sidebar/Tabs/Reports/Reports.css src/components/Sidebar/Tabs/Reports/index.tsx package.json package-lock.json "docs/edit logs/2026-07-25.md"
git commit -m "Add (reports): admin-only in-app report design customizer (button + panel + save)"
```
