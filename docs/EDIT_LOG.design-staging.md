# EDIT LOG — Design staging (Tier 4 design items, TEAM_REVIEW_2026-07-05)

Staging log for the approved design-system fixes. Versions use `vD.N` identifiers;
the orchestrator merges and renumbers into `docs/EDIT_LOG.md` afterwards.

Scope: CSS-only. Token de-hardcoding, fallback-drift correction, radius
normalization, RTL logical-property conversion, shared focus-visible rule,
type-scale token definitions. No TSX/logic changes. Visual appearance preserved
except for approved nearest-token color normalization (perceptually near-identical
deltas) and the 14px-to-12px radius normalization noted in vD.4.

---

## vD.1 — 2026-07-07 — Add radius/spacing/type-scale/line-height tokens

**File:** `src/index.css`

**Before:**
```css
  --r-xl:  12px;
  --r-2xl: 16px;

  /* ── Spacing scale (4px base) ──────────────────────────────── */
  --sp-1:  4px;   --sp-2:  8px;   --sp-3:  12px;  --sp-4:  16px;
  --sp-5:  20px;  --sp-6:  24px;  --sp-8:  32px;  --sp-10: 40px;  --sp-12: 48px;
```

**After:**
```css
  --r-xl:  12px;
  --r-2xl: 16px;
  --r-3xl: 18px;

  /* ── Spacing scale (4px base) ──────────────────────────────── */
  --sp-1:  4px;   --sp-2:  8px;   --sp-3:  12px;  --sp-4:  16px;
  --sp-5:  20px;  --sp-6:  24px;  --sp-8:  32px;  --sp-10: 40px;  --sp-12: 48px;
  --sp-14: 56px;
```

**Before:**
```css
  --fw-bold:     700;
  --fw-black:    800;
```

**After:**
```css
  --fw-bold:     700;
  --fw-black:    800;

  /* ── Type scale (role-named; adopt incrementally when touching rules) ── */
  --fs-2xs:  11px;  /* micro-labels, table meta */
  --fs-xs:   12px;  /* badges, captions, dense table cells */
  --fs-sm:   13px;  /* body-dense: default table/UI text */
  --fs-base: 14px;  /* body: forms, paragraph text */
  --fs-md:   16px;  /* card titles, sub-headers */
  --fs-lg:   18px;  /* section titles (small) */
  --fs-xl:   22px;  /* section titles (large) */
  --fs-2xl:  28px;  /* stat / KPI values */
  --fs-3xl:  34px;  /* page-level H1 */

  --lh-tight:  1.2;   /* headings, KPI numbers */
  --lh-normal: 1.5;   /* body text */
  --lh-loose:  1.7;   /* Arabic paragraph copy */
```

---

## vD.2 — 2026-07-07 — Shared focus-visible ring for custom interactive elements

**File:** `src/styles/primitives.css`

**Before:**
```css
.ui-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
```

**After:**
```css
.ui-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }

/* Shared focus ring for custom interactive elements (non-native buttons,
   focusable rows/cells). Matches the .ui-btn focus treatment so keyboard
   focus is visible on every interactive surface, not just native controls. */
[role="button"]:focus-visible,
[tabindex]:not([tabindex="-1"]):focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

---

## vD.3 — 2026-07-07 — Fallback-hex drift normalization + dangling token fixes

**Files:** `src/components/Sidebar/Tabs/UserManagement/UserManagement.css`,
`src/components/Sidebar/Tabs/Archive/Archive.css`,
`src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`,
`src/components/Sidebar/Tabs/Reports/Reports.css`, `src/auth/AuthGate.css`,
`src/components/Sidebar/Tabs/Population/Population.css`,
`src/components/DataTable/DataTable.css`,
`src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

Mechanical rule applied uniformly (300 occurrences): every
`var(--token, #fallback)` whose fallback hex does not equal the token's live
value in `src/index.css` had its fallback corrected to the live value. Example:

**Before:**
```css
  border: 1px solid var(--c-border, #d6e2ef);
  color: var(--c-ink-3, #5e7a96);
```

**After:**
```css
  border: 1px solid var(--c-border, #DDE6EF);
  color: var(--c-ink-3, #50536F);
```

