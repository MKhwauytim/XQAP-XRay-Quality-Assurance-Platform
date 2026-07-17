# Batch 4 Safe Items — Design Spec

- **Date:** 2026-07-17
- **Status:** Approved (autonomous /goal run — items pre-triaged by an independent read-only investigation separating safe bug-fixes/mechanical work from genuine product decisions)
- **Scope:** Execute the three Batch 4 items an independent triage (`.superpowers/sdd/batch4-triage.md`) found to be safe, bounded, and testable without requiring a product/policy decision. The two remaining Batch 4 items (hardcoded-Arabic sweep, D3(b) heuristic tuning) stay deferred — the triage found genuine landmines in both (data-value literals that must not move, an interpolated-string primitive that doesn't exist yet, and a heuristic-tuning judgment call) that a "no question asked" autonomous pass should not force through.

## Background

The prior quality-pass work (merged via PR #21) deliberately deferred all of "Batch 4" as product/scope decisions. That blanket deferral was reconsidered: some Batch 4 items bundle a genuine policy question together with a separate, well-defined bug or mechanical improvement that doesn't require inventing any product decision. A follow-up investigation (read-only, no code changed) separated the two for each item. This spec scopes only the safe fraction of each.

## Items in scope

### 1. C-16 (partial) — date-parsing month>12 rescue

`src/components/Sidebar/Tabs/Population/processing/populationProcessor.ts`'s `normalizeDate` (currently lines 215-268; the numeric branch at 232-242) hard-assumes day-first for ambiguous `DD/MM/YYYY`-shaped strings. This is unavoidably a policy question when BOTH interpretations are syntactically valid (`"03/04/2026"` — 3 April vs. 4 March) — **that stays untouched**.

But there's a separate, unambiguous gap: when the day-first interpretation is syntactically *impossible* (the "month" slot is 13-31, which can never be a real month), the value currently falls all the way through to `return raw` — never normalized to ISO, even though the month-first reading is unambiguously the only valid one (e.g. `"12/25/2025"` — December 25, no other valid reading exists). The row survives (it isn't dropped from the population), but its date field stays as a raw, un-normalized string.

**Fix:** add a fallback branch, gated strictly behind the existing day-first check, that only fires when day-first parsing is syntactically invalid (second component 13-31) AND the month-first reading is syntactically valid (first component 1-12). This can never change the output of any string that already parses successfully today — it only rescues strings that currently produce no ISO output at all.

### 2. ARC-01 (partial) — XrayReferrals.tsx mechanical sub-component extraction

`src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx` is 1545 lines. It already defines eight sub-components (`QueueToolbar`, `SelectionActionBar`, `SampleDetailPanel`, `ReferralRequestModal`, `ReferralSamplePreview`, `StatusBadge`, `ReferralStatsStrip`, `ReplacementDialog`) plus five pure helper functions at module scope — all prop-driven, none closing over the parent component's local state. This is a cut-and-import extraction, not a redesign: moving already-decoupled, already-tested code into sibling files. `tsc -b` plus the existing `XrayReferrals`/`unifiedList` tests verify behavioral equivalence.

**Scope boundary:** only the already-decoupled pieces move. The main `XrayReferrals` component itself (which genuinely holds the wizard's local state and effects) stays in `index.tsx`. This is not a full refactor of the file — it's removing ~500 lines of code that were already logically separate, just not physically separate.

### 3. C-15 (near-full) — minimal read-only governance audit-log viewer

`appendWorkspaceAction` already writes `5-system/audit/actions.log.json`, and a reader (`readWorkspaceActions`) already exists and is exported (`src/data/audit/actionLog.ts`) — but nothing renders it. The existing auth-activity-log viewer (UserManagement's `activity` sub-tab, `renderActivity()`) is a direct structural precedent to mirror: a plain table (not `DataTable`) populated in a `section === X` effect, with a refresh button.

**The one genuine decision, resolved conservatively:** who sees it. The governance log records supervisor/manager actions (sample draws, referral decisions) as well as admin actions, so a manager might reasonably want to review it — but UserManagement itself is an admin-only top-level tab (per CLAUDE.md's tab table), and adding manager-level access would require touching the permission matrix (`MANAGED_TABS`/`createDefaultPermissions`), which is exactly the kind of standing-permission change this spec wants to avoid inventing unilaterally. **Decision: admin-only**, as a new sub-tab inside UserManagement (the existing admin-only container), consistent with the existing tab's access level and requiring no permission-matrix changes. This is the conservative default; broadening it to managers is a separate, explicit future decision if the actual owner wants it.

**Scope:** a new `renderActions()` function mirroring `renderActivity()`'s structure exactly: loads via `readWorkspaceActions(directoryHandle)` in a `section === "actions"` effect, renders a plain table with one column per field of `WorkspaceActionEntry` (`{ id, at, actor, actorRole, action, monthFolderName?, target?, details? }`), with a static Arabic label map for the 16 `action` union values (new user-facing text — goes through `labelsStore.ts` per convention, not hardcoded, since these are genuinely new UI labels being introduced, not a pre-existing hardcoded string being migrated).

## Explicitly out of scope (stays deferred)

- **The C-16 both-valid-ambiguous policy** (what `"03/04/2026"` should mean) — a genuine product decision, untouched.
- **D3(a)** (custom fields get no auto-detect hints) — by design, not a bug, per the triage.
- **D3(b)** (portCode/portName alias overlap) — a real but low-severity heuristic-tuning bug; fixing it could shift suggestions either direction, which is a judgment call the triage correctly flagged as needing a scoped UX-polish pass, not an autonomous fix.
- **Hardcoded-Arabic sweep** — genuine landmines (data-value literals that must not move through the label system; ~51 interpolated strings needing a new parameterized-label primitive that doesn't exist yet; comment/config noise inflating the naive count). Needs a human triage pass before any bulk migration.
- **Reports.tsx / Population/index.tsx further extraction** — the triage found only cosmetic-value or no safe extraction available; not pursued.

## Testing

- C-16: add a `describe("normalizeDate")` block to `populationProcessor.test.ts` covering (a) day-first cases unchanged (including the ambiguous `03/04/2026` staying 3 April — a regression guard on the policy itself, not just the new code), (b) the new month-first rescue cases, (c) genuinely unparseable strings (both components invalid) still returning raw.
- ARC-01: no new tests — the existing `XrayReferrals.tsx`/`unifiedList.test.tsx` suite must continue passing unchanged after the extraction, proving behavioral equivalence. `tsc -b` catches any prop-shape drift.
- C-15: a focused test for `renderActions()` if `UserManagement/index.tsx` has an existing test file to extend; otherwise a manual note, matching this session's established practice of not forcing brittle tests onto components without existing test infrastructure.

## Documentation

- `docs/EDIT_LOG.md`: entries per CLAUDE.md's requirement, under a new version heading (this is bug-fix + mechanical-refactor + minor-feature work, decimal bump).
- New label keys for the audit-log viewer's `action` display labels added to `labelsStore.ts`.
- `CLAUDE.md`'s UserManagement sub-tab row gets a note about the new `actions` sub-tab, matching how other sub-tabs are documented in the tab table.
