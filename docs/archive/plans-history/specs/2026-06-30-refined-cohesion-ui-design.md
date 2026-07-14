# Refined Cohesion — UI/UX Visual Elevation Design

**Date:** 2026-06-30
**Status:** Approved (design) — pending spec review
**Scope:** In-app experience (app shell, navigation, dashboards, data views, forms, workflows)
**Out of scope:** Generated HTML reports; the login (`AuthGate`) structure/layout (colors only)

---

## 1. Problem

The app has a strong design foundation — a complete token system in `src/index.css` (navy/sky/gold palette, Somar Sans Arabic type, shadow/radius/motion scales) — but the components don't use it. The result reads as "dated and inconsistent" tab-to-tab.

### Audit evidence

| Finding | Evidence | Consequence |
|---|---|---|
| Token system bypassed | 1,319 hardcoded hex values across 20 CSS files | Shades drift screen-to-screen |
| Shared primitives unused | `.ui-button-*` / `.ui-panel` / `.app-card` referenced **0×** in `.tsx` | No single source of truth for components |
| Components re-roll everything | 376 local `*btn*/*button*/*card*/*panel*` class definitions across 14 CSS files | The same element looks different per screen |
| Real color drift | `AuthGate` navy `#0F2744` ≠ token navy `#0E2444`; `AuthGate` blue `#2D7DD2`/`#5EB8FF` ≠ token sky `#009ADE` | The "premium" login doesn't match the app |

## 2. Goal & non-goals

**Goal:** Make the in-app experience cohesive and premium by making it actually consume the design system it already defines, while deliberately elevating depth, spacing, and hierarchy as we migrate ("polish-while-migrating").

**Non-goals:**
- No rebrand and no palette change (keep navy/sky/gold).
- No new external fonts or libraries (recharts is already present).
- No changes to generated HTML report builders.
- No restructuring of the login layout — only snap its colors to tokens.
- Not a UX-flow redesign (navigation/IA stays; this is a visual-cohesion + polish pass).

## 3. Approach

**Phased hybrid:** lay a token/primitive foundation first, then run a polish pass per surface that *consumes* that foundation. This fixes the structural cause (duplicated, drifting local styles) and produces a visibly elevated, stakeholder-ready result after each phase, at low risk.

### Migration depth: "polish-while-migrating"
When replacing hardcoded colors with tokens, intentionally refine shades/spacing/depth for a more premium feel. Screens may look noticeably better (not merely identical-but-tokenized). Each such change is recorded in `docs/EDIT_LOG.md`.

## 4. Design principles

1. **Single source of truth** — every color/space/shadow comes from a token; no new hardcoded hex introduced.
2. **Shared primitives** — one canonical Button, Card/Panel, Stat, Badge, Field, SectionHeader, Toolbar; tabs consume them and delete local duplicates.
3. **Deliberate depth & hierarchy** — consistent elevation tiers, a real spacing scale, clearer type hierarchy.
4. **Quiet, professional motion** — hover/focus/tab transitions using existing easing/duration tokens; subtle, never flashy. Honor `prefers-reduced-motion`.
5. **Logical properties for RTL** — `margin-inline`, `padding-inline`, `inset-inline`, `border-start-*` so nothing breaks in RTL.

## 5. Architecture decision — primitives layer

**CSS-first.** The canonical source of truth is a new stylesheet `src/styles/primitives.css`, imported once (via `index.css` or `main.tsx`). It defines token-driven classes:

- `.ui-btn` (+ `--primary`, `--secondary`, `--danger`, `--ghost`; sizes `--sm`, `--md`; icon slot)
- `.ui-card` / `.ui-panel` (elevation tiers via shadow tokens; optional `.ui-card__header`)
- `.ui-stat` (KPI: label, value, optional delta + icon)
- `.ui-badge` (status: success / warning / danger / info / neutral)
- `.ui-field` (label + control + hint + error wrapper; input/select/textarea base)
- `.ui-section` (eyebrow + title + actions; aligns with existing `PageHeader`)
- `.ui-toolbar` (filter/action bar row)

**Thin React wrappers only where they cut real duplication** — initially `Button` and `StatCard` under `src/components/ui/`. These are presentational, render the canonical classes, and add no new design decisions. Existing co-located-CSS convention is otherwise preserved. We do **not** introduce a CSS framework.

This keeps the change low-risk (mostly CSS), consistent with the codebase, and easy to verify visually.

## 6. Token extensions (Phase 0, in `src/index.css`)

- **Spacing scale:** `--sp-1 … --sp-12` (4px base) — replaces ad-hoc pixel paddings/margins over time.
- **Elevation tiers:** keep existing `--sh-xs…xl`; document which tier maps to which surface (resting card = xs/sm, raised/overlay = md/lg, modal = xl).
- **Derived tokens:** `--focus-ring`, `--hover-tint`, `--accent-gradient` (navy→sky), `--premium-hairline` (gold), `--surface-raised`.
- No existing token values change in Phase 0 (additive only); intentional shade refinements happen per-surface in Phases 1–4 and are logged.