Canonical values used: `--c-navy #0E2444`, `--c-navy-2 #102C57`, `--c-navy-3 #143A68`,
`--c-navy-soft #E8EEF6`, `--c-sky #009ADE`, `--c-sky-2 #007FBA`, `--c-sky-light #E5F5FB`,
`--c-ink #0B1F33`, `--c-ink-2 #263C58`, `--c-ink-3 #50536F`, `--c-ink-4 #8395AC`,
`--c-surface #FFFFFF`, `--c-surface-2 #F6F8FA`, `--c-surface-3 #F9F8F4`,
`--c-border #DDE6EF`, `--c-border-2 #C2CEDC`, semantic success/warning/danger/info
sets, and `--app-*` aliases per `src/index.css`.

Dangling token references (token not defined anywhere; fallback always rendered)
were renamed to the real token, with fallback set to the token's live value:

| File:line (pre-edit) | Before | After |
|---|---|---|
| UserManagement.css:897 | `var(--app-ink, #0D1F32)` | `var(--app-text, #0B1F33)` |
| Reports.css (5 sites) | `var(--c-ink-soft, #45617d)` | `var(--c-ink-3, #50536F)` |
| EmployeeWorkspace.css:154 | `var(--c-ink-muted, #5E7A96)` | `var(--c-ink-3, #50536F)` |
| EmployeeWorkspace.css:170 | `var(--c-primary, #0F2744)` | `var(--c-navy, #0E2444)` |

---

## vD.4 — 2026-07-07 — UserManagement: de-hardcode hex, normalize radii, RTL, type token

**File:** `src/components/Sidebar/Tabs/UserManagement/UserManagement.css`

49 naked hex occurrences replaced by tokens per the substitution table in vD.9
(shared table). Radius normalization applied uniformly:

| Before | After |
|---|---|
| `border-radius: 18px;` | `border-radius: var(--r-3xl, 18px);` |
| `border-radius: 14px;` | `border-radius: var(--r-xl, 12px);` (off-scale 14px normalized down 2px) |
| `border-radius: 12px;` | `border-radius: var(--r-xl, 12px);` |
| `border-radius: 12px 12px 0 0;` | `border-radius: var(--r-xl, 12px) var(--r-xl, 12px) 0 0;` |
| `border-radius: 10px;` | `border-radius: var(--r-lg, 10px);` |
| `border-radius: 8px;` | `border-radius: var(--r-md, 8px);` |
| `border-radius: 6px;` | `border-radius: var(--r-sm, 6px);` |

Left intentionally: `99px`/`999px` pills, `50%` circles, `7px`, `4px`, `21px`,
`34px` (toggle-switch geometry).

RTL conversions (line numbers pre-edit):

| Line | Before | After |
|---|---|---|
| 214 | `margin-right: auto;` | `margin-inline-start: auto;` |
| 659 | `margin-right: 6px;` | `margin-inline-start: 6px;` |
| 701,705,716,731,749 | `border-left: 1px solid var(--app-border);` | `border-inline-end: 1px solid var(--app-border);` |
| 761 | `border-left: 0;` | `border-inline-end: 0;` |
| 904 | `padding-right: 28px !important;` | `padding-inline-start: 28px !important;` |
| 909 | `margin-left: 4px;` | `margin-inline-end: 4px;` |
| 1251 | `margin-right: 0;` | `margin-inline-start: 0;` |

Skipped as intentionally physical: line 1053 `right: 3px` (toggle-switch knob,
paired with a hardcoded `translateX` slide animation).

Type-scale adoption in a touched rule — `.um-locked-tag`:

**Before:**
```css
  font-size: 11px;
```

**After:**
```css
  font-size: var(--fs-2xs, 11px);
```

---

## vD.5 — 2026-07-07 — Archive: de-hardcode hex (incl. approved kicker/h2/p), type tokens

**File:** `src/components/Sidebar/Tabs/Archive/Archive.css`

60 naked hex occurrences replaced by tokens per the vD.9 table. The three cases
called out in the approved review:

**Before:**
```css
.arc-panel-kicker {
  display: block;
  margin-bottom: 4px;
  color: #6d86a3;
  font-size: 10px;
```
```css
.arc-panel h2 {
  margin: 0;
  color: #0f2744;
  font-size: 16px;
  font-weight: 850;
}

.arc-panel p {
  margin: 0;
  color: #4f6884;
  font-size: 13px;
  line-height: 1.8;
}
```

