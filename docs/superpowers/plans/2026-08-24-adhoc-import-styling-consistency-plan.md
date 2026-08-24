# «ارفاق حالات استثنائية» (Ad-hoc Import) — visual-design consistency fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Ad-hoc Import page (`population` → `adhoc-import`, Arabic title «ارفاق حالات استثنائية») look like the rest of the product. Three defects, all presentation-only: (1) nine `<button>`s render with raw browser chrome because they carry no `className` at all; (2) the assignment/historical submit button carries a class that declares nothing but `align-self`, so it renders with the same raw chrome; (3) `AdhocImport.css` spells 75 spacing/radius values as ad-hoc `rem`/`px` literals instead of the repo's `--sp-*` / `--r-*` token scale.

**Architecture:** No logic changes, no new files, no new CSS rules. Buttons adopt the already-shipped-but-unused `.ui-btn` family from `src/styles/primitives.css` (globally imported at `src/main.tsx:14`, so nothing new to import). The CSS work is a mechanical literal → token substitution against the scales in `src/index.css:120-123` (radius) and `src/index.css:128-130` (spacing). Every touched value is either an exact token match or documented below with its rounding delta.

**Tech Stack:** Plain co-located CSS + React 19/TSX `className` strings. No test framework work — see *Why no TDD* below.

**Tier: 2.** CLAUDE.md's tier 1 row covers "Comments, docs, typos, test-only, formatting". This is none of those: it changes what the user sees on a shipped admin screen — buttons currently render as grey OS chrome. It is a real user-facing fix, which is exactly the tier-2 row ("Most fixes and features — the default"). So: `Why:` + `What changed:` prose, Before/After snippets, and gates `lint` + `typecheck` + `test:run`, plus the mandatory `build` before pushing.

---

## Grounding — what was verified in the current tree (2026-08-24, `v115.2.0`)

Re-verified by reading the files, not from memory. Line numbers below are current.

| Claim | Verified? | Evidence |
|---|---|---|
| `PageHeader` usage is correct — leave alone | ✅ | `src/components/Sidebar/Tabs/AdhocImport/index.tsx:1417-1421` and `:1437-1441`, both `<PageHeader eyebrow title subtitle />`. Not touched by this plan. |
| Bare `<button>`s with no `className` | ✅ **9 of them**, not 7 | `index.tsx:1465, 1477, 1489, 1587, 1595, 1598, 1636, 1639, 1655`. `grep -n "<button" index.tsx` returns exactly these nine and none of them declares a class. |
| `.adhoc-assign-submit` is a stub | ✅ | `AdhocImport.css:377-379` is `{ align-self: flex-start; }` and nothing else. |
| It is used in **two** files, not one | ✅ | `AssignmentPanel.tsx:305-312` **and** `HistoricalPanel.tsx:141-148`. |
| Hardcoded spacing/radius throughout the CSS | ✅ **75 declarations** | Full table in Task 3. |
| Bare `<button>` really is unstyled | ✅ | `src/index.css:282-318` gives every `button` only `font: inherit`, `touch-action`, `:active` transform, `:disabled { opacity: .62 }`, a transition list and a `:focus-visible` outline. There is **no** element-level padding/border/background/radius rule anywhere. A class-less button therefore paints the UA's default `ButtonFace` box. |

### Two findings that change the shape of the fix

**F1 — `.ui-btn` has zero adopters.** `grep -rn "ui-btn" src/` returns 16 hits and **all 16 are inside `src/styles/primitives.css` itself**. The same is true of the older `.ui-button-primary` / `.ui-button-secondary` / `.ui-button-danger` trio defined at `src/index.css:362-400` — **0** uses in any `.tsx`. Both shared button vocabularies are currently dead code. What actually ships is one bespoke pair per tab: `.ew-btn-primary`/`.ew-btn-secondary` (EmployeeWorkspace), `.arc-btn-primary`/`.arc-btn-secondary` (Archive), `.proc-run-btn`/`.phase2-save-btn` (Population), `.tb-btn-primary`/`.tb-btn-secondary` (TemplateBuilder), and so on — roughly nine dialects. So there is no "established `.ui-btn` usage pattern" to copy; see Decision D1 for what to do instead.

**F2 — the wizard's own sibling components are already fine.** `MappingWorkbench.tsx` (`.amw-field-arm`, `.amw-ghost-btn`, `.amw-header-btn`) and `PasteSourceInput.tsx` (`.amw-ghost-btn`) are fully styled from `MappingWorkbench.css`. They are **out of scope** — do not touch them. The inconsistency is confined to `index.tsx`, `AssignmentPanel.tsx`, `HistoricalPanel.tsx`, and `AdhocImport.css`.

---

## Decision D1 — which button vocabulary to adopt

**Chosen: `.ui-btn` + `.ui-btn--primary` / `.ui-btn--secondary` from `src/styles/primitives.css:78-169`.**

Rationale:

1. **Zero new CSS.** A local `.adhoc-btn-primary`/`.adhoc-btn-secondary` pair would add ~45 lines duplicating a primitive that already exists, making this the tenth button dialect in a codebase that is already fragmented — the opposite of a consistency fix.
2. **No import needed.** `src/main.tsx:14` imports `primitives.css` globally, so the classes are live on every screen today.
3. **It is the documented intent.** `primitives.css:1-5` states: *"Tabs should consume these instead of re-rolling local button/card CSS."* Adopting it here makes AdhocImport the first adopter rather than inventing an eleventh alternative.
4. **It is built from the same tokens Task 3 is migrating to** (`--sp-2`, `--r-sm`, `--fs-sm`, `--fw-bold`, `--focus-ring`), so Tasks 1 and 3 pull in the same direction.
5. **It supplies states the bare buttons have no answer for.** Six of the nine bare buttons are `disabled`-capable (`disabled={!canIngest}`, `disabled={saving}`, `disabled={editor.step === 1}`, `disabled={!canIngest || !canAdvance}`, and the two submit buttons). Today a disabled one only dims via the global `opacity: .62`. `.ui-btn:disabled` adds `cursor: not-allowed`, and `.ui-btn:focus-visible` gives the shared `--focus-ring` instead of the generic 3px outline.

**Accepted trade-off, state it in the edit log:** `.ui-btn--primary` paints `var(--sky-gradient)` (sky blue), while the sibling Population sub-tabs paint their primaries navy (`--p-primary` → `--c-navy`, `Population.css:30`) and EmployeeWorkspace does too (`--c-navy`). So this fix makes the page *internally* consistent and token-correct, but its primary buttons will read sky-blue next to navy siblings. **Do not "fix" that by retinting `.ui-btn--primary` inside primitives.css** — that restyles a shared primitive from inside a single-page change. Record it as a follow-up (migrate the app onto `.ui-btn`, or retint the primitive, as a separate owner-approved decision).

**If the reviewer prefers navy-matching-Population instead:** the flip is cheap and local — replace `ui-btn--primary` with `ui-btn--secondary` nowhere, and instead add to `AdhocImport.css` a single override `.adhoc-import-tab .ui-btn--primary { background: var(--c-navy); border-color: var(--c-navy); box-shadow: none; }`. That is a 3-line addition scoped to this page and reverses nothing else. Do this **only** on explicit instruction; the plan as written does not include it.

**Size modifiers: none.** Every button on this page uses the default 38px `.ui-btn`. `--sm` was considered for the two selection-helper buttons and the close/reopen toggle and rejected: "Save", "Select All" and "Clear Selection" share one flex row (`.adhoc-import-assign-bar`), and mixing heights inside that row would reintroduce the visual inconsistency this plan exists to remove.

### Variant assignment (primary vs secondary)

One primary per decision point; everything navigational, auxiliary, or reversible is secondary.

| # | File:line | Label key | Role | Variant |
|---|---|---|---|---|
| 1 | `index.tsx:1465` | `adhoc_wizard_new_import` | The only action in the empty state | **primary** |
| 2 | `index.tsx:1477` | `adhoc_import_back_to_list` | Navigation | secondary |
| 3 | `index.tsx:1489` | `adhoc_import_close_button` / `adhoc_import_reopen_button` | Toggles import status both ways | secondary |
| 4 | `index.tsx:1587` | `adhoc_review_save_button` | Commits the import to disk | **primary** |
| 5 | `index.tsx:1595` | `adhoc_import_select_all` | Selection helper | secondary |
| 6 | `index.tsx:1598` | `adhoc_import_clear_selection` | Selection helper | secondary |
| 7 | `index.tsx:1636` | `adhoc_wizard_back` | Wizard back | secondary |
| 8 | `index.tsx:1639` | `adhoc_wizard_next` | Wizard forward — the step's CTA | **primary** |
| 9 | `index.tsx:1655` | `adhoc_wizard_back` | Wizard back (step 3) | secondary |
| 10 | `AssignmentPanel.tsx:305` | `adhoc_assign_submit` | Commits the distribution | **primary** |
| 11 | `HistoricalPanel.tsx:141` | `adhoc_hist_import_button` | Commits the historical import | **primary** |

Note on #3: `ui-btn--danger` was considered and rejected. The same element renders "إغلاق" and "إعادة فتح" depending on `editor.record.status`, so a danger tint would be wrong half the time. The destructive confirmation already lives on the `ConfirmDialog danger` at `index.tsx:1520-1526`.

---

## Global Constraints

- **One edit-log entry, not four.** All four files are one user-facing change to one page. CLAUDE.md: *"one `**File:**` block per touched file, all under the same version entry."* Generate it with `npm run editlog -- --tier=2 --append --sync-package "Fix (adhoc-import): …"`. `docs/edit logs/2026-08-24.md` does not exist yet (latest is `2026-08-23.md`), so `--append` creates it. Version: `package.json` is `115.2.0`, this is a fix → **v115.3**.
- **One commit** at the end (Task 6), never a bare `git commit` — always `git add <specific files>` then `git commit -m "…" -- <same files>`.
- **Never touch `PageHeader`** usage at `index.tsx:1417-1421` / `:1437-1441`. It is correct.
- **Never touch** `MappingWorkbench.tsx`, `MappingWorkbench.css`, `PasteSourceInput.tsx`, `TemplateMappingPanel.tsx`, `ValueMappingPanel.tsx` — already styled (F2).
- **Never edit `src/styles/primitives.css` or `src/index.css`.** This plan consumes them; it does not modify shared primitives or tokens.
- **No Arabic string is added, removed or altered.** Every button's text keeps coming from `L.*` / `labels.*` label keys. This plan adds nothing to `labelsStore.ts`.
- **No hex literals are introduced** — every value added is `var(--token)` (the two `2px` values in Task 3 are noted inline). `npm run check:hex-literals` is cheap and should be run anyway since this is a CSS change, even though tier 2 does not require it.