## 7. Phases & deliverables

### Phase 0 — Foundation
- Extend tokens in `index.css` (additive).
- Create `src/styles/primitives.css` + wire import.
- Create `src/components/ui/Button.tsx`, `StatCard.tsx` (+ co-located CSS only if needed beyond primitives).
- Write `docs/design-system.md` (token reference + primitive usage).
- **Done when:** primitives render correctly in a scratch/preview check; build green; no visual regressions on untouched tabs.

### Phase 1 — App shell & navigation
- `App.css`, `Sidebar.css`, top bar, `PageHeader.css`: unified elevation, refined active-state, consistent gold hairline accent, subtle tab-switch motion. Migrate shell hardcoded colors to tokens.
- **Done when:** shell uses tokens/primitives; screenshots captured; RTL verified.

### Phase 2 — Dashboards & data views
- Population, Employee Workspace, Reports: adopt `.ui-stat`/`StatCard` for KPIs, theme recharts to tokens, polish `DataTable.css` (header, row hover, density, sort indicators, empty states), consistent `.ui-section` headers.
- **Done when:** these tabs use primitives + tokens; charts/tables themed; screenshots captured.

### Phase 3 — Forms & workflows
- Import wizard, Settings, User Management, Template Builder: unify inputs/selects/toggles/buttons via `.ui-field`/`.ui-btn`, refine form layout, validation states, wizard step affordances.
- **Done when:** form controls are consistent across these tabs; screenshots captured.

### Phase 4 — Consistency sweep
- Migrate remaining hardcoded colors to tokens; snap `AuthGate` navy/blue to tokens; delete duplicate local button/card/panel classes now superseded by primitives; accessibility pass (focus rings, contrast, reduced-motion); final cross-tab visual QA.
- **Done when:** hardcoded-hex count outside `index.css`/`primitives.css` is near-zero for migrated surfaces; no duplicate primitives remain; QA screenshots captured.

## 8. Per-phase discipline (every phase)
- One `docs/EDIT_LOG.md` entry per change (Before/After snippets) per CLAUDE.md.
- Re-check single-file build size after large additions (baseline ~1.9 MB / ~664 kB gzip).
- Visual verification via the dev server (preview tooling) with screenshots before marking a phase done.
- `npm run lint` green; `npm run test:run` unaffected (no logic changes expected).

## 9. Risks & mitigations
- **Unintended visual regressions** from token migration → migrate surface-by-surface, screenshot before/after, keep Phase 0 additive.
- **Build-size creep** → CSS-only mostly; re-check size each phase; no new libs/fonts.
- **RTL breakage** → use logical properties; verify each phase in RTL.
- **Scope creep into UX/IA** → explicitly out of scope; flag separately if discovered.
- **Duplicate-class deletion breaking a screen** → delete only after the screen is migrated and screenshot-verified.

## 10. Verification / success criteria
- Every targeted surface draws color/space/shadow from tokens/primitives (no new hardcoded hex).
- Shared primitives are used (the 0× usage problem is reversed); local duplicate button/card classes removed on migrated surfaces.
- `AuthGate` colors match tokens.
- Lint green; tests pass; build size within expected envelope.
- Before/after screenshots per phase demonstrate a visibly more cohesive, premium look.

---

## Addendum (2026-06-30) — viewer/demo mode + visible-polish correction

Added after the first pass, in response to two findings:

1. **"Nothing changed" was real.** Most of the first migration swapped hardcoded hex for tokens that resolve to identical pixels — cohesive but invisible. Corrective work wired genuinely visible premium treatments into the always-on surfaces: layered canvas tint (`--app-canvas-tint`) on `.app-shell`, gold accent bar (`--gold-accent-bar`) on `PageHeader`, tinted table headers (`--table-head-bg`) on `DataTable`, gradient + sky-shadow primary buttons (`--sky-gradient` / `--sh-sky`), and a stronger sidebar active state.

2. **Verification gap closed via a viewer/demo account.** The app is gated behind the File System Access folder picker, which a headless preview can't satisfy — so visual work couldn't be screenshot-verified. Added a built-in `viewer` / `view` login that mounts a **read-only, in-memory demo workspace** (seeded with the 5 default managed users) and skips the picker. Gate order was changed to login-first so the credential is reachable. Read-only is enforced by a global `isReadOnlyMode()` guard on the safe-write layer (exports unaffected; the demo workspace is in-memory anyway). The account is removable by deleting the `VIEWER_*` block in `authConfig.ts`.

**Verified live (demo mode):** login bypass works, read-only banner shows, full admin navigation renders, User Management shows seeded users, no console errors, build + lint green.

**Known follow-up:** demo mode currently seeds users only — Population/Samples/Reports show empty states. Seeding realistic population/sample data (via `saveMonthRun`) is the next increment to make those dashboards fully populated.