**After:**
```css
.arc-panel-kicker {
  display: block;
  margin-bottom: 4px;
  color: var(--c-ink-3, #50536F);
  font-size: 10px;
```
```css
.arc-panel h2 {
  margin: 0;
  color: var(--c-navy, #0E2444);
  font-size: var(--fs-md, 16px);
  font-weight: 850;
}

.arc-panel p {
  margin: 0;
  color: var(--c-ink-3, #50536F);
  font-size: var(--fs-sm, 13px);
  line-height: 1.8;
}
```

---

## vD.6 — 2026-07-07 — ReportDesigner: RTL logical properties, exact-token hex, --rd-danger

**File:** `src/components/Sidebar/Tabs/ReportDesigner/ReportDesigner.css`

ReportDesigner uses a deliberate local Power BI-style palette (`--rd-*` tokens,
Office/GitHub grays); only exact global-token matches were substituted
(5 occurrences of `background: #f6f8fa;` to `background: var(--c-surface-2, #F6F8FA);`).

Dangling local token completed — `--rd-danger` was referenced
(`color: var(--rd-danger, #c0392b);`) but never defined; its fallback value was
added to the existing local token block (no color change):

**Before:**
```css
  --rd-accent: #0078d4;
  --rd-accent-hover: #106ebe;
```

**After:**
```css
  --rd-accent: #0078d4;
  --rd-danger: #c0392b;
  --rd-accent-hover: #106ebe;
```

RTL conversions (line numbers pre-edit):

| Line | Before | After |
|---|---|---|
| 48 | `border-left: 1px solid var(--rd-panel-border);` | `border-inline-end: ...` |
| 71 | `border-right: 1px solid var(--rd-panel-border);` | `border-inline-start: ...` |
| 480-481 | `right: 0;` + `left: 0;` | `inset-inline: 0;` (single declaration) |
| 645 | `margin-right: auto; /* RTL: ... */` | `margin-inline-start: auto; /* RTL: ... */` |
| 648 | `margin-right: auto;` | `margin-inline-start: auto;` |
| 809 | `margin-right: auto;` | `margin-inline-start: auto;` |

---

## vD.7 — 2026-07-07 — Reports: de-hardcode hex, RTL, type token

**File:** `src/components/Sidebar/Tabs/Reports/Reports.css`

32 naked hex occurrences replaced per the vD.9 table. RTL conversions:

| Line | Before | After |
|---|---|---|
| 57 | `margin-right: auto;` | `margin-inline-start: auto;` |
| 737 | `padding-left: 16px;` | `padding-inline-end: 16px;` |
| 738 | `border-left: 1px solid var(--c-border, #DDE6EF);` | `border-inline-end: ...` |
| 739 | `margin-left: 4px;` | `margin-inline-end: 4px;` |

Skipped as intentional: line 37 `left: 50%` (toast centering paired with
`translateX(-50%)`, direction-neutral).

Type-scale adoption in the touched `.rh-quick-label` rule:
`font-size: 13px;` to `font-size: var(--fs-sm, 13px);`

---

## vD.8 — 2026-07-07 — AuthGate + Population: de-hardcode hex, Population RTL

**File:** `src/auth/AuthGate.css`

15 naked hex replaced per the vD.9 table; notably the local token block now
aliases global tokens:

**Before:**
```css
  --auth-soft:   #F2F6FB;
  --auth-text:   #0D1F32;
  --auth-muted:  #6B86A0;
  --auth-border: #D4E1EF;
```

**After:**
```css
  --auth-soft:   var(--c-surface-2, #F6F8FA);
  --auth-text:   var(--c-ink, #0B1F33);
  --auth-muted:  var(--c-ink-3, #50536F);
  --auth-border: var(--c-border, #DDE6EF);
```

**File:** `src/components/Sidebar/Tabs/Population/Population.css`

32 naked hex replaced per the vD.9 table (includes local `--p-*` definitions now
aliasing globals, e.g. `--p-surface-soft: #f8fafc;` to
`--p-surface-soft: var(--c-surface-2, #F6F8FA);`). RTL conversions:

