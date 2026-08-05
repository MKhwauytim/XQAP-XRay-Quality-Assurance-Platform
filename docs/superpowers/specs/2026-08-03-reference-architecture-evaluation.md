# Architecture Evaluation — XQAP Reference Architecture vs. Current Codebase

**Date:** 2026-08-03 · **Scope:** Sections 4.1–4.7 of the owner's reference architecture document (pasted in chat, not a repo file), evaluated per its own Section 7 framework (Fit / Cost / Compatibility / Best-practice / Verdict), against six research passes over the live codebase plus work already shipped this session (Plans 1-6). Produced by a 7-agent Workflow (6 parallel discovery agents + 1 opus synthesis pass); this document is the synthesis agent's output, saved verbatim as the session's record.

---

## Method and headline finding

Every claim below is anchored to code actually read. Where the reference document's premise turned out not to match the codebase, that is stated plainly rather than smoothed over.

The headline: **the reference document is directionally correct on navigation, sync, and load discipline, materially overstates the problem on saving, and contains one framing claim (4.2's "security property") this architecture cannot honour.** Four of its six elements are already partly delivered — three of them by work shipped this evening. Nothing in the document requires a database, a server, or a new sync transport.

| Element | Current state | Shipped this session | Verdict |
|---|---|---|---|
| 4.1 Auth before loading | One real checkpoint, two leaks around it | Partially (boot made cheaper, not reordered) | **Adopt with modification** |
| 4.2 Role-scoped loading | Tab-level yes, dataset-level no | No | **Adopt with modification; reject the security framing** |
| 4.3 Single load + central state | No store; N per-screen loaders | Partially (symptom, not structure) | **Adopt with major modification** |
| 4.4 Instant navigation | Solved for 3 tabs, 4 holdouts remain | Substantially | **Adopt as-is; finish the rollout** |
| 4.5 Background sync | Blind 5-min full re-read | Partially (one incremental cache) | **Adopt with modification** |
| 4.6 Incremental saving | Already strong; two debounce gaps | No | **Adopt with modification (premise is wrong)** |

---

## 4.1 — Identity → role → permissions → data, in that order

**What the code does.** The tree is `WorkspacePicker > GlobalMonthProvider > AuthGate > WorkspaceGate > AppContent` (`src/App.tsx:325-337`, verified). There *is* a deliberate synchronization checkpoint — `WorkspaceGate.tsx:264` refuses to render `AppContent` until `status === "ready" && usersHydrated`. Two things escape it. First, `GlobalMonthProvider` sits **above** `AuthGate`, so `listMonthFolders(directoryHandle)` (`GlobalMonthProvider.tsx:48-78`) fires against the workspace while the login form is still on screen. Second, `AuthGate` renders its authenticated branch purely on `session !== null` read synchronously from `sessionStorage` (`authSession.ts:99-115`); validating that user against disk is deferred to an effect gated on `usersHydrated` (`AuthGate.tsx:253-272`), so a removed or demoted user is briefly rendered as authenticated.

**Fit / Cost / Compatibility.** Good fit, low cost, high compatibility — the checkpoint already exists and simply needs to cover two more call sites. Best-practice comparison: this is the standard route-guard-before-loader ordering (React Router / Remix loaders run after the auth guard, not beside it).

**Verdict: ADOPT WITH MODIFICATION.** Two surgical changes, not a boot rewrite: (i) move `GlobalMonthProvider` inside `AuthGate`, or gate its listing effect on a session; (ii) extend the existing `usersHydrated` gate to `AuthGate`'s initial authenticated render. The modification to 4.1 itself: strict "identity → role → permissions → data" is not literally achievable here, because permissions live in a *workspace file* (`3-user-data/users.permissions.json`) that requires the directory handle first. The honest invariant is **"no business-data read before `usersHydrated`"**, with workspace mounting as an explicit, permitted precondition.

---

## 4.2 — Role-scoped loading, and the security-property overclaim

**What the code does.** Cross-tab scoping is genuine load-gating: `App.tsx:60-86` filters tabs by role and `:282-297` only mounts components for allowed ids, so an `employee` session never instantiates Reports or UserManagement and their loaders never fire. Within a permitted tab, it is load-then-filter. `XrayInspectionResults.tsx:236` and `XrayReferrals.tsx:382` both call `loadOrDeriveDistributionCurrentForRead` unconditionally, which reads **every** event file for **every** employee in the month; scoping happens afterward at `:253-256` and `:395-397`. Answer files, by contrast, are correctly load-scoped by username. The per-employee primitive `loadEmployeeSampleMirror` exists and is wired in — but only as a fallback (`XrayReferrals.tsx:383-386`), never as the primary path.

**The framing mismatch — flag this explicitly.** The document states: *"If a user lacks permission for a dataset, that dataset must never be loaded on their behalf — this is a security property, not just a performance one."* `docs/architecture/SECURITY_MODEL.md:22-27` says the opposite about this app: the auth layer *"is a UX/role-routing guard, not a trust boundary."* The workspace folder is a shared network folder the same user can open in a text editor; `distribution.current.json` and `main.samples.json` are readable there regardless of what the React app chooses to fetch. Load-scoping therefore delivers **defence in depth for the accidental path** — it stops casual devtools snooping and shrinks the blast radius of a rendering bug — but it is **not a security guarantee**, because the trust boundary sits below the browser entirely. Any user-facing communication that describes this work as a security fix would be an overclaim. Recommend it on performance, correctness, and hygiene grounds only.

**Verdict: ADOPT WITH MODIFICATION.** Adopt the loading discipline; strike the security framing. Modification: the cheap, non-structural win is to filter distribution entries **at fold time rather than render time** for employee sessions. Promoting the sample mirror to the primary read path is the larger win, but it is one of the **proposal-covered** findings in `APP_DATA_MANAGEMENT_AUDIT_2026-07-22.md`, gated behind unapproved Phases B/C. That one must be sequenced with the proposal, not taken unilaterally.

---

## 4.3 — Single initial load + centralized state, and the large-population conflict

**What the code does.** There is no store. Two `createContext` calls exist repo-wide — `WorkspaceContext` (connection handle, status, `usersHydrated`) and `GlobalMonthContext` (month *selection*, not month data) — plus a module-singleton for users/permissions and one for labels. Business data has no home: every screen issues its own load. What *does* exist is three narrow, recently-built primitives — the append-only directory cache (`directoryScan.ts:186-289`), in-flight dedupe plus a per-workspace write epoch (`inFlightReads.ts`), and the payload-free `dataRefreshSignal`.

**The conflict, stated plainly.** Read literally, *"load everything the role needs ONCE"* collides head-on with `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md`, whose decision summary opens with *"load no heavy business dataset at startup"* and whose Phase B specifies that *"no complete population array crosses `postMessage()` into the window."* Phase A shipped 2026-08-01 (v59.111–114) precisely to make the initial load *lighter*. For a 200k–400k-row month, eager-load-at-login and worker-owned-paging are opposite policies for the same bytes. This is a real conflict, not a wording quibble.

**The reconciled middle path — this is the recommendation.** **Centralize the access pattern and the invalidation model; do not centralize the rows.** Concretely: one typed repository layer keyed by `(workspaceRoot, month, dataset, epoch)` — which `dedupeInFlight` and `bumpWorkspaceEpoch` already half-implement — that all screens call instead of hand-rolling `useEffect` loads. Bounded per-role reference data (users, permissions, templates, labels, month manifests, an employee's own sample mirror and answers) may legitimately live in it and load once. Population rows are an **explicit, documented carve-out**: they stay behind the paged/worker contract Phases B/C define, and the shared layer holds only the visible page, cursors, and metadata. This satisfies the reference document's actual goal (no duplicate ad hoc re-reads) without adopting its blanket policy.

**Verdict: ADOPT WITH MAJOR MODIFICATION**, as above. Shipped work partially satisfies this — the cache/dedupe layer and mount-preservation remove the *symptom* (redundant reads) without building the *structure* — which is exactly the right order.

---

## 4.4 — Instant navigation

**What the code does.** `touchTabMountLru` (`app/tabMountLru.ts`) keeps the three most-recent top-level tabs mounted-but-hidden; `touchVisitedTabs` (`app/visitedTabs.ts`) never evicts and has three adopters — Population/Browse, all four EmployeeWorkspace sub-tabs, and Reports' Report Designer. Four holdouts remain, all verified: **Archive** re-runs its full `refresh()` on every mount (`Archive/index.tsx:147-152`); **NotificationManager** the same (`:74-88`); **UserManagement** `activity` and `actions` re-fetch on every section switch (`index.tsx:199-240`); and **Reports/KPI** not only refetches on switch *into* `"kpi"` but nulls the model on switch *away* (`Reports/index.tsx:281-286,305`), guaranteeing a cold rebuild every return.

**Verdict: ADOPT AS-IS.** The mechanism is already proven and reviewed in-repo three times this session; finishing the rollout is mechanical. One caveat to record rather than fix: the top-level LRU is size 3, so "instant" is bounded — visiting a fourth distinct tab evicts the oldest. Raise it only with measurement, not on principle.

---

## 4.5 — Background sync

**What the code does.** `AuthGate.tsx:330-341` starts a fixed 5-minute `setInterval` on sign-in that calls `refreshPermissions()` and `broadcastDataRefresh()`. The signal carries no payload; each subscriber re-runs its own full load. Worse, the append-only cache subscribes to the same signal and **clears wholesale** (`directoryScan.ts:305-307`) — so every five minutes the app discards the incremental cache it just spent the session building, even though that cache's own name-diff invalidation (`:248-253`) is already correct. There is also a `focus`/`visibilitychange`-triggered `listMonthFolders` for an admin-only empty-state banner (`WorkspaceGate.tsx:476-493`).

**Feasibility check.** The document's "detect which files actually changed" is achievable inside the file-based constraint: `getFile().lastModified` and `size` are cheap probes that don't read content, and every file already carries `revision` + `contentHash` in its `JsonEnvelope`. Its "determine what changed *within* them at record level" is not worth building — re-parsing one already-fetched JSON file is not the bottleneck; the network-share round-trip is.

**Verdict: ADOPT WITH MODIFICATION.** Adopt: admin-configurable interval, change-detection before re-read, targeted UI refresh. Modify: (i) give the signal a scope so subscribers can ignore irrelevant ticks; (ii) stop resetting the append-only cache on the periodic tick — reserve the wholesale reset for the manual admin refresh button; (iii) pause the interval while `document.hidden`; (iv) replace "record-level diffing" with mtime + `contentHash` file-level gating, which gets ~all the benefit for ~none of the complexity.

---

## 4.6 — Incremental, reliable saving

**What the code does — and where the document's premise fails.** The document assumes saving is *"deferred to page-change/close/manual-save."* For business data that is simply not true. Quality notes, answer submission, and every distribution action (`useDistributionActions.ts:138-291`) write immediately on click, awaited. Underneath, `safeWriteJson` (`safeWrite.ts:244-423`) snapshots to `.bak`, stages and verifies `.tmp`, commits, re-verifies, and rolls back on failure; `safeReadJson` falls back live → `.bak` → `.tmp`. `casLoop` embeds a fresh UUID token per attempt and, for the two highest-risk shared files, re-reads after a jittered 80–180 ms delay specifically to catch a competing machine's clobber. Distribution events are immutable per-event files, removing the shared mutable log from the durability path entirely. This is *better* than the reference architecture asks for.

Two genuine gaps, both narrow. Report Designer's 800 ms autosave cleanup **cancels the pending timer without flushing** (`ReportDesigner/index.tsx:113-117`) and `onBack` unmounts without an explicit save (`:597-600`) — an edit made <800 ms before "رجوع" is silently discarded. And there is no app-wide unload flush: `pagehide`/`visibilitychange` listeners *do* exist (`AuthGate.tsx:305-319`) but serve auth-activity heartbeat telemetry, not save flushing.

**Verdict: ADOPT WITH MODIFICATION.** Keep the existing write stack untouched — it is the strongest part of the codebase. Scope the work to the two debounced writers.

---

## Prioritized, low-risk action items

**P0 — silent data loss (genuinely new; not in §L/§N/§I/§K/§O/§P/§R)**

1. **Flush Report Designer's pending autosave on unmount and on "رجوع".** `ReportDesigner/index.tsx`. Low-risk: single component, additive, an explicit-save path already exists; worst case is one redundant write of identical content that `safeWriteJson` verifies anyway.
2. **Small pending-save flush registry wired to `pagehide` + `visibilitychange`.** New module under `src/data/storage/`; consumers `ReportDesigner/index.tsx`, `DataTable/index.tsx:314-320`. Listener pattern already proven at `AuthGate.tsx:305-319`. No change to write semantics.

**P1 — finish what shipped (extends this session's mount-preservation work)**

3. **Apply the mount-preservation / skip-guard pattern to the four holdouts:** `Archive/index.tsx:147-152`, `NotificationManager.tsx:74-88`, `UserManagement/index.tsx:199-240`, and Reports/KPI (`Reports/index.tsx:278-305` — stop nulling `model` on switch away). Four independent local guards; each reviewable alone.
4. **Gate `AuthGate`'s authenticated render on `usersHydrated`** for persisted sessions. `AuthGate.tsx:108-119,253-272`; the spinner UI already exists in `WorkspaceGate`. Converts a deferred check into a gate.

**P2 — boot and sync hygiene (genuinely new)**

5. **Move `GlobalMonthProvider` inside `AuthGate`** (or session-gate its listing effect). `App.tsx:325-337`, `GlobalMonthProvider.tsx:48-78`. Verify no pre-login consumer of `months` first.
6. **Stop the periodic refresh tick from wholesale-clearing the append-only cache**; keep that reset for the manual admin button. `dataRefreshSignal.ts`, `directoryScan.ts:305-307`. Name-diff invalidation already covers correctness.
7. **Pause the 5-minute interval while hidden; make it admin-configurable (1/3/5 min).** `AuthGate.tsx:330-341` plus a Settings entry. Pure timer policy; manual refresh unaffected.
8. **Collapse `WorkspaceGate.tsx:476-493`'s focus/visibility-triggered `listMonthFolders`** to a single run for the admin empty-state banner. Tiny, isolated.

**P3 — requires sequencing, do not take unilaterally**

9. **Fold-time rather than render-time scoping of distribution entries for employee sessions.** `XrayReferrals.tsx:382-397`, `XrayInspectionResults.tsx:236-256`. Check against the proposal-covered "employee read path" finding before starting; Phase B would subsume it. Related to §L.
10. **Resolve the dead `loadEmployeeSampleMirror` fallback** — promote it to primary or drop it; today it loads on every employee screen mount and is used only when the full derivation returns null. `XrayReferrals.tsx:383-386`. Fits §R (dead-code cleanup).

None of these duplicate §N (code-splitting), §I (report-model cache), §K (export yielding), §O (backup concurrency), or §P (search debounce, already shipped this session). Items 6–8 are complementary to §L; items 9–10 attach to §L and §R respectively.

---

## Storage / deployment-model deviations requiring owner sign-off

**Zero found.** Every element of the reference document, as modified above, fits inside the file-based shared-folder constraint. Change detection (4.5) is achievable with `File.lastModified`/`size` probes plus the existing `JsonEnvelope` `contentHash` — no watcher, no push transport, no server. Centralized state (4.3), as reconciled, is in-memory React/module state with a population carve-out; it does not require IndexedDB as an authoritative store, which §8 of the large-population proposal already rules out.

Two things are worth recording as explicitly **not** recommended, so they are not adopted by implication. A genuine push/subscription sync model (SSE, WebSocket, DB change feed) would require a server and is unnecessary — polling with cheap change detection is adequate at this concurrency. And 4.2's "security property" cannot be delivered by any client-side change; converting it into a real guarantee would require a backend enforcing access at the storage layer. That is a deviation from the app's hard file-based/no-backend constraint and is **not** proposed here — the correct response is to restate the goal as performance and defence-in-depth, and to keep `SECURITY_MODEL.md`'s advisory-only framing intact in all downstream communication.

---

## Disposition (controller's note, added after the evaluation)

P0 (items 1-2, silent data loss) is the highest-priority finding in this whole document — a real, reachable bug, not a hypothetical one. Implementing next as its own plan. P1 (items 3-4) follows directly after, since it's a mechanical extension of already-proven, already-reviewed patterns from this session's Plan 4. P2 (items 5-8) and P3 (items 9-10, sequencing-gated) follow as time allows.