---

### Task 1: Give the nine bare buttons in `index.tsx` the shared button treatment

**Files:**
- Modify: `src/components/Sidebar/Tabs/AdhocImport/index.tsx` (9 sites)

**Interfaces:**
- Consumes: `.ui-btn`, `.ui-btn--primary`, `.ui-btn--secondary` from `src/styles/primitives.css:78-148`, already global via `src/main.tsx:14`.
- Produces: nothing. No props, no exports, no behavior change — `type`, `onClick`, `disabled` and children are byte-identical at every site.

- [ ] **Step 1: Confirm the nine sites are still where this plan says**

Run: `grep -n "<button" src/components/Sidebar/Tabs/AdhocImport/index.tsx`
Expected exactly: `1465, 1477, 1489, 1587, 1595, 1598, 1636, 1639, 1655`. If the numbers have drifted, match on the surrounding JSX below rather than on the line number.

- [ ] **Step 2: Site 1 — "استيراد جديد" (`index.tsx:1465`), primary**

```tsx
          <section className="adhoc-import-upload-card">
            <button type="button" onClick={startNewImport} disabled={!canIngest}>
              {L.adhoc_wizard_new_import}
            </button>
          </section>
```

becomes:

```tsx
          <section className="adhoc-import-upload-card">
            <button
              type="button"
              className="ui-btn ui-btn--primary"
              onClick={startNewImport}
              disabled={!canIngest}
            >
              {L.adhoc_wizard_new_import}
            </button>
          </section>
```

- [ ] **Step 3: Site 2 — "العودة للقائمة" (`index.tsx:1477`), secondary**

```tsx
            <button type="button" onClick={backToList}>
              {L.adhoc_import_back_to_list}
            </button>
```

becomes:

```tsx
            <button type="button" className="ui-btn ui-btn--secondary" onClick={backToList}>
              {L.adhoc_import_back_to_list}
            </button>
```

- [ ] **Step 4: Site 3 — close/reopen toggle (`index.tsx:1489-1499`), secondary**

```tsx
              <button
                type="button"
                onClick={() => {
                  if (editor.record.status === "open") setShowCloseConfirm(true);
                  else void applyImportStatusToggle();
                }}
              >
```

becomes:

```tsx
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={() => {
                  if (editor.record.status === "open") setShowCloseConfirm(true);
                  else void applyImportStatusToggle();
                }}
              >
```

- [ ] **Step 5: Site 4 — save (`index.tsx:1587`), primary**

```tsx
                  <button type="button" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? L.adhoc_review_saving : L.adhoc_review_save_button}
                  </button>
```

becomes:

```tsx
                  <button
                    type="button"
                    className="ui-btn ui-btn--primary"
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    {saving ? L.adhoc_review_saving : L.adhoc_review_save_button}
                  </button>
```

- [ ] **Step 6: Sites 5-6 — selection helpers (`index.tsx:1595`, `:1598`), secondary**

```tsx
                    <button type="button" onClick={selectAllAssignable}>
                      {L.adhoc_import_select_all}
                    </button>
                    <button type="button" onClick={clearSelection}>
                      {L.adhoc_import_clear_selection}
                    </button>
```

becomes:

```tsx
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary"
                      onClick={selectAllAssignable}
                    >
                      {L.adhoc_import_select_all}
                    </button>
                    <button
                      type="button"
                      className="ui-btn ui-btn--secondary"
                      onClick={clearSelection}
                    >
                      {L.adhoc_import_clear_selection}
                    </button>
```

- [ ] **Step 7: Sites 7-8 — wizard nav (`index.tsx:1636`, `:1639`), secondary + primary**

```tsx
              <button type="button" onClick={goBack} disabled={editor.step === 1}>
                {L.adhoc_wizard_back}
              </button>
              <button type="button" onClick={goNext} disabled={!canIngest || !canAdvance}>
                {L.adhoc_wizard_next}
              </button>
```

becomes:

```tsx
              <button
                type="button"
                className="ui-btn ui-btn--secondary"
                onClick={goBack}
                disabled={editor.step === 1}
              >
                {L.adhoc_wizard_back}
              </button>
              <button
                type="button"
                className="ui-btn ui-btn--primary"
                onClick={goNext}
                disabled={!canIngest || !canAdvance}
              >
                {L.adhoc_wizard_next}
              </button>
```

- [ ] **Step 8: Site 9 — step-3 back (`index.tsx:1655`), secondary**

```tsx
              <button type="button" onClick={goBack}>
                {L.adhoc_wizard_back}
              </button>
```

becomes:

```tsx
              <button type="button" className="ui-btn ui-btn--secondary" onClick={goBack}>
                {L.adhoc_wizard_back}
              </button>
```

- [ ] **Step 9: Prove no bare button survives**