| Line | Before | After |
|---|---|---|
| 191 | `margin-left: 4px;` | `margin-inline-end: 4px;` |
| 259, 2381, 2413 | `border-left: 1px solid var(--p-border-light);` | `border-inline-end: ...` |
| 262, 2015 | `border-left: none;` | `border-inline-end: none;` |
| 2245 | `margin-right: auto;` | `margin-inline-start: auto;` |
| 2403 | `margin-left: 4px;` | `margin-inline-end: 4px;` |
| 3163 | `left: 0;` | `inset-inline-end: 0;` |

Skipped as intentional: line 3093 `left: 50%` (bar-percentage centering paired
with `translateX(-50%)`).

---

## vD.9 — 2026-07-07 — Shared hex-to-token substitution table (mechanical pass)

**Files:** `UserManagement.css`, `Archive.css`, `Reports.css`, `AuthGate.css`,
`Population.css` (full table); `ReportDesigner.css` (exact rows only)

Every naked occurrence of the hexes below (case-insensitive, not already inside
a `var()` fallback) was replaced by `var(<token>, <live value>)`:

Exact token values: `#dde6ef→--c-border` `#c2cedc→--c-border-2` `#009ade→--c-sky`
`#007fba→--c-sky-2` `#e5f5fb→--c-sky-light` `#0b1f33→--c-ink` `#263c58→--c-ink-2`
`#50536f→--c-ink-3` `#8395ac→--c-ink-4` `#f6f8fa→--c-surface-2` `#f9f8f4→--c-surface-3`
`#0e2444→--c-navy` `#102c57→--c-navy-2` `#143a68→--c-navy-3` `#e8eef6→--c-navy-soft`
`#004030→--c-success` `#e3f3ed→--c-success-bg` `#8bbeaa→--c-success-border`
`#775000→--c-warning` `#fbf2dc→--c-warning-bg` `#e5b46e→--c-warning-border`
`#9f1624→--c-danger` `#fde8ea→--c-danger-bg` `#f4a4ac→--c-danger-border`
`#1e40af→--c-info` `#dbeafe→--c-info-bg` `#93c5fd→--c-info-border`
`#daa328→--brand-premium`

Nearest-token (perceptually near-identical, same semantic role):
`#0f2744 #06244a #10233f→--c-navy` | `#0d1f32→--c-ink` |
`#162f56 #152e52 #112c50→--c-navy-2` | `#17365d #1c3a68 #1a3a6b→--c-navy-3` |
`#d6e2ef #d8e3ef #d7e3ef #d4e1ef #d7e5f5 #e2e8f0→--c-border` |
`#c9d8e8 #cbd8e6 #cbd6e2 #d1d5db #b9c8d8→--c-border-2` |
`#f4f7fb #eef2f7 #f8fafc #f0f4f8 #f3f6fa #f1f5f9 #f9fafb #f7fafd #fafcfe #f5f9fd #eef3f8 #edf2f7 #edf3f8 #f8fbff #f2f6fb #ebf2fa #eaf0f7 #fafbfc #f6faff #f5f7fa #f0f5fa #f0f3f7 #eef1f5→--c-surface-2` |
`#e8eef5 #e4edf7 #e2ebf5 #e6eef6→--c-navy-soft` | `#e8f4fd→--c-sky-light` |
`#9db3c9 #94a3b8 #8298b0 #8390a2→--c-ink-4` |
`#5e7a96 #637188 #6d86a3 #4f6884 #425d7a #45617d #475569 #6b86a0→--c-ink-3` |
`#334b68 #203a56 #2c4260→--c-ink-2` | `#991b1b→--c-danger` |
`#fee2e2 #fde8e8 #fee4e2→--c-danger-bg` | `#fca5a5→--c-danger-border` |
`#fef3c7 #fbf2da→--c-warning-bg` |
`#dcfce7 #d1fae5 #e6f5ee #edf7ee #f0faf5 #eef8f4 #d1f0db→--c-success-bg`

Deliberately NOT mapped (no close token; listed for a future decision):
whites (`#fff`/`#ffffff` — house pattern keeps literal white for on-dark text);
vivid accent/legend palettes (`#3b82f6 #22c55e #ef4444 #7c3aed #6d28d9 #1d4ed8
#16a34a #15803d #0369a1 #027a48 #b42318 #64748b #fecdca #fecaca #ede9fe #e0f2fe
#f0fdf4 #f0f7ff #b9d7f0 #b7d8cc #92400e #166534 #bfdbfe #fef9c3 #eff6ff #86efac
#854d0e #5b21b6 #6366f1 #dc2626 #34d399 #bbf7d0 #fbbf24 #b7791f #d97706 #98a2b3
#b91c1c #7f1d1d #1e3a8a #f87171 #60a5fa #fcd0cd #333 #444` etc.);
ReportDesigner Power BI/GitHub theme grays (`#d0d7de #57606a #24292f #1f6feb
#e1dfdd #f3f2f1 #cf222e #edebe9 #eaeef2 #605e5c #201f1e #0078d4 #106ebe #c0392b
#e8e6e4 #f9f8f7 #ffd7d5 #ffcecb`);
Reports GitHub-markdown-preview grays and status tints (`#fdf8ec #fdf1f1 #fbe3e1
#f3e2b3 #f3cccc #eef2ff #a19f9d #1f2328 #00695c #bde0fa`);
AuthGate deep-navy gradient stops darker than any token (`#071528 #071428 #0c1e38
#0b1e34 #0a1d36`) and on-dark tints (`#b0c4d8 #bad0e3 #adc5dc #9fb6cc #fef2f2
#ecfdf5 #6ee7b7 #065f46`).

---

## vD.10 — 2026-07-07 — RTL logical-property conversions in shared components

**File:** `src/components/DataTable/DataTable.css`

| Line | Before | After |
|---|---|---|
| 174 | `border-left: 1px solid var(--c-border, #DDE6EF);` | `border-inline-end: ...` |
| 189 | `.dt-th:first-child { border-left: none; }` | `border-inline-end: none;` |
| 307 | `border-left: 1px solid var(--c-surface-3, #F9F8F4);` | `border-inline-end: ...` |
| 363 | `.dt-td:first-child { border-left: none; ... }` | `border-inline-end: none;` (text-align untouched) |
| 471 | `padding-left: 2px;` | `padding-inline-end: 2px;` (RTL scrollbar side) |

Skipped as intentionally physical: line 764 `.dt-resize-handle { left: 0; ... }`
(column-resize handle paired with `translateX(-50%)`).

**File:** `src/components/FeedbackWidget/FeedbackWidget.css`

| Line | Before | After |
|---|---|---|
| 5 | `left: 24px;` | `inset-inline-end: 24px;` |

**File:** `src/components/InspectionPanel/InspectionPanel.css`

| Line | Before | After |
|---|---|---|
| 156 | `right: 0;` | `inset-inline-start: 0;` (step separator) |

**File:** `src/components/Sidebar/Tabs/Population/components/DataAccuracyReport.css`

| Line | Before | After |
|---|---|---|
| 73 | `right: 0;` | `inset-inline-start: 0;` (KPI accent bar, matches ui-stat pattern) |

**File:** `src/components/Sidebar/Tabs/EmployeeWorkspace/EmployeeWorkspace.css`

| Line | Before | After |
|---|---|---|
| 413 | `margin-right: 2px;` | `margin-inline-start: 2px;` |
| 522 | `margin-left: auto;` | `margin-inline-end: auto;` |
| 731 | `right: 0;` | `inset-inline-start: 0;` (KPI accent bar) |
| 1265 | `border-left: 1px solid var(--c-border, #DDE6EF);` | `border-inline-end: ...` |
| 1272 | `.ref-th:first-child { border-left: none; }` | `border-inline-end: none;` |
| 1346 | `border-left: 1px solid var(--c-surface-3, #F9F8F4);` | `border-inline-end: ...` |
| 1355 | `.ref-td:first-child { border-left: none; ... }` | `border-inline-end: none;` |
| 1368 | `right: 0;` | `inset-inline-start: 0;` (filter dropdown anchor) |
| 1443 | `margin-right: 24px;` | `margin-inline-start: 24px;` |
| 1459 | `left: 0;` | `inset-inline-end: 0;` (column-config panel anchor) |

Not converted (out of authorized file list): `src/components/Sidebar/Sidebar.css`
(3 physical margin/padding occurrences).

All conversions are behavior-preserving aliases under the app's `dir="rtl"`
containers (`border-left` = `border-inline-end`, `left` = `inline-end`, etc.);
they only change behavior if a container were ever flipped to LTR, which is the
point of the fix.