Run: `grep -n -A4 "<button" src/components/Sidebar/Tabs/AdhocImport/index.tsx | grep -c "className=\"ui-btn"`
Expected: `9`.

Then run the file's own tests, which render every one of these branches:
`npx vitest run src/components/Sidebar/Tabs/AdhocImport/index.test.tsx src/components/Sidebar/Tabs/AdhocImport/historicalImport.test.tsx`
Expected: PASS unchanged. These suites query by `getByRole("button", { name })` and `findByText(...).closest("tr")` — verified: **no** test in `src/components/Sidebar/Tabs/AdhocImport/*.test.tsx` and **no** locator in `e2e/adhoc-import.spec.ts` selects on a button class, so adding one cannot break them. (`e2e/adhoc-import.spec.ts` uses exactly one CSS selector, `.amw-paste-zone`, which this plan never touches.)

---

### Task 2: Make `.adhoc-assign-submit` an actual button

**Files:**
- Modify: `src/components/Sidebar/Tabs/AdhocImport/AssignmentPanel.tsx:305-312`
- Modify: `src/components/Sidebar/Tabs/AdhocImport/HistoricalPanel.tsx:141-148`
- Modify: `src/components/Sidebar/Tabs/AdhocImport/AdhocImport.css:377-379`

**Interfaces:**
- Consumes: `.ui-btn`, `.ui-btn--primary`.
- Produces: `.adhoc-assign-submit` narrows to a pure **layout** class (`align-self: flex-start` only, so the button does not stretch to the flex-column's full width). The button chrome comes from the primitive. The class name is deliberately kept, not deleted — it is the only thing preventing full-width stretch inside `.adhoc-assign-panel` / `.adhoc-hist-panel`.

**Approach note (the plan's call between the two options in the brief):** compose — `className="ui-btn ui-btn--primary adhoc-assign-submit"` — rather than copying `.ui-btn`'s declarations into `.adhoc-assign-submit`. Copying would duplicate 20 declarations in two places that must then be kept in sync by hand, which is the failure mode this whole plan is undoing. There is no cascade conflict: `.ui-btn` (specificity 0,1,0) and `.adhoc-assign-submit` (0,1,0) declare **disjoint** property sets — `align-self` appears in neither `.ui-btn` nor any `--primary` variant — so source order is irrelevant here.

- [ ] **Step 1: `AssignmentPanel.tsx:304-313`**

```tsx
      {canAssign && (
        <button
          type="button"
          className="adhoc-assign-submit"
          disabled={locked || preview.plan.length === 0}
          onClick={handleSubmit}
        >
          {busy === true ? labels.adhoc_import_assigning : labels.adhoc_assign_submit}
        </button>
      )}
```

becomes:

```tsx
      {canAssign && (
        <button
          type="button"
          className="ui-btn ui-btn--primary adhoc-assign-submit"
          disabled={locked || preview.plan.length === 0}
          onClick={handleSubmit}
        >
          {busy === true ? labels.adhoc_import_assigning : labels.adhoc_assign_submit}
        </button>
      )}
```

- [ ] **Step 2: `HistoricalPanel.tsx:140-149`**

```tsx
      {canImport && (
        <button
          type="button"
          className="adhoc-assign-submit"
          disabled={blocked || busy || disabled}
          onClick={onImport}
        >
          {busy ? L.adhoc_hist_importing : L.adhoc_hist_import_button}
        </button>
      )}
```

becomes:

```tsx
      {canImport && (
        <button
          type="button"
          className="ui-btn ui-btn--primary adhoc-assign-submit"
          disabled={blocked || busy || disabled}
          onClick={onImport}
        >
          {busy ? L.adhoc_hist_importing : L.adhoc_hist_import_button}
        </button>
      )}
```

- [ ] **Step 3: Document the class's narrowed job in the CSS (`AdhocImport.css:377-379`)**

```css
.adhoc-assign-submit {
  align-self: flex-start;
}
```

becomes:

```css
/* Layout only. The button chrome comes from `.ui-btn .ui-btn--primary` in
   primitives.css — this class exists solely to stop the submit button
   stretching to the full width of its flex-column parent. Do not re-add
   padding/border/background here; that is what left it looking inert. */
.adhoc-assign-submit {
  align-self: flex-start;
}
```

- [ ] **Step 4: Run the two panels' tests**

Run: `npx vitest run src/components/Sidebar/Tabs/AdhocImport/AssignmentPanel.test.tsx src/components/Sidebar/Tabs/AdhocImport/historicalImport.test.tsx`
Expected: PASS unchanged — `AssignmentPanel.test.tsx` drives the submit button through `getByRole("button", { name })`, never through its class.

---

### Task 3: Replace the 75 hardcoded spacing/radius literals with tokens

**Files:**
- Modify: `src/components/Sidebar/Tabs/AdhocImport/AdhocImport.css`

**Interfaces:**
- Consumes: `--sp-1 … --sp-14` (`src/index.css:128-130`) and `--r-sm/--r-md/--r-lg/--r-xl` (`src/index.css:120-123`) + `--r-pill` (`src/styles/primitives.css:54`).
- Produces: nothing. Same selectors, same property names, same rule order; only literal values change.

**Scale reference (verified, do not guess):**

```
--r-sm: 6px   --r-md: 8px   --r-lg: 10px   --r-xl: 12px   --r-pill: 999px
--sp-1: 4px   --sp-2: 8px   --sp-3: 12px   --sp-4: 16px   --sp-5: 20px
--sp-6: 24px  --sp-8: 32px  --sp-10: 40px  --sp-12: 48px  --sp-14: 56px
```

**`rem` → `px` is safe here.** The app's UI-scale feature applies `zoom: var(--ui-scale)` on the **root element** (`src/index.css:239-251`), not a root `font-size` override, and nothing else in the app sets `html { font-size }`. So `1rem` is a plain `16px` and stays proportional under zoom exactly as a `px` token does. Converting does not change scaling behavior.

- [ ] **Step 1: Apply the replacement table**

Every entry is a whole-declaration, context-free substitution — apply to **all** occurrences of the exact string. Line numbers are the current ones and are informational; match on the string.

| # | Current declaration (exact) | Replacement | Occurrences | Lines | Δ |
|---|---|---|---|---|---|
| 1 | `border-radius: 8px;` | `border-radius: var(--r-md);` | 5 | 18, 27, 325, 419, 441 | exact |
| 2 | `border-radius: 10px;` | `border-radius: var(--r-lg);` | 7 | 129, 167, 207, 274, 297, 345, 470 | exact |
| 3 | `border-radius: 12px;` | `border-radius: var(--r-xl);` | 5 | 42, 156, 253, 387, 461 | exact |
| 4 | `border-radius: 999px;` | `border-radius: var(--r-pill);` | 1 | 226 | exact |
| 5 | `padding: 1.25rem;` | `padding: var(--sp-5);` | 1 | 5 | exact (20px) |
| 6 | `padding: 1rem;` | `padding: var(--sp-4);` | 5 | 43, 157, 254, 388, 462 | exact (16px) |
| 7 | `padding: 0.6rem 0.9rem;` | `padding: var(--sp-2) var(--sp-4);` | 6 | 19, 28, 168, 208, 275, 346 | 9.6→8, 14.4→16 |
| 8 | `padding: 0.5rem 0.75rem;` | `padding: var(--sp-2) var(--sp-3);` | 1 | 72 | exact (8/12) |
| 9 | `padding: 0.45rem 0.8rem;` | `padding: var(--sp-2) var(--sp-3);` | 1 | 130 | 7.2→8, 12.8→12 |
| 10 | `padding: 0.5rem 0.8rem;` | `padding: var(--sp-2) var(--sp-3);` | 2 | 298, 471 | 8 exact, 12.8→12 |
| 11 | `padding: 0.4rem 0.7rem;` | `padding: var(--sp-2) var(--sp-3);` | 1 | 442 | 6.4→8, 11.2→12 |
| 12 | `padding: 0.35rem 0.6rem;` | `padding: var(--sp-1) var(--sp-2);` | 2 | 326, 420 | 5.6→4, 9.6→8 |
| 13 | `padding: 0.15rem 0.6rem;` | `padding: 2px var(--sp-2);` | 1 | 227 | matches `.ui-badge`'s `2px 9px` |
| 14 | `padding: 0 0.35rem;` | `padding: 0 var(--sp-1);` | 2 | 176, 283 | 5.6→4 |
| 15 | `padding-top: 0.5rem;` | `padding-top: var(--sp-2);` | 2 | 109, 235 | exact |
| 16 | `padding-inline-start: 1.2rem;` | `padding-inline-start: var(--sp-5);` | 4 | 241, 358, 373, 502 | 19.2→20 |
| 17 | `gap: 1rem;` | `gap: var(--sp-4);` | 3 | 4, 88, 271 | exact |
| 18 | `gap: 0.9rem;` | `gap: var(--sp-4);` | 2 | 154, 164 | 14.4→16 |
| 19 | `gap: 0.75rem;` | `gap: var(--sp-3);` | 6 | 46, 107, 233, 251, 385, 459 | exact (12px) |
| 20 | `gap: 0.6rem;` | `gap: var(--sp-2);` | 2 | 183, 305 | 9.6→8 |
| 21 | `gap: 0.5rem;` | `gap: var(--sp-2);` | 3 | 117, 322, 416 | exact |
| 22 | `gap: 0.4rem;` | `gap: var(--sp-2);` | 2 | 316, 410 | 6.4→8 |
| 23 | `gap: 0.35rem;` | `gap: var(--sp-1);` | 3 | 196, 289, 333 | 5.6→4 |
| 24 | `gap: 0.25rem;` | `gap: var(--sp-1);` | 1 | 203 | exact |
| 25 | `gap: 0.15rem;` | `gap: var(--sp-1);` | 1 | 127 | 2.4→4 |
| 26 | `gap: 0.5rem 1.25rem;` | `gap: var(--sp-2) var(--sp-5);` | 1 | 481 | exact |
| 27 | `margin-top: 1rem;` | `margin-top: var(--sp-4);` | 1 | 390 | exact |
| 28 | `margin-top: 0.5rem;` | `margin-top: var(--sp-2);` | 1 | 362 | exact |
| 29 | `margin: 0 0 0.35rem;` | `margin: 0 0 var(--sp-1);` | 1 | 352 | 5.6→4 |
| 30 | `margin: 0.2rem 0 0;` | `margin: var(--sp-1) 0 0;` | 2 | 372, 501 | 3.2→4 |

**Total: 75 declarations.** The largest single delta is 2.4px (#7's inline axis, 14.4→16) — nothing here reflows a layout; every container is `flex-wrap`ped or grid-`auto-fill`ed.

- [ ] **Step 2: Deliberately NOT converted — leave these alone**

These are *sizing*, not spacing, and have no token on the `--sp-*` scale:

| Line | Declaration | Why it stays |
|---|---|---|
| 339 | `width: 5rem;` (`.adhoc-assign-number`) | Input width sized to its content (a 2-3 digit count), not a spacing step. |
| 433 | `max-width: 12rem;` (`.adhoc-hist-select`) | Select truncation width. |
| 315 | `minmax(220px, 1fr)` | Grid track minimum. |
| 409 | `minmax(280px, 1fr)` | Grid track minimum. |
| — | every `max-width: 100%` / `min-width: 0` / `width: 100%` | Flex/overflow guards, including the documented overflow fix at lines 55-62. |
| — | every `1px` border width | Not on the spacing scale. |

**Do not touch the comment block at `AdhocImport.css:55-58`** — it documents a real, verified Chromium horizontal-overflow fix.

- [ ] **Step 3: Verify no spacing/radius literal survives**

Run:
```bash
grep -nE "(padding|margin|gap|border-radius)[^;]*: *[^;v]*[0-9](px|rem)" \
  src/components/Sidebar/Tabs/AdhocImport/AdhocImport.css
```
Expected: only the `2px` in `.adhoc-chip-warn` (table row #13) and `padding: 0 var(--sp-1)` style lines that mix a literal `0` with a token. Anything else is a missed substitution.

Then confirm the file still parses and nothing else moved:
```bash
git diff --stat src/components/Sidebar/Tabs/AdhocImport/AdhocImport.css
```
Expected: ~75 changed lines plus the 4 comment lines from Task 2 Step 3. If the line **count** changed by more than +4, a rule was accidentally restructured — revert and redo.

---

### Task 4 (OPTIONAL — defer unless the reviewer asks for it): font-size / font-weight tokens

**Not part of the tier-2 fix. Do not do this in the same commit.** It is listed so the next person does not have to re-derive it.

`AdhocImport.css` also spells ~30 font sizes as `rem` literals and 5 weights as `600`. Unlike spacing, converting these visibly changes glyph size on a dense Arabic screen (up to 1px per declaration), which needs its own visual review pass and its own before/after screenshots. Rounding table for whenever it happens:

| Literal | px | Nearest token | Token px | Δ |
|---|---|---|---|---|
| `0.7rem` | 11.2 | `--fs-2xs` | 11 | −0.2 |
| `0.75rem` | 12 | `--fs-xs` | 12 | exact |
| `0.8rem` | 12.8 | `--fs-sm` | 13 | +0.2 |
| `0.82rem` | 13.1 | `--fs-sm` | 13 | −0.1 |
| `0.85rem` | 13.6 | `--fs-base` | 14 | +0.4 |
| `0.9rem` | 14.4 | `--fs-base` | 14 | −0.4 |
| `0.95rem` | 15.2 | `--fs-md` | 16 | +0.8 |
| `1rem` | 16 | `--fs-md` | 16 | exact |
| `font-weight: 600` (×5, lines 148, 174, 213, 281, 368) | — | `var(--fw-semibold)` | 600 | exact |

`.adhoc-chip-warn` (`AdhocImport.css:221-228`) is also a hand-rolled duplicate of `.ui-badge` + `.ui-badge--warning` (`primitives.css:266-282`) and could be deleted in favour of a className change at `index.tsx:1486`. Same reasoning: separate change, separate review.

---

### Task 5: Manual browser verification (there is no automated test for "does this look right")

**Why no TDD:** every change in Tasks 1-3 is a `className` string or a CSS literal. Vitest runs in jsdom, which does not compute layout, does not load `AdhocImport.css` or `primitives.css`, and reports no useful `getComputedStyle` for a stylesheet it never parsed. A test asserting `expect(button).toHaveClass("ui-btn")` would restate the diff, pass before anyone looked at the screen, and add a maintenance anchor on a class name — it would prove nothing about the defect, which is *visual*. The existing suites already guard the thing that could actually regress (that the buttons still exist, still carry their labels, and still fire their handlers), and they are run in Tasks 1, 2 and 6. So: no new tests; a real browser is the gate.

- [ ] **Step 1: Capture the BEFORE state — do this before applying any edit, or from a stash**

If Tasks 1-3 are already applied, use `git stash` to get back to the pre-change tree, capture, then `git stash pop`.

```bash
npm run dev
```
Open **Chrome or Edge** (File System Access API — Firefox/Safari land on `unsupported_browser`) at:

```
http://localhost:5173/?sim=1&role=admin
```

The `?sim=1` query mounts a **simulated workspace** (banner: «بيانات محاكاة للتطوير فقط — SIMULATED DATA, NOT REAL»), so no folder picker, no login, and no real data is touched. This is the same entry point `e2e/helpers/app.ts:14-28` (`gotoSim`) uses.

Then, in the sidebar: **«إدارة بيانات الأشعة»** → sub-tab **«ارفاق حالات استثنائية»**. The page is ready when the `<h1>` «ارفاق حالات استثنائية» is on screen.

Screenshot these four states (the union covers all 11 buttons):

| Screenshot | How to reach it | Buttons visible |
|---|---|---|
| `before-1-empty.png` | The landing state | #1 «استيراد جديد» |
| `before-2-wizard.png` | Click «استيراد جديد» | #2 «العودة للقائمة», #7 «السابق» (disabled at step 1), #8 «التالي» |
| `before-3-review.png` | Choose «لصق من إكسل», paste any 2-column TSV, «التالي», bind the two mandatory result fields, «التالي» | #3 close/reopen (after a save), #4 «حفظ», #5 «تحديد الكل», #6 «مسح التحديد», #9 «السابق», #10 assignment submit |
| `before-4-historical.png` | Same, but pick the historical import kind at step 1 | #11 historical import submit |

- [ ] **Step 2: Apply Tasks 1-3, reload, capture the AFTER state**

Same four screenshots, named `after-1-empty.png` … `after-4-historical.png`. Vite HMR picks the CSS up without a restart; a hard reload (Ctrl+Shift+R) is safest for the class changes.

- [ ] **Step 3: Confirm each acceptance criterion explicitly — tick every box**

- [ ] Every one of the 11 buttons has **visible padding** — no button is a text label hugged by 1px of chrome.
- [ ] Every button has a **visible background** — none renders as the grey UA `ButtonFace` box with an outset bevel.
- [ ] Every button has a **rounded corner** (6px, `--r-sm`) — none is square-cornered.
- [ ] Every button is the **same height** (38px). Measure two in DevTools; they must match.
- [ ] **Primary vs secondary are visually distinct**: primary = filled sky gradient with white text; secondary = white surface, grey border, dark ink. Compare #8 «التالي» against #7 «السابق» side by side in `after-2-wizard.png` — this is the single clearest check.
- [ ] **Disabled reads as disabled**: at wizard step 1, #7 «السابق» is dimmed and shows `cursor: not-allowed` on hover. Same for #1 «استيراد جديد» under a role without `adhoc-import.ingest`.
- [ ] **Focus is visible**: Tab to any button — the shared `--focus-ring` box-shadow appears, not the generic 3px outline.
- [ ] **The assignment submit (#10) and historical submit (#11) look like real primary buttons** and are **still left-aligned**, not stretched to the panel's full width (that is what `.adhoc-assign-submit` still does).
- [ ] **RTL is intact**: the wizard nav still reads «السابق» then «التالي» in the same visual order as before; the assign bar's count `<span>` still sits after the buttons. `.ui-btn` uses no directional properties, so this should be unchanged — confirm, do not assume.
- [ ] **No horizontal page overflow at 320px width.** Set DevTools to a 320px viewport and confirm `document.documentElement.scrollWidth === document.documentElement.clientWidth`. `AdhocImport.css:55-62` documents a previously-fixed overflow at exactly this width; Task 3 changes padding on the containers around it.
- [ ] **Nothing else moved**: cards, the step rail, the mapping workbench and the paste zone look identical to `before-*`. Task 3's largest delta is 2.4px — a visible reflow means a substitution went into the wrong rule.

- [ ] **Step 4: Attach the before/after pair to the PR / hand them to the reviewer**

Screenshots are the deliverable here. Do **not** report this task complete on the strength of reading the diff — CLAUDE.md's standing note about self-review surviving real bugs applies with extra force to a change whose only symptom is visual.

---

### Task 6: Gates, edit log, commit

- [ ] **Step 1: Run the tier-2 gates**

```bash
npm run lint && npm run typecheck && npm run test:run
```

All three are required by the tier-2 row. `test:run` is **not** skipped despite this being CSS/className-only: the four AdhocImport suites render every branch touched here, `typecheck` alone would not catch a malformed JSX attribute that still parses, and CLAUDE.md is explicit that a green partial run is not evidence. Expected: unchanged pass counts against the `v115.2` baseline (396 files / 3750 tests as of the 2026-08-23 entry).

- [ ] **Step 2: Run the cheap CSS-specific extra**

```bash
npm run check:hex-literals
```
Not required at tier 2, but it is the repo's regression guard for exactly this file type and takes seconds. This plan adds no hex literal, so it must stay clean.

- [ ] **Step 3: Build — mandatory at every tier before pushing**

```bash
npm run build
```
Required by CLAUDE.md before pushing a branch or opening a PR, regardless of tier.

- [ ] **Step 4: Generate the edit-log entry**

```bash
npm run editlog -- --tier=2 --append --sync-package \
  "Fix (adhoc-import): give «ارفاق حالات استثنائية» real buttons and put its spacing on the token scale"
```

`docs/edit logs/2026-08-24.md` does not exist yet — `--append` creates it. `--sync-package` moves `package.json` from `115.2.0` to the new version so `check:release` passes. The entry heading must read **`v115.3`** (fix → decimal bump; `check:release` compares the first two segments).

Then write the prose the generator leaves for you. It must contain:

- **Why:** nine buttons on this page carried no `className`, so they inherited nothing but `font: inherit` from `src/index.css:282-318` and painted the browser's default grey `ButtonFace` chrome — visually alien next to every other tab. `.adhoc-assign-submit` looked class-ful but declared only `align-self`, so the two submit buttons had the same problem. Separately the stylesheet spelled 75 spacing/radius values as ad-hoc `rem`/`px` literals off the `--sp-*` / `--r-*` scale.
- **What changed:** the four files, the `.ui-btn` adoption, the primary/secondary assignment, and the literal→token substitution.
- **The D1 trade-off, stated plainly:** `.ui-btn` had zero adopters app-wide before this change (16 grep hits, all inside `primitives.css`); AdhocImport is the first, and its primary buttons therefore read sky-blue while sibling Population sub-tabs read navy. Shared primitives were deliberately not retinted from inside a single-page fix; unifying the app's ~9 button dialects is a separate, owner-approved change.
- **Before/After snippets** (tier 2 requires them) for at least: one bare button from `index.tsx`, the `AssignmentPanel.tsx` submit, and the `.adhoc-assign-submit` CSS rule.
- **One `**File:**` block per touched file:** `index.tsx`, `AssignmentPanel.tsx`, `HistoricalPanel.tsx`, `AdhocImport.css`, `package.json` (+ `dist/index.html` only if the build output is committed, matching whatever the previous entry did).
- **Verification:** the gate results from Steps 1-3 **and** the Task 5 browser confirmation, naming the browser and the four screenshots. Do not write "verified" without having looked at the screen.

- [ ] **Step 5: Commit**

```bash
git add \
  src/components/Sidebar/Tabs/AdhocImport/index.tsx \
  src/components/Sidebar/Tabs/AdhocImport/AssignmentPanel.tsx \
  src/components/Sidebar/Tabs/AdhocImport/HistoricalPanel.tsx \
  src/components/Sidebar/Tabs/AdhocImport/AdhocImport.css \
  "docs/edit logs/2026-08-24.md" \
  package.json

git commit -m "Fix (adhoc-import): give «ارفاق حالات استثنائية» real buttons and put its spacing on the token scale" -- \
  src/components/Sidebar/Tabs/AdhocImport/index.tsx \
  src/components/Sidebar/Tabs/AdhocImport/AssignmentPanel.tsx \
  src/components/Sidebar/Tabs/AdhocImport/HistoricalPanel.tsx \
  src/components/Sidebar/Tabs/AdhocImport/AdhocImport.css \
  "docs/edit logs/2026-08-24.md" \
  package.json
```

---

## Testing summary

| Gate | Required by | When |
|---|---|---|
| `npx vitest run …/AdhocImport/index.test.tsx …/historicalImport.test.tsx` | scoped fast loop | Task 1 Step 9 |
| `npx vitest run …/AdhocImport/AssignmentPanel.test.tsx …/historicalImport.test.tsx` | scoped fast loop | Task 2 Step 4 |
| `npm run lint` | tier 2 | Task 6 Step 1 |
| `npm run typecheck` | tier 2 | Task 6 Step 1 |
| `npm run test:run` | tier 2 | Task 6 Step 1 |
| `npm run check:hex-literals` | not required — cheap CSS-specific extra | Task 6 Step 2 |
| `npm run build` | every tier, before push | Task 6 Step 3 |
| **Real-browser before/after screenshots** | **the only gate that can see this defect** | Task 5 |

Not run: `check:complexity`, `check:vendor`, `check:bundle-size`, `check:release` — tier 3 / release gates. Nothing here changes function complexity, the vendored tarball, or bundle weight beyond a few dozen bytes of class strings. (`check:release` runs implicitly against the `--sync-package` version bump; if `npm run editlog --sync-package` is skipped for any reason, run it manually.)

## Key files touched

| Task | File | Nature |
|---|---|---|
| 1 | `src/components/Sidebar/Tabs/AdhocImport/index.tsx` | 9 `className` additions |
| 2 | `src/components/Sidebar/Tabs/AdhocImport/AssignmentPanel.tsx` | 1 `className` change |
| 2 | `src/components/Sidebar/Tabs/AdhocImport/HistoricalPanel.tsx` | 1 `className` change |
| 2, 3 | `src/components/Sidebar/Tabs/AdhocImport/AdhocImport.css` | 75 token substitutions + 1 explanatory comment |
| 6 | `docs/edit logs/2026-08-24.md`, `package.json` | new entry, version → v115.3 |

**Read-only, referenced, never modified:** `src/styles/primitives.css`, `src/index.css`, `src/main.tsx`, `src/components/PageHeader/PageHeader.tsx`, `MappingWorkbench.tsx/.css`, `PasteSourceInput.tsx`, `TemplateMappingPanel.tsx`, `ValueMappingPanel.tsx`, `e2e/adhoc-import.spec.ts`.

## Follow-ups this plan deliberately does not do

1. **Unify the app's ~9 button dialects.** `.ui-btn` (primitives.css) and `.ui-button-*` (index.css:362-400) are both shipped and both have zero adopters, while nine tabs each maintain their own pair. That is a tier-3 refactor needing owner sign-off on the target hue.
2. **Font-size / font-weight tokens on this page** — Task 4 above, with its rounding table.
3. **`.adhoc-chip-warn` → `.ui-badge ui-badge--warning`** — a hand-rolled duplicate of an existing primitive.
