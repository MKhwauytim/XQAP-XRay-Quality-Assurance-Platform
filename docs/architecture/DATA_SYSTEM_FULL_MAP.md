# Data System — Complete Map

*What the app stores, how it stores it, how it processes it, how it reads it, and who touches what.*

**Date:** 2026-08-07

**Method.** Re-derived directly from source in two passes by five parallel read-only agents
covering the whole `src/data/` layer, `src/workers/`, `src/auth/` (storage side), and the
data-facing parts of the Population, Report Designer, Employee Workspace, Archive, User Management,
and Settings tabs. Pass 1 mapped store/process/read per module. Pass 2 traced every artifact to its
writers and readers.

Existing documentation (`data-system-report.md`, `docs/audit/*`) was deliberately **not** used as
ground truth. Where code and docs disagree, that disagreement is recorded as a finding (Part IX).
This is why the map contains things the docs do not — an undocumented seventh workspace root, four
governance actions that log nothing, and a substantial amount of correct machinery that no UI ever
calls.

**Organizing principle:** the data lifecycle (store → process → read), not user roles or UI tabs.
Parts V, VI, and VII then index the same artifacts three other ways — by screen, by folder, and by
writer/reader — so you can enter from whichever direction matches the question you have.

**Scope.** 59 artifact sections covering every file, staging artifact, tombstone, sentinel,
browser-storage key, and IndexedDB entry the app creates or manages, plus 13 report editions that
are generated but never persisted.

---


## Contents

| Part | What it answers |
|---|---|
| **I** — Storage inventory | What exists, everywhere the app persists anything |
| **II** — Write protocols | *How* it stores — the five distinct write paths and which files use which |
| **III** — Processing pipelines | *How* it processes — Excel→population→sample→distribution→reports |
| **IV** — Read paths | *How* it reads — and where the performance story actually lives |
| **V** — UI surface cross-reference | "What does this screen touch?" |
| **VI** — File catalog | "What is this file, what's inside it, and what does it relate to?" |
| **VII** — Traceability matrix | "Who writes this, who reads it, why does it exist, what's its lifecycle?" |
| **VIII** — Findings | Four themes and 24 ranked findings |
| **IX** — Doc drift + strengths | Where the docs disagree with the code; what not to break |

---
## Part I — The complete storage inventory

### I.1 Browser storage

| Store | Key | Contents | Lifetime |
|---|---|---|---|
| `sessionStorage` | `xray_auth_session_v1` | Signed-in identity (username, role, loginAt) | Tab close; 7-day TTL as secondary guard |
| `sessionStorage` | `xray_global_month_v1` | Selected month folder name | Tab close |
| `localStorage` | `xray_custom_labels_v1` | Arabic UI label overrides | Indefinite |
| `localStorage` | `xray_last_login_username_v1` | Last username typed | Indefinite |
| IndexedDB | `xray-quality-app-persistence` → `workspace` → `last-workspace` | The `FileSystemDirectoryHandle` itself | Indefinite |
| Module variable | *(not persisted)* | Managed users, roles, permission matrix | Page reload — disk is the only persistence |

Two important corrections to the common mental model:

- **Managed users/permissions are not in `localStorage`.** `userManagement.ts:58` holds them in a
  plain module variable broadcast over a `window` CustomEvent. The only durable copy is
  `3-user-data/users.permissions.json`. A fresh load with no workspace mounted falls back to
  hardcoded defaults.
- **The directory handle itself is persisted to IndexedDB**, which is how the app silently
  reconnects across reloads. Read-only permission alone does not auto-restore —
  `WorkspaceProvider.tsx:143-154` demands `queryPermission({mode:"readwrite"}) === "granted"` or
  forces a manual reconnect gesture.

### I.2 Workspace disk — the numbered roots

```
1-population/
  config.json                  processing config, column mappings, stage aliases, sampling rules
  certscan.global.json         workspace-global CertScan reference text
  {month}/
    month.manifest.json        written LAST; monotonic status rank; CAS-protected
    1-raw/
      risk.raw.json            imported risk rows (+ `supersedes` pointer)
      bi.raw.json              imported BI rows (optional)
      risk.source.{ext}        original uploaded workbook bytes (best-effort)
      bi.source.{ext}
      *.{ISO-ts}.superseded.json   verbatim archive of prior raw import (A5)
    2-processed/
      population.final.json    the processed population
      processing.summary.json

2-samples/{month}/
  1-main/
    sample.master.json         drawn rows + allocations + seed + algorithm version
    sampling-proof.json        audit/proof doc written at draw time
    sampling.plan.json         documented sampling plan (A1) + prior-month advisory (B4)
    distribution.events/{eventId}.json    ← AUTHORITATIVE, immutable, write-once
    distribution.log.json      legacy compatibility projection
    distribution.current.json  rebuildable derived cache
    main.samples.json          mirror of all assigned entries
  2-employees/
    {username}.samples.json    per-employee mirror
    {username}.answers.json    answers + referral/replacement/reopen request queues
  3-approvals/
    {supervisor}.decisions.json    hash-chained decision events (B5)

3-user-data/
  users.permissions.json       ← the only durable copy of users/roles/permissions
  labels.snapshot.json         best-effort label mirror, written only at backup time

4-reports/designs/
  designs.index.json           CAS-protected index
  {reportId}.json              ReportDocument (canvas pages/elements)

5-system/
  workspace.schema.json        layout kind (current/legacy/mixed), migration marker
  restore.inprogress.json      sentinel; left behind if a restore is interrupted
  audit/
    actions.log.json           live governance log, capped 10,000, CAS-protected
    actions.archive.{year}.json    hash-chained per-year archive
    activity.log.json          sign-in / working-hours log
  backups/
    auto-backup-settings.json  frequency; CAS-exempt by design ("last admin wins")
    auto-backup-state.json     pointer; CAS-exempt by design
    {timestamp-mode}/
      backup.manifest.json
      backup.complete.json     written last — see Finding 9
      json/**/*.json           full mirror
      xlsx/*.xlsx              opt-in, explicitly NOT restorable
  notifications/notifications.json    capped 500, CAS-protected
  user-presets/
    {username}.browse-preset.json      ← no CAS (Finding 8)
    admin-shared.browse-preset.json    CAS-protected
  powerbi-export/{month}/
    population.csv  sample.csv  README.txt

6-templates/
  templates.index.json  {templateId}.json  template.selection.json
  {templateId}.deleted.bak.json    tombstone on delete
  deck2.style-choices.json

feedback/                     ← 7th, UNDOCUMENTED top-level root (Finding 6)
  messages.json
```

Legacy unnumbered roots (`Population/`, `.system/`, `templates/`) remain readable but are never
written.

---

## Part II — How it stores: five distinct write protocols

The app does not have one write path. It has five, assigned per file by stakes and sharing model.

### Protocol A — `safeWriteJson` staging (the default)
`src/data/storage/safeWrite.ts:273-452`

Read current → snapshot to `.bak` → write `.tmp` → verify `.tmp` → write live → verify live →
delete `.tmp`. On live-verify failure: restore from `.bak`, or if no usable `.bak`, promote the
verified `.tmp` (never silently drops data). Wrapped in a permission re-check and a per-file
exclusive lock.

Two sub-paths worth knowing:
- Files ≤512KB are pretty-printed and parse-verified.
- Larger files skip pretty-printing and byte-compare instead of re-parsing.
- If `JSON.stringify` throws `RangeError` (V8 string ceiling), a **fully streamed writer** takes
  over, hashing and writing in ~64KB chunks so the whole string is never materialized.

### Protocol B — `casLoop` compare-and-swap (shared, multi-writer files)
`src/data/storage/casLoop.ts`

Each attempt embeds a fresh `crypto.randomUUID()` write token → write → immediate read-back check
of revision+token → **optional** delayed re-read after an 80–180ms jittered settle window, to catch
the A-read/B-read/A-commit/B-commit lost-update interleaving. Up to 10 retries with jittered
exponential backoff. Permission loss (`NotAllowedError`/`SecurityError`/`NoModificationAllowedError`,
classified by `error.name` not message text) is terminal — it aborts immediately so the UI can
prompt a reconnect rather than reporting a generic write conflict.

Only the highest-stakes caller (`actionLog.ts:273`) actually supplies the delayed `verify` callback.

### Protocol C — Write-once immutable event files
`src/data/distribution/distributionEventStore.ts:41`

Reads back any existing file first: identical content is a no-op, differing content throws an
"id collision". Verified by re-read after write. Unique event ids mean independent writers target
different files — this is what makes distribution safe across devices without a backend.

### Protocol D — Plain writes (one-shot artifacts)
PowerBI CSVs, backup snapshot contents, backup sentinels. No CAS, because there is no concurrent
writer to race against — each backup is a brand-new folder.

### Protocol E — Browser storage
Synchronous, try/catch-wrapped, no verification.

### Locking
`webLocks.ts:16-41` uses the real Web Locks API when available and falls back to an in-module
promise chain otherwise. **The fallback only serializes within the current tab** — the cross-tab
guarantee silently degrades. In practice Chromium always has Web Locks, and Chromium is the only
fully supported browser.

---

## Part III — How it processes

### Pipeline 1: Excel → processed population

**Phase 1 — parse (Web Worker, `src/workers/workbookWorker.ts`)**

1. `XLSX.read` with `cellDates`/`cellNF`/`cellStyles`/`cellHTML`/`WTF` all disabled for parse speed.
2. Per sheet, classify by name pattern after normalizing Arabic diacritics/hamza/taa-marbuta.
   An unrecognized sheet name falls back to using the raw name — **no sheet is ever silently dropped**.
3. `delete workbook.Sheets[sheetName]` immediately after extraction, so processed sheets' raw cell
   objects can be GC'd before the next sheet parses.
4. Row normalization in chunks (risk 5000, BI 10000) with `yieldToMain()` between chunks.
5. Rows with a blank `xrayImageId` are filtered out and counted.

BI failure is **soft** — caught, converted to a warning, risk result returned anyway.

**Phase 2 — process (MAIN THREAD, `populationProcessor.ts:651-920`)**

Called directly from `Population/index.tsx:782`. Steps, each chunked with `setTimeout(0)` yields:

1. CertScan paste parsed into per-port snippet sets.
2. X-ray ID validation (rejects blanks, sentinels, `RMI`/`XRA` prefixes, <4 chars) — chunk 1000.
3. Deduplication via a `Set` of uppercased ids, first-occurrence-wins — chunk 1000.
4. Per-row transform — chunk 500, the heaviest step:
   - Hand-rolled multi-format date parser per date field (ISO, Excel serial, `DD/MM/YYYY`,
     `DD-Mmm-YYYY`, Arabic month names).
   - BI enrichment via O(1) map lookup on `(xrayImageId, portName)`; fills blank risk fields from
     the matched BI row. Hijri date fields are deliberately excluded from the Gregorian date pass.
   - Result normalization to the closed set `سليمة | اشتباه | null`. **Rows where either level
     fails to normalize are dropped from the population**, surfaced only as a summary count.
   - CertScan match: per row, substring containment against every snippet of every entry at that
     port. This is the one step whose per-row cost scales with a second input's size.
5. Summary aggregation.

**The architectural fact:** Phase 1 is off-thread, Phase 2 — the heavier half — is not.

### Pipeline 2: population → sample

`sampleAlgorithm.ts` dispatches on config shape to a legacy or stage-based path.

- RNG is Mulberry32 seeded by a djb2 hash of the string seed — fully deterministic.
- **Legacy path:** group by port → Hamilton apportionment across ports → nested Hamilton for the
  CertScan/NonCertScan split → Fisher-Yates draw per tier → spillover re-apportions any shortfall
  across ports that still have undrawn rows.
- **Stage path:** bucket by stage key (1st–4th المستوى) → `redistributeStageShortfall` reallocates
  a stage's shortfall across second/third/fourth proportional to configured weight in two passes →
  each stage then runs its own port-level Hamilton + split + spillover.

**Determinism guarantees.** `SAMPLING_ALGORITHM_VERSION` is stamped onto every draw alongside the
seed. Hamilton tie-breaks deliberately avoid `localeCompare` (`apportionment.ts:51-58`), using raw
UTF-16 comparison so Arabic port-name ties resolve identically across machines and runtimes — a
well-reasoned, easily-missed determinism guard. Note that the stage path threads **one** RNG
instance through all stages in `STAGE_KEYS` order, so stage order is itself baked into
reproducibility, not just the seed.

### Pipeline 3: sample → distribution → answers

**The fold** (`distributionDerivation.ts:111-158`) walks events in timestamp order building a
`Map<xrayImageId, DistributionEntry>`:
- Once `replaced`, only another `replaced` is accepted. Once `completed`, `assigned`/`reassigned`
  are rejected — but `reopened` is allowed and transitions back to pending.
- Events with a schema version newer than supported are dropped, so an older client never
  mis-folds a newer event shape.
- Every dropped event is recorded and surfaced as **one aggregated log call per derivation**, to
  avoid flooding the 50-entry error ring buffer.

**Cache freshness** (`loadOrDeriveDistributionCurrent`) requires *all* of: matching `deriveVersion`,
matching `logRevision`, matching `eventSetId`, and per-employee quota presence. Otherwise it
re-derives from the full folded log.

**The approval flow** (`approveReferral.ts`) is the most defensive code in the app — worth reading
as the reference pattern: reload fresh state, replay-guard against already-persisted events,
ownership-check against a **freshly derived** state (explicitly bypassing the cache, with an inline
comment explaining the cache "can be stale even when its revision metadata happens to match, for
example after a restored or manually copied workspace"), append, re-verify from a fresh reload,
cross-reviewer guard, then first-wins reconciliation. `effectiveDecision` is deliberately
**first-wins by `reviewedAt`**, not last-write-wins, so concurrent supervisors converge
deterministically.

### Pipeline 4: everything → reports

`buildExecutiveReportRows` + `calculateExecutiveKPIs` (`executiveReportData.ts`) is **genuinely the
single source of image-level rows**. Confirmed consumers: PowerBI export, the Report Designer's KPI
cards, the designer's field catalog, and — via `buildReportModel()` — all six executive-family
editions (deck v1, deck2, document, workbook, managementDeck, managementWorkbook, managementReport).

`ReportModel` is built once per generation and handed to every renderer; renderers display, they
never recompute. **The deck, document, workbook, and both management editions cannot disagree on
their numbers.** This is the strongest architectural property in the reporting layer and should be
preserved by any rework.

---

## Part IV — How it reads

The app has genuinely **mixed read postures** — this is the core performance story.

| Path | Posture | Where |
|---|---|---|
| Single-month Browse | Worker-owned, paged, raw-text handoff | Best-in-class |
| Employee landing | Scoped — loads only that employee's small files | Phase A shipped |
| Month editing | Scoped via `MonthLoadScope`; skips raw files once processed | Optimized |
| **All-months Browse** | Full main-thread `JSON.parse` of every month, uncached | Finding 2 |
| **Population processing** | Main thread | Finding 1 |
| **Designer KPI cards** | N× full reload per tile, no yielding | Finding 3 |
| **`buildReportModel()`** | One synchronous non-yielding block | Finding 5 |
| Sample/distribution reports | Chunk-and-yield throughout | Well-behaved |
| PowerBI export | Single load, single build, two projections | Efficient |

**The worker-owned Browse path** (Phase B) is worth understanding as the target pattern:
`loadMonthPopulationFinalRawText` deliberately bypasses `safeReadJson` to avoid its main-thread
`JSON.parse`, reading raw text with its own live→`.bak`→`.tmp` fallback ladder, and hands that text
to a **long-lived** `PopulationQueryWorker` that parses once and answers search/filter/sort/paginate
queries from worker-local cache. Staleness is guarded by lane-scoped request tracking plus a
separate load id — a design that replaced an earlier single-counter version after two documented
critical bugs.

Its one documented gap: a present-but-corrupt live file is **not** repaired by falling back to
`.bak` here, because detecting corruption requires the parse that is being avoided. The corrupt
text reaches the worker and surfaces as a worker error instead.

**Periodic refresh.** `useMonthLoad.ts` subscribes to a ~3-minute data-refresh tick that re-reads
and re-parses the whole scoped payload for the open month. This is legitimate multi-device sync,
but there is **no revision-based short-circuit** — it re-reads on every tick whether or not
anything changed on disk. The only guard prevents *overlapping* reads, not *unnecessary* ones.

**Two-tier read API.** `loadDistributionLogForRead` / `loadOrDeriveDistributionCurrentForRead` are
deduplicated cached variants carrying an explicit comment: *"Never use this for a
fresh-read-before-write correctness check."* The authoritative variants have no suffix. The
distinction is enforced by naming convention and comments only — **not by types**.

---

## Part V — UI surface cross-reference index

Enter from "what does this screen touch?" Each entry points into the per-artifact sections in
Part VI. An artifact appears under every surface that writes it.

### Population tab (`src/components/Sidebar/Tabs/Population/`)

The heaviest writer in the app. Its four phases each own different artifacts.

| Phase / control | Artifacts written |
|---|---|
| Phase 1 — Excel import | `risk.raw.json`, `bi.raw.json`, `risk.source.{ext}`, `bi.source.{ext}`, `*.superseded.json` archives, `month.manifest.json` (status → `raw-saved`) |
| Phase 1 — CertScan paste | `1-population/certscan.global.json` |
| Phase 2 — "معالجة" (process) | `population.final.json`, `processing.summary.json`, `month.manifest.json` (status advance), replacement-index manifest + bucket files |
| Phase 3 — "سحب العينة" (draw) | `sample.master.json`, `sampling-proof.json`, `sampling.plan.json` |
| Phase 4 — distribution | `distribution.events/{eventId}.json`, `distribution.log.json`, `distribution.current.json`, `main.samples.json`, per-employee `{username}.samples.json` |
| Browse sub-tab — column/preset changes | `{username}.browse-preset.json`, `admin-shared.browse-preset.json` |
| Config / mapping editors | `1-population/config.json` |

### Employee Workspace (`Tabs/EmployeeWorkspace/`)

| Sub-tab / action | Artifacts written |
|---|---|
| `ew/xray-referrals` — answer save/submit | `{username}.answers.json` (items + `valueHistory`) |
| `ew/xray-referrals` — request referral/replacement | `{username}.answers.json` (request queues) |
| `ew/referral-approval` — supervisor decision | `{supervisor}.decisions.json`, plus `distribution.events/` reassignment events |
| `ew/inspection-form` (TemplateBuilder) | `{templateId}.json`, `templates.index.json`, `template.selection.json`, `{templateId}.deleted.bak.json` |
| Reopen an answer | `{username}.answers.json`, `distribution.events/` reopen event |

### Reports tab (`Tabs/Reports/`)

| Sub-tab / action | Artifacts written |
|---|---|
| `reports` — generate any edition | **Nothing on disk.** 13 report editions open in a new tab or download via Blob (Part VI, section B) |
| `reports` — PowerBI export | `5-system/powerbi-export/{month}/population.csv`, `sample.csv`, `README.txt` |
| `report-designer` — save design | `{reportId}.json`, `designs.index.json` |
| deck2 style-variant selection (admin) | `6-templates/deck2.style-choices.json` |

### Archive tab (`Tabs/Archive/`)

| Action | Artifacts written |
|---|---|
| Manual backup | `backup.manifest.json`, `backup.complete.json`, `json/**/*.json` mirror, opt-in `xlsx/*.xlsx`, `labels.snapshot.json` |
| Restore | `restore.inprogress.json` sentinel, a pre-restore rollback backup, then every file in the snapshot |
| Auto-backup settings | `auto-backup-settings.json` |
| Month close / reopen | `month.manifest.json`, `actions.log.json` |

### User Management tab (`Tabs/UserManagement/`) — admin only

| Sub-tab / action | Artifacts written | Audit trail? |
|---|---|---|
| `users` — add user | `users.permissions.json` | **No** — see Finding 1 |
| `users` — delete user | `users.permissions.json`, `actions.log.json` | Yes |
| `page-permissions` — edit matrix | `users.permissions.json` | **No** — see Finding 1 |
| `feature-permissions` — edit matrix | `users.permissions.json` | **No** — see Finding 1 |
| `activity` — view only | *(reads `activity.log.json`)* | — |
| `actions` — view only | *(reads `actions.log.json`)* | — |

### Settings tab (`Tabs/Settings/`)

| Action | Artifacts written |
|---|---|
| Edit any Arabic label | `localStorage["xray_custom_labels_v1"]`, plus `labels.snapshot.json` when a workspace is connected |

### Notification Center (`ew/notifications`)

| Action | Artifacts written |
|---|---|
| Post a notification (admin/manager) | `5-system/notifications/notifications.json` |
| Acknowledge a notification | same file (acceptance record) |

### App-level / no direct user action

| Trigger | Artifacts written |
|---|---|
| Workspace first connect / structure creation | `workspace.manifest.json`, `users.permissions.json`, folder tree |
| Workspace connect / reconnect | IndexedDB `last-workspace` handle |
| Login success | `sessionStorage["xray_auth_session_v1"]`, `localStorage["xray_last_login_username_v1"]`, `activity.log.json` |
| Session heartbeat / sign-out | `activity.log.json` |
| Global month selector | `sessionStorage["xray_global_month_v1"]` |
| Daily auto-backup (when due) | full backup set + `auto-backup-state.json`, prunes to 30 |
| Any `safeWriteJson` call | `.bak` snapshot + `.tmp` staging file for that path |
| First-run dismissal | `localStorage["xray_firstrun_dismissed_v1:{workspaceKey}"]` |
| FeedbackWidget submit | `feedback/messages.json` *(workspace root — undocumented 7th root)* |
| Layout migration | `workspace.schema.json` — **but `migrateWorkspaceSchema` has no UI caller at all** |

### Surfaces that write nothing

`ChangeLog` tab (renders the build-time virtual module), and the `reports` sub-tab's report
generation itself — every edition is ephemeral.

---
## Part VI — File catalog: hierarchy, contents, and relationships

Every file the app creates or manages, organized by parent. Each entry gives: **what it is**
(a one-line description), **contents** (what data it actually holds), and **links** (which other
artifacts it relates to, and through which key).

### VI.0 The join keys

Six keys tie the whole workspace together. Every cross-file relationship below is one of these.

| Key | Ties together | Notes |
|---|---|---|
| `monthFolderName` | Everything month-scoped, across all roots | Format `{month}-{MonthName-en}-{year}`, e.g. `5-May-2026`. The top-level partition of all business data |
| `xrayImageId` | population → sample → distribution → answers → approvals | **The spine of the app.** One X-ray image's journey from imported row to reviewed decision. `orphanScan.ts` validates this chain end to end |
| `username` | employee mirrors, answers, decisions, presets, audit entries | Filename-embedded, sanitized via `safeUserFileName` |
| `templateId` | template file ↔ index ↔ selection ↔ each answer item | Answer items store `templateId` + `templateVersion` so an answer stays interpretable after the template changes |
| `reportId` | design file ↔ design index | Report Designer only |
| `eventId` | one immutable distribution event file | Unique per event so independent writers never target the same file |

Two more are internal rather than relational: `revision` + `_writeToken` (CAS conflict detection)
and `contentHash` (envelope integrity).

---

### VI.1 `1-population/` — imported and processed source data

**Parent:** workspace root. **Holds:** everything about *what X-rays exist*, before any sampling.

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `config.json` | Workspace-wide processing configuration | System/custom field definitions, column-mapping templates, stage alias mappings, processing workflow presets, export templates, sampling rules, per-employee stage allocations | Not month-scoped. Consumed by every import and by the sampling draw |
| `certscan.global.json` | Global CertScan reference text | The last-pasted CertScan table, as raw text | Shared across all months; feeds `certScanStatus` on every processed row |
| `{month}/` | One month's complete run | *(container)* | Keyed by `monthFolderName` |

#### `1-population/{month}/`

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `month.manifest.json` | The month's status record and summary counts | Month/year, processed counts, monotonic status rank, operator info | **Written last**, because its totals depend on every other file in the month. Status gates what `loadMonthForEditing` bothers to read |
| `1-raw/` | Untouched imports | *(container)* | — |
| `2-processed/` | Derived population | *(container)* | — |

#### `1-population/{month}/1-raw/` — the source of truth layer

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `risk.raw.json` | Imported risk rows, unmodified | Every parsed row from the risk workbook, plus a `supersedes` pointer | Parent of `population.final.json`. Rows carry `xrayImageId` |
| `bi.raw.json` | Imported BI rows, unmodified (optional) | Every parsed BI row | Joined to risk rows on `(xrayImageId, portName)` during enrichment |
| `risk.source.{ext}` / `bi.source.{ext}` | The original uploaded workbook bytes | Verbatim binary copy of the Excel file | **No reader** — pure provenance |
| `{base}.raw.{ISO-ts}.superseded.json` | Archive of a prior import, before re-import overwrote it | Verbatim copy of the previous `risk.raw.json`/`bi.raw.json` | Pointed to by the *new* file's `supersedes` field. **No reader** — the chain is walkable by hand only |

#### `1-population/{month}/2-processed/` — the derived layer

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `population.final.json` | **The processed population** — the app's central dataset | One row per valid, deduplicated X-ray image: identity, port, dates, L1/L2 results, CertScan status, BI enrichment status and filled fields, optional `rawRow` for traceability, source sheet/row | Derived from `1-raw/` + `config.json` + `certscan.global.json`. Parent of `sample.master.json`. Every row keyed by `xrayImageId` |
| `processing.summary.json` | What happened during processing | Counts and percentages: excluded, deduplicated, BI-matched, invalid-result rows removed | Sibling summary; read instead of the population when only totals are needed (a real perf optimization) |
| `replacement-index/index.manifest.json` + bucket files | Lookup acceleration for replacement candidates | Up to 10 bucket files of candidate rows | Derived from `population.final.json`; rebuilt best-effort, non-fatal on failure |

---

### VI.2 `2-samples/` — the drawn sample and its distribution

**Parent:** workspace root. **Holds:** everything about *which X-rays were selected, who was
assigned them, and what they answered*.

#### `2-samples/{month}/1-main/`

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `sample.master.json` | **The drawn sample** | Sampling metadata (`rngSeed`, `samplingAlgorithmVersion`, requested/actual totals, CertScan split), `portAllocations[]`, `stageAllocations[]`, drawn-at/by, and `rows[]` — full copies of the selected population rows | **Child of** `population.final.json` (rows are copied, not referenced). **Parent of** the distribution chain |
| `sampling-proof.json` | Audit/proof document for the draw | Month/year, drawn-at/by, seed, sampling rules, port allocations, requested vs actual totals | Written beside the sample at draw time. **No reader** |
| `sampling.plan.json` | The documented sampling *plan* (A1) | Lot definition, target fraction, quality/inspection-level notes, risk-basis share, seed + algorithm version, plus optional prior-month advisory (B4) | `loadSamplingPlan` exists but has **no production caller** |
| `distribution.events/{eventId}.json` | **One immutable assignment event** — the authoritative record | A single event: type, `xrayImageId`, `assignedTo`, replacement/reassignment targets, timestamp, actor, quota context | **The source of truth for distribution.** Write-once; folding these produces current state |
| `distribution.log.json` | Legacy compatibility projection of the event set | `events[]` plus `revision`, `_writeToken`, `eventSetId` | **Derived** from the event files; written after they're durable. Read only through the merge-aware loader |
| `distribution.current.json` | Rebuildable cache of folded state | Per-image `entries[]` with status, per-employee `quotas`, plus `deriveVersion`/`logRevision`/`eventSetId` for freshness validation | **Derived.** Discarded and rebuilt whenever any freshness field mismatches |
| `main.samples.json` | Whole-month mirror of assigned entries | Copy of `current.entries` + `sourceLogRevision` | **Derived. Zero readers** |
| `approvals/{supervisor}.decisions.json` | One supervisor's referral/replacement decisions | `decisionEvents[]`, each carrying an optional `previousDecisionHash` forming a tamper-**evident** chain | Keyed by `username`. Decisions reference requests living in employees' answer files |

#### `2-samples/{month}/2-employees/`

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `{username}.samples.json` | One employee's slice of the assignment mirror | Their `entries[]` + `sourceLogRevision` | **Derived** from `distribution.current.json`. Used as a *fallback* when derivation returns null — never as primary |
| `{username}.answers.json` | **One employee's QC work for the month** | `items[]` (per `xrayImageId`: `templateId`, `templateVersion`, `answers`, `valueHistory` capped at 20, timestamps, status), plus `referralRequests[]`, `replacementRequests[]`, `reopenRequests[]` | Keyed by `username` + `xrayImageId`. **Sole-writer file** — that's why the request queues live here despite being cross-cutting workflow objects |

---

### VI.3 `3-user-data/` — identity and permissions

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `users.permissions.json` | **The only durable copy of who exists and what they can do** | Managed users, Argon2id/PBKDF2 password hashes, roles, tab-permission matrix, feature-permission matrix | Consumed at login and on every permission check. In-memory state is rebuilt from this; with no workspace mounted, defaults apply |
| `labels.snapshot.json` | Backup mirror of the Arabic label overrides | Copy of `localStorage["xray_custom_labels_v1"]` | Exists because the live copy is browser-only and would otherwise be uncapturable by a workspace backup. Restored only as an explicit opt-in step |

---

### VI.4 `4-reports/designs/` — Report Designer documents

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `designs.index.json` | List of saved designs | Per design: `reportId`, `reportName`, `version`, `updatedAt` | Points at `{reportId}.json` via `reportId`. No orphan reconciliation |
| `{reportId}.json` | One canvas report document | Theme, pages, and every element (text, shape, image, kpi — and inert `table`/`chart` placeholders) | Child of the index. Deleting overwrites in place with **no snapshot** |

> Generated reports are **not** stored here. All 13 editions open in a new tab or download via
> Blob — see Part VII section B.

---

### VI.5 `5-system/` — operational and governance state

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `workspace.schema.json` | Layout-migration marker | Detected layout kind (`current`/`legacy`/`mixed`), schema version, migration actor/time, verified backup id, whether legacy readers are still needed | Written only by a migration that **has no UI caller** |
| `restore.inprogress.json` | Sentinel marking a restore in flight | Written before the destructive walk, removed only on full success | **Never read.** Its detection purpose is inert |

#### `5-system/audit/`

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `actions.log.json` | Live governance action log | Up to 10,000 entries: month close/reopen, user deletion, referral/replacement/reopen decisions, bulk assignment, sample draw, answer reopen | **6 of 15 declared action types actually fire** — see Finding 1 |
| `actions.archive.{year}.json` | Per-year archive of evicted entries | Overflow entries plus `previousArchiveHash` chaining to the prior year | Archived **before** the live log trims — a real "never dropped unarchived" invariant. Chain is never verified |
| `activity.log.json` | Sign-in / working-hours log | Per session: username, role, signed-in/last-seen/signed-out, duration, close reason | Capped at 5,000, drops silently with no archive |

#### `5-system/backups/`

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `auto-backup-settings.json` | Automatic-backup frequency | Admin-set cadence | Deliberately CAS-exempt ("last admin wins") |
| `auto-backup-state.json` | When the last automatic backup ran | Timestamp pointer | Deliberately CAS-exempt |
| `{timestamp-mode}/backup.manifest.json` | One snapshot's identity | Created-at, mode (manual/automatic/pre-restore), file inventory | The **only** thing `loadBackupHistory` reads. A folder without a readable manifest is invisible to both history and pruning |
| `{timestamp-mode}/backup.complete.json` | Completion sentinel | Written last, to mark the snapshot fully written | **Never read.** Interrupted-backup detection is inert |
| `{timestamp-mode}/json/**/*.json` | The restorable snapshot | Full mirror of every `.json` in the workspace tree | Generic walk — catches `feedback/` by accident, not by design |
| `{timestamp-mode}/xlsx/*.xlsx` | Convenience spreadsheets | Opt-in, capped at 100,000 rows per dataset | **Explicitly not restorable** |

#### `5-system/` — remaining

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `notifications/notifications.json` | Workspace broadcast feed | Up to 500 notifications, each with id, message, postedBy/At, and per-recipient `acceptances[]` | Overflow dropped silently, no archive |
| `user-presets/{username}.browse-preset.json` | One user's table column preferences | Column visibility, order, widths | Single-writer carve-out — no CAS, deliberately and documentedly |
| `user-presets/admin-shared.browse-preset.json` | Shared admin table preferences | Same shape | CAS-protected (genuinely multi-writer) |
| `powerbi-export/{month}/population.csv` | All executive rows for external BI | 26 columns, UTF-8 BOM, formula-injection escaped | Derived from `buildExecutiveReportRows`. Write-only by design |
| `powerbi-export/{month}/sample.csv` | The `selectedInSample=true` subset | Same columns | Same build, filtered projection |
| `powerbi-export/{month}/README.txt` | Bilingual connection instructions | Arabic + English Power BI Desktop steps | For humans only |

---

### VI.6 `6-templates/` — inspection templates

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `templates.index.json` | List of templates and latest versions | Per template: id, name, version | Points at `{templateId}.json`. No orphan reconciliation |
| `{templateId}.json` | One inspection template schema | Phases, fields, types, required flags, conditional visibility rules | Referenced by every answer item's `templateId` + `templateVersion` |
| `template.selection.json` | Which template is currently active | A single `templateId` pointer | Cleared automatically if the selected template is deleted. **Not read by `KpiRenderer`** — Finding 2 |
| `{templateId}.deleted.bak.json` | Tombstone of a deleted template | Full body snapshot, taken before removal | **No reader** — recovery means renaming by hand |
| `deck2.style-choices.json` | Per-slide design-variant choice for the executive deck | Slide → variant index (0–3) | Global, not month-scoped. App-layer last-write-wins |

---

### VI.7 `feedback/` — the undocumented 7th root

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `messages.json` | User feedback and replies | Message list with replies | **Should be under `5-system/`.** `feedbackStorage.ts` bypasses `getSystemRoot()`. Backed up only because the backup walk is path-agnostic |

---

### VI.8 Staging artifacts — created beside *every* managed JSON file

| Artifact | What it is | Contents | Links |
|---|---|---|---|
| `{file}.bak` | Previous good version | Snapshot taken before each write | Recovery rung 2 on read |
| `{file}.tmp` | Staged write, pre-commit | The new content, verified before promotion | Recovery rung 3 — **but only `safeReadJson` checks it**; `readJsonFile` does not, so the two most safety-critical files lack this rung |

---

### VI.9 Browser-resident state (no file on disk)

| Artifact | What it is | Contents | Lost when |
|---|---|---|---|
| `sessionStorage["xray_auth_session_v1"]` | Current session | Username, role, loginAt | Tab close; 7-day TTL |
| `sessionStorage["xray_global_month_v1"]` | Selected month | Folder name only | Tab close |
| `localStorage["xray_custom_labels_v1"]` | **Live** Arabic label overrides | Key → override text | Corruption silently resets all of it |
| `localStorage["xray_last_login_username_v1"]` | Login prefill | Last username typed | — |
| `localStorage["xray_firstrun_dismissed_v1:{key}"]` | First-run notice dismissal | Boolean flag | Never cleaned up — accumulates forever |
| IndexedDB `last-workspace` | The directory handle itself | A `FileSystemDirectoryHandle` | How the app reconnects across reloads |
| *(module variable)* | Users, roles, permission matrices | Rebuilt from `users.permissions.json` | **Every page load** — disk is the only persistence |

---

### VI.10 The relationship map, end to end

```
config.json ─┐
certscan.global.json ─┤
             ├──► population.final.json ──► sample.master.json ──► distribution.events/*.json
risk.raw.json ┤         (xrayImageId)          (rows copied)            (xrayImageId, eventId)
bi.raw.json ──┘                │                                              │
                               │                                    ┌─────────┴──────────┐
                               │                                    ▼                    ▼
                               │                        distribution.log.json   distribution.current.json
                               │                          (projection)               (cache)
                               │                                                        │
                               ▼                                          ┌─────────────┴────────────┐
                    processing.summary.json                               ▼                          ▼
                                                                 main.samples.json      {username}.samples.json
                                                                   (no readers)              (fallback only)
                                                                                                    │
{templateId}.json ──► template.selection.json                                                       ▼
        │                                                                            {username}.answers.json
        └────────────────────(templateId + templateVersion)─────────────────────────►   (xrayImageId)
                                                                                                    │
                                                                                        (referral requests)
                                                                                                    ▼
                                                                                   {supervisor}.decisions.json
                                                                                                    │
                                                                              (approval → reassignment event)
                                                                                                    │
                                                                                                    └──► back to distribution.events/
```

Everything above feeds `buildExecutiveReportRows`, which is the single input to PowerBI CSVs, the
Report Designer's KPI tiles, and all six executive report editions.

**Reading the arrows:** solid descent means "derived from and reproducible." `population.final.json`
can be rebuilt from `1-raw/` + config. `distribution.log.json`, `distribution.current.json`, and
both mirrors can be rebuilt from the event files. What **cannot** be rebuilt from anything else:
the raw imports, `sample.master.json` (the draw consumed RNG state), the event files themselves,
answer files, and decision files. Those five are the irreplaceable data.

---
## Part VII — Traceability matrix, by artifact

For every artifact: the UI entry point that causes it to be written, the full writer call chain,
every reader and which screen consumes it, why it exists, and its lifecycle including
missing/corrupt behavior. Grouped by the five audit clusters.

Cross-reference: Part V indexes these by UI surface; Part VI by parent folder and relationship.

### Cluster 1 — Full Traceability Matrix (persistence foundation)

Scope: `src/data/storage/`, `src/data/workspace/`, `src/auth/` (browser-storage side).
READ-ONLY audit. Every claim below is grounded in code actually read; file:line citations throughout.

---

#### 1. `{workspaceRoot}/5-system/workspace.manifest.json`

**Artifact.** Envelope-wrapped file at the workspace's system root (`WORKSPACE_FILE_NAMES.manifest = "workspace.manifest.json"`, `src/data/workspace/workspaceDefaults.ts:20`), written into the handle returned by `getSystemRoot` (`src/data/storage/fileSystemAccess.ts:314-317,340-344`).

**UI entry point.** Written exactly once per workspace, as part of first-time structure creation:
- **Admin, `WorkspaceGate.tsx`'s "missing_structure" screen → `wsgate_create_structure_btn` button** (`src/data/workspace/WorkspaceGate.tsx:304-311`) → `createInitialStructure(session.username)`.
- Also implicitly via **`WorkspacePicker`'s hidden Alt+A+T / Alt+ش+ف demo-passcode entry → `enterDemoWorkspace`** (`WorkspaceGate.tsx:88-97`), which builds an in-memory demo workspace through the same code path (`demoWorkspace.ts:36-38`).
There is no "edit workspace name" or "repair manifest" UI anywhere — once written it is never rewritten by any user action found in this cluster.

**Writer function(s).** `createInitialStructure` (`src/data/workspace/WorkspaceProvider.tsx:272-311`) → `createWorkspaceStructure` (`src/data/storage/fileSystemAccess.ts:292-356`) → `writeJsonFile` (fileSystemAccess.ts:340-344) → `safeWriteJson` (`src/data/storage/safeWrite.ts:273`). The envelope itself is built by `createDefaultWorkspaceManifest` (`src/data/workspace/workspaceDefaults.ts:100-126`) → `createEnvelope`/`createMetadata` (workspaceDefaults.ts:71-98), then re-stamped by `prepareFileForWrite` (fileSystemAccess.ts:497-522) which recomputes `contentHash` via SHA-256 (`hashText`, fileSystemAccess.ts:524-535) over a sorted-key `stableStringify` (fileSystemAccess.ts:548-563).

**Reader function(s).** Only `checkWorkspaceStructure` reads it (`fileSystemAccess.ts:208-231`), and only to confirm the file parses as a `JsonEnvelope` and that `metadata.schemaVersion === WORKSPACE_SCHEMA_VERSION` (fileSystemAccess.ts:227) — the result feeds the `ready`/`invalid_structure` workspace-gate decision. **Its `.data` payload (`workspaceId`, `workspaceName`, `files` path map) is never read by anything.** `loadWorkspaceFiles` explicitly hardcodes `manifest: null` in its return (fileSystemAccess.ts:285) with a comment stating nothing ever consumed it (confirmed independently by the comment at `WorkspaceContext.ts:55-62`, which says the same about `sampleMaster`/`sampleDistribution`). No UI surface displays `workspaceName` or `workspaceId` anywhere in the searched tree.

**Why it exists.** Nominally: identifies the workspace (name/id) and records where its key files live, and its presence + valid schema is used as one of the required-file gates for "is this workspace correctly structured." In practice, only that gate function matters — the file exists today almost entirely to be checked for existing, not for its content.

**Lifecycle.** Created once, at workspace-structure creation (fresh workspace or demo workspace). Never updated after creation (no writer touches it again). Never deleted by this cluster. If missing → `checkWorkspaceStructure` reports it in `missingItems`, workspace status becomes `missing_structure` (blocks entry for non-admins, offers "create structure" for admins — `WorkspaceGate.tsx:286-319`). If present but schema-invalid → `invalid_structure`, offering a "repair" button that just re-runs `createWorkspaceStructure` (i.e. re-creates the manifest, discarding whatever might have been in the old one — but since nothing reads the old data, this is harmless).

---

#### 2. `{workspaceRoot}/3-user-data/users.permissions.json`

**Artifact.** Envelope-wrapped file at the workspace's user-data root (`WORKSPACE_FILE_NAMES.usersPermissions`, `workspaceDefaults.ts:21`), the single source of truth for managed users, roles, page permissions, and feature permissions (`workspaceTypes.ts:120-127`).

**UI entry point (writes).** Three distinct triggers:
1. **First-time creation**: same `createInitialStructure` flow as the manifest (`WorkspaceGate.tsx:304-311` → `createWorkspaceStructure`), seeded with `createDefaultUsersPermissions` (`workspaceDefaults.ts:128-155`, itself built from `createEmptyUserManagementState()` in `userManagement.ts:477-483`).
2. **User Management tab → any user/role/permission edit → autosave**: `src/components/Sidebar/Tabs/UserManagement/TabView.tsx:263-277` (`saveUsersToDisk`, called from a debounced/direct `void saveUsersToDisk(next)` at TabView.tsx:275) is wired to every mutation handler in that tab (add/edit/deactivate user, `handleSaveIdentity` at TabView.tsx:378, page-permission toggles, feature-permission toggles) — all funnel through `writeUserManagementState` (in-memory) and this disk-sync callback.
3. **Background, no direct user action — login-time password-hash upgrade**: `loginAsEmployee` in `AuthGate.tsx:452-524`, specifically the legacy→Argon2id rehash branch (`AuthGate.tsx:497-510`) fires `syncUserManagementToDisk` fire-and-forget after a successful login with a legacy hash, so the upgraded hash is durably saved without any explicit save action by the user.

**Writer function(s).**
- Path 1: `createInitialStructure` (WorkspaceProvider.tsx:284) → `createWorkspaceStructure` (fileSystemAccess.ts:292) → `writeJsonFile` (fileSystemAccess.ts:346-350) → `safeWriteJson`.
- Paths 2 & 3: `saveUsersToDisk`/rehash branch → `syncUserManagementToDisk` (`src/data/workspace/userSync.ts:27-137`) → `withResourceLock("users-permissions:rmw")` (userSync.ts:42) wrapping `casLoop` (userSync.ts:43-129) → inside the CAS attempt: `readJsonFile` (existing state, userSync.ts:45-48) → build `diskFile` envelope (userSync.ts:53-96, string-schema `WORKSPACE_SCHEMA_VERSION`, per-attempt `_writeToken`) → `writeJsonFile` (userSync.ts:98) → `safeWriteJson` → verify-read via `readJsonFile` (userSync.ts:100-103) and delayed re-verify callback (userSync.ts:112-123).

**Reader function(s).**
- `loadWorkspaceFiles` (fileSystemAccess.ts:266-290) reads it via `readJsonFile` on every workspace connect/reconnect/reload/structure-creation (called from `WorkspaceProvider.tsx` at lines 102, 248, 264, 298) → feeds `applyDiskUsers` (WorkspaceProvider.tsx:424-460), which converts disk users/permissions into `ManagedLoginUser[]`/`RolePermission[]`/`FeaturePermission[]` and calls `syncUsersFromDisk` (`userManagement.ts:576-589`), replacing the in-memory `runtimeUserManagementState` — this is the actual source that drives **every role-gated UI element in the app** (sidebar tab visibility, `PermissionGuard`, `usePermissions().can/canMutate`).
- `checkWorkspaceStructure` also reads it (fileSystemAccess.ts:212-215) purely for the schema-presence gate, same pattern as the manifest.
- `syncUserManagementToDisk`'s own CAS loop reads it before every write (userSync.ts:45,100,113) to compute the next revision and detect conflicts — a reader used only internally to the writer.
- `WorkspaceGate.tsx`'s `FirstRunChecklist` reads the **in-memory** copy via `getManagedLoginUsers()`/`readUserManagementState()` (WorkspaceGate.tsx:429,436), not the file directly — an indirect consumer.

**Why it exists.** This is the actual authorization/identity backing store for the whole app (usernames, Argon2id password hashes, roles, per-tab and per-feature permission matrices). Without it, every workspace would fall back to the hardcoded six default users and default permission matrix (`createEmptyUserManagementState()`), meaning no admin-created users, no permission customization, and no persisted password changes would survive a workspace reconnect.

**Lifecycle.** Created at workspace structure creation with seed defaults. Updated on every user-management edit and, opportunistically, on password-hash rehash during login. Never deleted by this cluster (no "reset users" flow found here). If missing/corrupt: `readJsonFile` falls back to `{file}.bak` (fileSystemAccess.ts:372-385); if both are gone/corrupt, `loadWorkspaceFiles`'s `usersPermissions.ok` is false → `applyDiskUsers` treats `diskData` as `undefined` → falls back to `createDefaultManagedUsers()` (WorkspaceProvider.tsx:429-441) — i.e. a corrupted permissions file silently resets every workspace user back to the six hardcoded defaults on next load, with no warning surfaced in this cluster's code (the generic `data:recovered-from-bak` event only fires on a `.bak` recovery, not on a full "both copies gone" reset).

---

#### 3. `{workspaceRoot}/5-system/workspace.schema.json`

**Artifact.** `WorkspaceSchemaMetadata` envelope (`workspaceSchema.ts:10-18`), `WORKSPACE_SCHEMA_METADATA_FILE = "workspace.schema.json"` (workspaceSchema.ts:6), written directly (not through the generic envelope wrap) into the system root.

**UI entry point.**
- **Automatic, no direct user action**: written as the tail end of `createWorkspaceStructure` (fileSystemAccess.ts:352-355) — i.e. every time the "create structure" or demo-workspace flow runs (same triggers as artifact #1), *if and only if* `detectWorkspaceSchema` reports `layout === "current"` with zero missing roots.
- **`migrateWorkspaceSchema`** (workspaceSchema.ts:167-217), the function meant to stamp this file for a *legacy or mixed* workspace after a confirmed backup, **has no UI caller anywhere in `src/`** — grep across the whole source tree matches only `workspaceSchema.ts` itself and `workspaceSchema.test.ts`. There is no Archive/Settings/User-Management button that invokes it. This is a fully-built, tested, but entirely unwired feature.

**Writer function(s).** `initializeWorkspaceSchemaMetadata` (workspaceSchema.ts:125-156) → `safeWriteJson` (workspaceSchema.ts:150), called from `createWorkspaceStructure` (fileSystemAccess.ts:354). The dead path: `migrateWorkspaceSchema` (workspaceSchema.ts:167-217) → `safeWriteJson` (workspaceSchema.ts:206).

**Reader function(s).** `detectWorkspaceSchema` → `readSchemaMetadata` (workspaceSchema.ts:60-68), called from `detectWorkspaceSchema` itself (workspaceSchema.ts:95) and transitively from `planWorkspaceSchemaMigration`/`migrateWorkspaceSchema`. **`detectWorkspaceSchema` itself is only called from within `workspaceSchema.ts` (by `createWorkspaceStructure` and the migration functions) and from tests** — nothing in the UI layer (`WorkspaceProvider.tsx`, `WorkspaceGate.tsx`, Settings, Archive) calls `detectWorkspaceSchema` or reads `workspace.schema.json` to show layout status to a user.

**Why it exists.** Intended purpose (per its own doc comments) is to let a future migration tool distinguish "this workspace's current/legacy/mixed folder layout was already validated and backed up" from "not yet migrated," without ever moving files itself. Today it functions purely as a one-time stamp on new workspaces; the migration half of its purpose is inert.

**Lifecycle.** Created once, automatically, for a fresh (never-legacy) workspace. Never updated in practice (the migration path that would update it for a legacy/mixed workspace is unreachable from the UI). Never deleted. If missing on a workspace that's otherwise "current" layout: `detectWorkspaceSchema` just reports `metadata: null` — nothing currently branches on that in the UI, so it is a silent no-op, not a user-visible error.

---

#### 4. `{workspaceRoot}/3-user-data/labels.snapshot.json`

**Artifact.** `LabelsSnapshotData` (`{overrides, savedAt}`, `src/data/workspace/labelsSnapshot.ts:22-25`) — a workspace-disk mirror of the browser-only `localStorage["xray-labels-v1"]` custom label overrides (that key itself lives in `src/data/labels/labelsStore.ts`, outside this cluster's direct scope, but the snapshot file is squarely in `workspace/`).

**UI entry point.**
- **Write**: **Settings tab → any label-override save action** — three call sites in `src/components/Sidebar/Tabs/Settings/index.tsx:326,333,403`, each `if (directoryHandle) void exportLabelsSnapshot(directoryHandle)` fired as a side effect of saving/resetting a label override (exact button handler names live outside this cluster's file set, but all three call sites are unconditional fire-and-forget side effects of a Settings-tab save/reset action, not separate buttons of their own).
- **Also background**: called from `src/data/backup/backupStorage.ts:916` as part of the manual/automatic backup flow (outside this cluster, but confirms the artifact is also refreshed opportunistically whenever a backup runs).
- **Read (restore)**: **Archive tab → restore-backup flow → `importLabelsSnapshot`** (`src/components/Sidebar/Tabs/Archive/index.tsx:292`), an explicit opt-in import, not automatic.

**Writer function(s).** `exportLabelsSnapshot` (labelsSnapshot.ts:31-42) → `getCustomLabelOverrides()` (from `labelsStore.ts`, outside cluster) → `safeWriteJson` (labelsSnapshot.ts:38). Wrapped in try/catch — "never throws" by design (labelsSnapshot.ts:29-30).

**Reader function(s).** `importLabelsSnapshot` (labelsSnapshot.ts:49-66) → `safeReadJson` (labelsSnapshot.ts:52) → applies each override via `setLabel` (labelsSnapshot.ts:58), called only from the Archive tab's restore flow (`Archive/index.tsx:292`). No other reader.

**Why it exists.** The label-override system (`labelsStore.ts`) is `localStorage`-only and therefore not covered by a full workspace backup/restore, which operates on workspace-folder JSON. This file exists solely so a workspace backup/restore can carry label customizations along with the rest of the data, closing that gap.

**Lifecycle.** Created/overwritten on every Settings-tab label save/reset and on every backup run. Never deleted independently (only ever superseded by the next write). If missing/corrupt on restore: `importLabelsSnapshot` returns `0` (`result.ok` false short-circuits, labelsSnapshot.ts:53) — restore silently applies zero label overrides, no error surfaced to the user beyond an implied "0 labels restored" count wherever Archive displays that return value.

---

#### 5. Generic `.bak` snapshot (every `safeWriteJson`-managed file)

**Artifact.** `{fileName}.bak` — sibling file next to every file this cluster's `safeWriteJson`/`safeWriteJsonText` ever writes (safeWrite.ts:325,395,489). Not a fixed name — a suffix pattern applying to every JSON artifact in the whole app (population, samples, distribution, answers, all the files in this section, etc.).

**UI entry point.** No direct UI action creates it — it's an automatic **side effect of every disk write** that goes through `safeWriteJson`/`safeWriteJsonText`, across every feature in the app.

**Writer function(s).** Inside `safeWriteJson` (safeWrite.ts:323-326 small-file path snapshot before commit; streamed path equivalent at safeWrite.ts:324-326 duplicated logic) and `safeWriteJsonText` (safeWrite.ts:487-490) — snapshots the *current* (pre-write) live file content, only if it currently parses as valid JSON (`parsedCurrent` check).

**Reader function(s).** `safeReadJson` (safeWrite.ts:585-599) and `readJsonFile` (fileSystemAccess.ts:372-385) both fall back to `.bak` when the live file is missing/corrupt — dispatching `window` event `"data:recovered-from-bak"` (safeWrite.ts:588-592; fileSystemAccess.ts:378-382) on recovery. Also read directly (bypassing the live file) by `readEnvelopeRevision`'s fallback (safeWrite.ts:565-567) and by `workspaceSchema.ts`'s `readSchemaMetadata`... no — that one only reads live via `safeReadJson` which itself falls back internally, so no separate direct `.bak` read there. `backupStorage.ts`'s tree-copy walk (outside this cluster) also reads raw file text including `.bak` siblings when backing up a workspace, via `readFileTextWithRetry` (safeWrite.ts:87-92) — a public export specifically added for that caller (see doc comment at safeWrite.ts:65-86).

**Why it exists.** The single rollback source for the stage/verify/commit protocol: if a live-file write's post-commit verification fails, the `.bak` (the last *known-good* version) is restored so a torn/corrupted write never leaves the app pointing at broken JSON. It is also the general "torn write" recovery source for any read that finds the live file missing or unparseable for any reason (crash mid-write, antivirus lock, manual deletion).

**Lifecycle.** Created/overwritten on every successful write that had a pre-existing valid live file (first-ever write of a filename never gets a `.bak`, since there's nothing valid to snapshot — safeWrite.ts:324/394/488 all gate on `parsedCurrent`/`parseValidJson(current) !== null`). Never explicitly deleted by this cluster — it persists indefinitely as "the previous revision," superseded (overwritten) by the next successful write's own pre-write snapshot. If the live file and `.bak` are both gone/corrupt, `safeReadJson` falls through to the `.tmp` last-resort (see #6) and finally reports `{ok:false, reason:"missing"|"corrupt"}`.

---

#### 6. Generic `.tmp` staging file (every `safeWriteJson`-managed file)

**Artifact.** `{fileName}.tmp` — staging file used during the write protocol, `tmpName = \`${fileName}.tmp\`` (safeWrite.ts:280,483).

**UI entry point.** Same as `.bak` — automatic side effect of any write through `safeWriteJson`/`safeWriteJsonText`, not a direct user action.

**Writer function(s).** Staged first via `writeText`/`streamEnvelopeToFile`/`streamValueToFile` (safeWrite.ts:400,330,495,515), then verified (`readText`+`parseValidJson`/`verifyStreamedFile`), then either promoted to the live file (only in the failure-recovery branch, safeWrite.ts:359-368,431-441) or left as-is for normal-path cleanup.

**Reader function(s).** `verifyStreamedFile`/direct `readText` re-reads immediately after staging, within the same write call (safeWrite.ts:336,348,360,401-404,412-415,427-436). Cross-call reader: `safeReadJson`'s last-resort fallback (safeWrite.ts:604-618) — if both live and `.bak` are missing/corrupt, it recovers from a surviving verified `.tmp` (left behind by a previous failed commit that couldn't be rolled back or promoted). `readJsonFile` (fileSystemAccess.ts) has **no equivalent `.tmp` fallback** — see the asymmetry noted below.

**Why it exists.** The "stage before you commit" half of the atomicity emulation: content is fully written and verified in a `.tmp` file *before* the live file is ever touched, so a crash between "start writing the live file" and "finish writing it" still leaves a verified good copy (the `.tmp`) recoverable, and a failed live-file verification can promote the `.tmp` instead of losing the write outright.

**Lifecycle.** Created at the start of every write, normally deleted at the end via `removeQuietly` (safeWrite.ts:117, called at safeWrite.ts:382,449,511,539 on the success path). Survives on disk only when a write fails validation AND has no usable `.bak` to roll back to (safeWrite.ts:375-378,442-445) — in that case it is deliberately left behind as "the survivor for recovery" and the write throws. `removeQuietly` swallows any deletion error (e.g. already gone) — best-effort only.

---

#### 7. `sessionStorage["xray_auth_session_v1"]`

**Artifact.** JSON-serialized `AuthSession` (`{role, username, loginAt, mode?}`), key `SESSION_STORAGE_KEY` (`src/auth/authSession.ts:8`).

**UI entry point.**
- **Employee/manager/etc. login form → submit → `loginAsEmployee`** (`AuthGate.tsx:452-524`) → `applySession` (AuthGate.tsx:446-450).
- **Bootstrap-admin passcode modal → submit → `loginAsBootstrapAdmin`** (AuthGate.tsx:526-539) → `applySession`.
- **Logout button/action → `clearSession`** (called at AuthGate.tsx:237,268,356 — logout handlers, managed-user-removed auto-logout, and elsewhere) removes it.
- **Demo/viewer auto-login** (mounting the in-memory demo workspace) also calls `writeSession` directly (AuthGate.tsx:217) but is then immediately overridden to *not* persist (see Lifecycle) since `mode: "demo"`.

**Writer function(s).** `applySession`/direct `writeSession` calls → `writeSession` (authSession.ts:129-139) → `writeStoredSession` (authSession.ts:41-47) → `sessionStorage.setItem`. `clearSession` (authSession.ts:141-146) → `clearStoredSession` (authSession.ts:49-55) → `sessionStorage.removeItem`.

**Reader function(s).** `readRealSession`/`readSession` (authSession.ts:99-127) — lazily reads `sessionStorage` **only once**, on first call after module load or after `runtimeSession` is cleared (authSession.ts:100-105); every subsequent call within the same page life serves the in-memory `runtimeSession` variable instead of re-reading storage. Consumed throughout the app via `usePermissions()` and directly by `AuthGate.tsx` (session-restore-on-mount) and any component checking "who is logged in."

**Why it exists.** Lets a page reload preserve the logged-in session without a fresh login, while auto-clearing when the tab/browser closes (unlike `localStorage`) — an explicit UX-only convenience per the SEC-02 comment (authSession.ts:16-19); it is not a security boundary (client-forgeable).

**Lifecycle.** Written on every successful login; updated implicitly (re-written) whenever `applySession`/`writeSession` is called again (e.g. role-preview does NOT rewrite it — preview role is a separate runtime-only variable, see #10). Cleared on logout, on session-user-removed auto-logout, and never persisted at all for demo-mode sessions (authSession.ts:131-137, "LOG-01" — demo identity must not survive a reload). Read-back also self-expires: `isExpired` checks a 7-day TTL against `loginAt` on every `readRealSession()` call chain (authSession.ts:65-71,107) — an expired session is treated as absent and the storage key is proactively cleared (authSession.ts:108-111). Corrupt/malformed JSON is caught and treated as "no session" (authSession.ts:34-38, `isValidSession` guard).

---

#### 8. `localStorage["xray_last_login_username_v1"]`

**Artifact.** Plain string (last-used login username), key `LAST_USERNAME_KEY` (`src/auth/loginPersistence.ts:1`).

**UI entry point.** **Employee login form → successful login → `loginAsEmployee`** (AuthGate.tsx:518) writes it; **bootstrap-admin login → `loginAsBootstrapAdmin`** (AuthGate.tsx:539) *clears* it instead (admin isn't a "rememberable" employee username); also cleared from a UI control at `AuthGate.tsx:775` (a "forget me"/username-clear affordance on the login form, exact button not traced further as it's outside this cluster's file set beyond the call site).

**Writer function(s).** `writeLastLoginUsername` (loginPersistence.ts:11-22) → `localStorage.setItem`, called from AuthGate.tsx:518. `clearLastLoginUsername` (loginPersistence.ts:24-30) → `localStorage.removeItem`, called from AuthGate.tsx:539,775.

**Reader function(s).** `readLastLoginUsername` (loginPersistence.ts:3-9) — used by `AuthGate.tsx` to pre-fill the username field on the login form (exact state-init call site is in AuthGate.tsx's component body, consistent with the import at AuthGate.tsx:42-44).

**Why it exists.** Pure UX convenience — pre-fills the last-used username so a returning user doesn't retype it. All operations are wrapped in try/catch with silent fallback to `""` (loginPersistence.ts:6-8,19-20,27-28) — losing this key breaks nothing except the pre-fill.

**Lifecycle.** Written on every successful non-admin login; cleared on admin login or explicit "forget" action. Never expires. If missing/unavailable (private browsing, storage disabled): every function degrades to a no-op / empty string, never throws.

---

#### 9. IndexedDB `xray-quality-app-persistence` → store `workspace` → key `"last-workspace"`

**Artifact.** `PersistedWorkspaceRecord` (`{id, directoryHandle: FileSystemDirectoryHandle, directoryName, savedAt}`, `src/data/workspace/workspacePersistence.ts:8-16`) — the only artifact in this cluster that persists an actual `FileSystemDirectoryHandle` object (IndexedDB structured-clone support for handles), not JSON text.

**UI entry point.**
- **Write**: automatic side effect of **`WorkspacePicker`'s "اختر مجلد" (pick folder) button → `selectWorkspace`** (WorkspaceGate.tsx:159-167 → WorkspaceProvider.tsx:204-227) — `applyWorkspaceHandle` calls `saveLastWorkspace` unconditionally unless `options.persist === false` (WorkspaceProvider.tsx:110-112). Demo-workspace entry and the initial-boot auto-restore path both pass `persist:false`/`persist:false` respectively (WorkspaceProvider.tsx:318,155-158,192-195) so they do **not** re-save.
- **Delete**: **any "clear workspace" / logout-adjacent action → `clearWorkspace`** (WorkspaceProvider.tsx:322-342) → `clearLastWorkspace()` (WorkspaceProvider.tsx:341).

**Writer function(s).** `saveLastWorkspace` (workspacePersistence.ts:39-59) → raw `indexedDB` transaction, `store.put(record)`.

**Reader function(s).** `loadLastWorkspace` (workspacePersistence.ts:61-82), called on **app boot** (`WorkspaceProvider.tsx`'s mount effect, WorkspaceProvider.tsx:115-169 — not a user action, an automatic side effect of the `WorkspaceProvider` component mounting) and again from `reconnectWorkspace` (WorkspaceProvider.tsx:171-201, itself triggered by the **"إعادة الاتصال" (reconnect) button** on `WorkspacePicker`, WorkspaceGate.tsx:148-157).

**Why it exists.** Lets the app "remember" which workspace folder was last connected across full page reloads/browser restarts, so the user doesn't have to re-pick the folder every session — the File System Access API's own permission model still requires a fresh readwrite grant (or at least a `queryPermission` check) before auto-using the restored handle (WorkspaceProvider.tsx:137-154), so this alone doesn't bypass the browser's own permission UX.

**Lifecycle.** Written on every explicit folder pick (not on restore/demo). Overwritten (single fixed key, `store.put`) on every subsequent pick — there is no history, only "the last one." Deleted on `clearWorkspace`. If IndexedDB itself is unavailable (`typeof indexedDB === "undefined"`), `openPersistenceDb` rejects (workspacePersistence.ts:20-23) and every caller here wraps the call in `.catch(() => null)`/`.catch(() => undefined)` (WorkspaceProvider.tsx:111,172), degrading silently to "no remembered workspace, always show the picker."

---

#### 10. `localStorage["xray_firstrun_dismissed_v1:{workspaceKey}"]`

**Artifact.** Sentinel string `"1"`, one key per workspace (`workspaceKey = directoryHandle?.name || selectedDirectoryName`), prefix `FIRSTRUN_DISMISS_PREFIX` (`src/data/workspace/WorkspaceGate.tsx:403`).

**UI entry point.** **`FirstRunChecklist` panel (admin-only, empty-workspace onboarding aid) → its "×" dismiss button → `dismiss()`** (WorkspaceGate.tsx:535-542,554-556).

**Writer function(s).** `dismiss()` (WorkspaceGate.tsx:535-542) → `localStorage.setItem(dismissKey, "1")`, try/catch-wrapped (non-fatal on failure).

**Reader function(s).** `readDismissed` (WorkspaceGate.tsx:405-411) → `localStorage.getItem(key) === "1"`, read on mount and whenever `dismissKey` (i.e. the connected workspace) changes (WorkspaceGate.tsx:460-463), gating whether `FirstRunChecklist` renders at all.

**Why it exists.** Lets an admin permanently dismiss the first-run onboarding checklist for a given (empty) workspace without it resurfacing on every reload before the first month is imported — after the first month exists the checklist auto-hides anyway (`monthCount >= 1`, WorkspaceGate.tsx:502), so this key is only meaningful in the narrow window between structure-creation and first import.

**Lifecycle.** Created only if the admin explicitly dismisses the checklist. Never updated (write-once value `"1"`). Never deleted by this cluster (no "un-dismiss" affordance) — it becomes permanently irrelevant, but not cleaned up, once the workspace passes `monthCount >= 1` (its own guard makes the checklist stop rendering regardless of this key, so the stale key is harmless dead weight in `localStorage`, keyed per-workspace-name forever). If missing (default state): checklist shows, which is the intended default.

---

#### 11. `5-system/audit/activity.log.json`

**Artifact.** `AuthActivityLogFile` (`{revision, _writeToken?, updatedAt, entries: AuthActivityLogEntry[]}`, `src/auth/authActivityLog.ts:27-33`), capped at `MAX_ACTIVITY_LOG_ENTRIES = 5000` (authActivityLog.ts:8,64) entries (oldest trimmed first, sorted by `signedInAt`).

**UI entry point.** Not any single button — a **background side effect of the session lifecycle itself**:
- **Every login** (employee, bootstrap-admin, demo) → `writeSession`/`applySession` → `startAuthActivitySession` (authSession.ts:103,138) → begins a new entry + `queueFlush()`.
- **Periodic heartbeat** — `recordAuthActivityHeartbeat` (authActivityLog.ts:184-193) is presumably called from a timer elsewhere in the app (not found within this cluster's file set; its caller is outside `src/auth/`'s browser-storage-only files, likely `AuthGate.tsx`'s activity-tracking effect or a top-level app timer) — extends `lastSeenAt`/`durationMs` on the active entry and re-flushes.
- **Logout / session expiry / session-replaced / page-closed** → `endAuthActivitySession(reason)` (authActivityLog.ts:195-211), called from `clearSession` (authSession.ts:141-142) and from `readRealSession`'s own expiry check (authSession.ts:108).
- **Workspace connect** → `configureAuthActivityLogWorkspace(directoryHandle)` (authActivityLog.ts:159-162), called from an `AuthGate.tsx` effect (AuthGate.tsx:186-200) once a session exists and the workspace is `"ready"` — this is what actually points the module at a disk location and triggers the first flush; before a workspace is connected, activity accumulates in `memoryEntries` only and nothing is written to disk.

**Writer function(s).** `queueFlush` (authActivityLog.ts:153-157) → chained onto a module-level `writeChain` Promise (serializes concurrent flushes) → `flushMemoryToWorkspace` (authActivityLog.ts:115-151) → `casLoop` (authActivityLog.ts:129-148) → inside the attempt: `readDiskLog` (authActivityLog.ts:85-98, via `safeReadJson`) → `mergeEntries` (authActivityLog.ts:56-65, merge-by-id + trim to 5000) → `safeWriteJson` (authActivityLog.ts:134-139) → verify via a second `readDiskLog` (authActivityLog.ts:140).

**Reader function(s).** `readAuthActivityLog` (authActivityLog.ts:213-218) — awaits the in-flight `writeChain` first, then merges disk + memory — consumed by **User Management tab → "Activity" sub-tab**: `src/components/Sidebar/Tabs/UserManagement/TabView.tsx:191-198` (initial load) and `TabView.tsx:621` (a refresh action, e.g. a refresh button on that sub-tab).

**Why it exists.** A durable, cross-machine, cross-session login/logout/session-duration audit trail for the `user-management/activity` sub-tab — without it, admins would have no record of who logged in/out, from where (implicitly, per workspace), or for how long, and the record would not survive a page reload (unlike the ephemeral in-memory session state).

**Lifecycle.** First created (well, first successfully flushed to disk) the first time a logged-in session connects a workspace after this module has any memory entries. Continuously appended-to (via merge, not overwrite) on every login/heartbeat/logout across every machine sharing the workspace — the CAS/merge-by-id protocol (authActivityLog.ts:119-128, doc comment) is explicitly designed so no machine's entries are silently dropped by a concurrent flush. Capped, not deleted — oldest entries beyond 5000 are silently trimmed (`mergeEntries`'s `.slice(-MAX_ACTIVITY_LOG_ENTRIES)`, authActivityLog.ts:64) with no separate archive of what's trimmed. If missing/corrupt on read: `readDiskLog` treats it as `{revision:0, entries:[]}` (authActivityLog.ts:87,90) — silently starts a fresh log, no error surfaced, no recovery-from-`.bak` special-casing beyond what `safeReadJson` already does generically.

---

#### 12. Runtime-only, never persisted to any storage (in-memory-only artifacts)

These are "storage keys" in the sense of being singleton state this cluster owns and exposes via read/write functions, but **none of them is written to `localStorage`/`sessionStorage`/IndexedDB/disk** — included for completeness per the "be exhaustive" instruction, and because their non-persistence is itself a notable fact.

- **`runtimeUserManagementState`** (`userManagement.ts:58`) — the in-memory mirror of `users.permissions.json` (see artifact #2). Populated only by `syncUsersFromDisk`/`writeUserManagementState`; resets to `createEmptyUserManagementState()` on fresh page load with no workspace connected yet (userManagement.ts:553-555). Read by essentially every permission check in the app (`getRolePermission`, `hasFeature`, etc.).
- **`runtimeSession` / `runtimePreviewRole`** (`authSession.ts:13-14`) — the actual session object backing `sessionStorage` (see #7), plus the admin role-preview override, which is **explicitly never persisted anywhere** (authSession.ts:10-12) — a page reload always drops any active role preview back to the real admin role.
- **Error ring buffer** (`entries` array, `src/data/storage/errorLogger.ts:8`) — last 50 `logError()` calls app-wide, capped and spliced in place (errorLogger.ts:13-14). Written from dozens of call sites across the app (any `catch` block that calls `logError`/`logRejection`); read only by **Settings tab → "سجل الأخطاء الأخيرة" (Error Log) section**, `ErrorLogSection.tsx:21,28,39` (`getRecentErrors`), with a **"مسح السجل" (clear) button** → `clearErrors()` (ErrorLogSection.tsx:42-46). Entirely lost on page reload — by design, this is a session-scoped debugging aid, not an audit trail (contrast with artifact #11, which is the durable equivalent for auth events specifically).
- **`readOnlyMode` flag** (`src/data/storage/readOnlyMode.ts:8`) — a single module-level boolean, set only by `enterDemoWorkspace`/related demo-mode entry and exit (`WorkspaceProvider.tsx:314,319,323`). Gates every `safeWriteJson`/`safeWriteJsonText` call via `assertWritableMode()` (safeWrite.ts:278,459). Never persisted — always resets to `false` on reload, meaning a reload while inside a demo session would (if the demo session itself could survive a reload, which it explicitly cannot per artifact #7's lifecycle) silently re-enable writes; this is moot in practice only because demo sessions are never persisted.

---

### Orphans and asymmetries

1. **`workspace.manifest.json` is write-only.** Its `.data` payload (`workspaceId`, `workspaceName`, `files` path map) is written by `createWorkspaceStructure` and then never read by any code path other than a schema-version presence check that ignores `.data` entirely (fileSystemAccess.ts:227; confirmed by the explicit code comments at `WorkspaceContext.ts:55-62` and `fileSystemAccess.ts:269-277`). This is the single clearest write-only artifact in the cluster.

2. **`migrateWorkspaceSchema` is fully unwired dead code from the UI's perspective.** It is exported, documented, and covered by `workspaceSchema.test.ts`, but grep across all of `src/` finds zero non-test callers. The only thing that ever writes `workspace.schema.json` in production is `initializeWorkspaceSchemaMetadata` (the "new, already-current-layout workspace" path) — the "existing legacy/mixed workspace, migrate it" path described in the module's own doc comments has no UI entry point at all. A legacy or mixed-layout workspace today can run indefinitely with `workspace.schema.json` never created and no admin-facing way to create it deliberately.

3. **Two incompatible envelope/hash schemes, asymmetric verification.** `safeWriteJson`'s own `validateEnvelope` (jsonEnvelope.ts:172-198) unconditionally passes any envelope whose `metadata.schemaVersion` is a *string* (the workspace-management shape used by artifacts #1, #2) without recomputing its `contentHash` — so on every normal read through `safeReadJson`, the `contentHash` field on `workspace.manifest.json` and `users.permissions.json` is never actually checked against the file's real content. Meanwhile `fileSystemAccess.ts`'s own `isJsonEnvelope` (used only by `checkWorkspaceStructure`) checks that `contentHash` is a string but likewise never recomputes/compares it. Net effect: two hash fields exist, both computed correctly on write, neither one verified on any read path found in this cluster.

4. **Two independent "safe JSON read" functions with diverging recovery depth.** `safeReadJson` (safeWrite.ts) falls back live → `.bak` → surviving verified `.tmp`. `readJsonFile` (fileSystemAccess.ts) — used specifically for the two most safety-critical files in the whole app, the manifest and the permissions file — falls back live → `.bak` **only**, with no `.tmp`-promotion recovery. A crash that leaves `users.permissions.json` recoverable only via its `.tmp` (the exact scenario `safeWriteJson`'s own promotion logic is built to survive) would not be recovered by the read path this file actually uses.

5. **Corrupted `users.permissions.json` silently resets the whole workspace's users to hardcoded defaults**, with no distinct error/warning path in this cluster beyond the generic (and in this case not even triggered, since both live and `.bak` are gone) `data:recovered-from-bak` event. `applyDiskUsers` (WorkspaceProvider.tsx:424-460) treats a failed read exactly the same as "this is a brand-new empty workspace" (`createDefaultManagedUsers()`), which for an *existing* workspace whose permissions file got corrupted is a silent, unannounced downgrade of every custom user/permission back to the six seed accounts.

6. **`readOnlyMode` and demo-session non-persistence are two separate safeguards for the same invariant** (a demo/viewer session must never gain real write access), each independently correct but neither documented as depending on the other — `readOnlyMode` itself is not persisted, so its safety relies entirely on the fact that a demo `AuthSession` is also never persisted (artifact #7's lifecycle note). If a future change ever made demo sessions persist across reloads (even partially, e.g. via a different storage key added elsewhere) without someone remembering to also persist/re-derive `readOnlyMode`, writes could silently re-enable for a restored demo session.

7. **`activity.log.json`'s writer (`recordAuthActivityHeartbeat`) has no caller inside this cluster's own file set.** Its trigger (a periodic timer) lives outside `src/auth/`'s pure browser-storage files, so from this cluster's vantage point alone, the heartbeat half of the write path is effectively an orphaned export — present, exported, but its production call site is out of scope to confirm here. (Flagged as a gap in this audit's own coverage, not asserted as literally unused — `endAuthActivitySession`/`startAuthActivitySession` are confirmed wired via `authSession.ts`.)

8. **`xray_firstrun_dismissed_v1:{workspaceKey}` accumulates forever in `localStorage`** with no cleanup path — once a workspace passes one imported month the key becomes permanently irrelevant (the checklist's own `monthCount >= 1` guard makes the dismissal moot), but nothing ever removes the stale key. Low-impact (single string per distinct workspace folder *name* ever connected from this browser) but a genuine, unbounded, never-collected `localStorage` growth path.

9. **Generic `.bak`/`.tmp` sentinel pattern is read by two asymmetric consumers.** `safeReadJson` treats `.tmp` as a legitimate last-resort data source; `readFileTextWithRetry` (the export added specifically for `backupStorage.ts`'s tree-walking copy) reads whatever raw text is present at a given path — including a stray `.tmp`/`.bak` if the backup routine happens to enumerate and copy them directly — with no envelope validation at that layer (that walk is outside this cluster, but it directly consumes this cluster's staging convention, so a backup taken mid-write could, in principle, capture a `.tmp` file as if it were regular workspace content, unless the backup routine explicitly filters those suffixes — not verified here since `backupStorage.ts` is out of scope).
### Population Ingestion Pipeline — Full Traceability Matrix (Cluster 2 of 5)

Read-only audit. Every claim below is grounded in code actually read (file:line cited).
Scope: `src/data/population/`, `src/workers/`, `src/data/integrity/`,
`src/components/Sidebar/Tabs/Population/` data-facing code.

#### Generic write mechanics (applies to every artifact below unless noted)

Every write goes through `safeWriteJson` (`src/data/storage/safeWrite.ts:273`) or
`safeWriteJsonText` (line 454), which for file `X`:
1. Snapshots the current live `X` to `X.bak` (safeWrite.ts:323/393/489) — "the rollback source."
2. Stages the new content to `X.tmp` (`tmpName`, safeWrite.ts:280/483).
3. Commits `X.tmp` → `X` and re-verifies; on failure keeps `.tmp` on disk as a recovery survivor
   (comments at safeWrite.ts:357-375, 425-442).
Every write is wrapped in a `JsonEnvelope` (`{ metadata: {schemaVersion, revision, contentHash,
writtenAt}, data }`) by `wrap()`, imported from `jsonEnvelope.ts`. Reads (`safeReadJson`) fall
back live → `.bak` → (in some helpers) `.tmp` on read failure. This ladder is NOT re-described
per artifact below except where an artifact's read path deliberately bypasses it (§ raw-text
Browse path) or has no fallback at all (binary source files).

---

#### Artifact: `1-population/config.json`

**UI entry point**: Settings tab inside the Population wizard (mapping templates, stage-alias
mappings, sampling rules, processing-workflow presets, export templates) — the config editor is
wired at `Population/index.tsx:361` (`handleConfigChange`), reached from whatever settings UI
calls it (not traced further in this pass — out of the explicit Phase 1-4 wizard flow; this is a
cross-cutting settings surface, not a phase button). Loaded automatically on mount for every
Population-tab session (no user action) at `Population/index.tsx:236-238`.

**Writer function(s)**:
- `savePopulationConfig` (`populationConfig.ts:414`) — CAS-protected write (casLoop +
  `withResourceLock`, since this is a shared multi-writer file — comment referenced at
  `userSync.ts:41` draws the same tradeoff analogy).
- Call chain: user edits config in Settings UI → `handleConfigChange` (`Population/index.tsx:361`)
  → `savePopulationConfig(directoryHandle, newConfig)` (`Population/index.tsx:369`) →
  `populationConfig.ts:414` → `safeWriteJson(populationDir, "config.json", ...)`
  (`populationConfig.ts:429-438`).

**Reader function(s)**:
- `loadPopulationConfig` (`populationConfig.ts:373`) — `safeReadJson(populationDir, "config.json")`
  (line 382); falls back to `DEFAULT_POPULATION_CONFIG` + a best-effort seed write if missing
  (line 405).
- Consumers: `Population/index.tsx:236` (loaded on mount, feeds mapping templates used by Phase 1
  parse, stage mappings used by Phase 2/3, sampling rules used by Phase 3 draw); `populationStorage.ts
  :348` inside `saveMonthRunLocked`'s replacement-index rebuild step (reads config fresh to get
  current `stageMappings` for bucket assignment); `XrayReferrals.tsx:258-260`
  (Employee Workspace tab — reads `StageAliasMappings` to label referral rows by stage, entirely
  outside the Population tab).

**Why it exists**: Single source of truth for how raw Excel columns map to system fields, how
stage tokens (e.g. "Level 1"/"L1"/"المستوى الأول") normalize to the four canonical stage keys, and
sampling/processing rules — without it, every screen that needs to interpret a stage value or
column alias would have no way to know the workspace's actual naming conventions, and Phase 1
parsing would fall back to hard-coded defaults regardless of what the real Excel files use.

**Lifecycle**: Created lazily on first `loadPopulationConfig` call if missing (auto-seeded from
`DEFAULT_POPULATION_CONFIG`, `populationConfig.ts:405`). Updated whenever a user saves Settings
changes (`revision` field bumped via casLoop). Never deleted by app code. If missing: silently
recreated with defaults (no user-visible error). If corrupt: `safeReadJson`'s generic `.bak`
fallback applies; if that also fails, the load path returns `.ok=false` and callers of
`loadPopulationConfig` receive... (not fully traced — `populationConfig.ts:382` returns
`result.ok ? ... : ` whatever the function's fallback branch does, presumed default-config
fallback given the auto-seed logic at line 405, but the exact branch was not re-verified line by
line here).

---

#### Artifact: `1-population/certscan.global.json`

**UI entry point**: Phase 2 ("المرحلة 2: تقرير البيانات والمعالجة") — the CertScan paste textarea
in `CertScanGrid.tsx`, rendered inside `PhaseTwoReportAndProcessing.tsx` (confirmed via its prop
`onCertScanPasteTextChange={handleCertScanChange}`, `Population/index.tsx:1230`). Every keystroke
in that textarea calls `handleCertScanChange` (`Population/index.tsx:815`), which fires
`saveCertScanGlobal` (line 823) — i.e. this is saved continuously as the user types/pastes, not on
a discrete "save" button.

**Writer function(s)**:
- `saveCertScanGlobal` (`populationStorage.ts:87-95`) → `safeWriteJson(populationDir,
  "certscan.global.json", { text, updatedAt })`.
- Call chain: CertScan textarea `onChange` → `handleCertScanChange` (`Population/index.tsx:815`) →
  `saveCertScanGlobal(directoryHandle, text)` (`Population/index.tsx:823`, fire-and-forget `void`
  call — no await, no error surfaced to the user on failure).

**Reader function(s)**:
- `loadCertScanGlobal` (`populationStorage.ts:97-105`) — called once at
  `Population/index.tsx:269-273` on mount, feeding the CertScan textarea's initial value so a
  previously-pasted CertScan table persists across sessions/months. `CertScanGrid.tsx:83`'s own
  comment confirms this resolves inside a `useEffect` after first render.

**Why it exists**: The CertScan device-serial-number table is workspace-global (not
per-month) — pasting it once lets every subsequent month's Phase 2 CertScan matching reuse it
without re-pasting. Without it, every month would require the user to manually re-paste the
CertScan table before processing, and the CertScan/non-CertScan split (used downstream by
sampling apportionment) would default to "no CertScan data" until re-entered.

**Lifecycle**: Created on first paste. Updated on every keystroke (debounce behavior not verified
in this pass). Never deleted or superseded — always overwritten in place, no archive. If missing:
`loadCertScanGlobal` catches and returns `""` (line 104) — textarea starts empty, silently, no
error. If corrupt: same silent `""` fallback (the `catch` at line 100-104 is unconditional, not
distinguishing missing vs. corrupt). Write failures are also silently swallowed
(`catch { /* ignore */ }`, line 94) with no `logError` call — an inconsistency flagged in the
prior audit pass (Observation #6).

---

#### Artifact: `1-population/{month}/1-raw/risk.raw.json` and `.../bi.raw.json`

**UI entry point**: Phase 1 ("رفع الملفات") upload → Phase 2's "معالجة المجتمع" /
"إعادة معالجة المجتمع" button (`PhaseTwoReportAndProcessing.tsx:159`, `onClick={onProcessPopulation}`)
→ auto-save-to-disk that follows a successful process. The raw JSON is NOT written at file-pick
time (Phase 1) — it's written only after Phase 2's process step succeeds and
`performSaveToDisk`/`commitSaveToDisk` runs (see below). There is no separate "save raw only"
control; raw and processed are written together in the same disk commit.

**Writer function(s)**:
- Full chain: user clicks "معالجة المجتمع" → `handleProcessPopulation`
  (`Population/index.tsx:758-812`) → on success, `performSaveToDisk(result, riskWorkbookResult)`
  (line 802) → `commitSaveToDisk(...)` (line 894, since no existing sample blocks the save) →
  `saveMonthRun({..., riskRawRows: riskResult.rows, biRawRows: biWorkbookResult.rows, ...})`
  (`Population/index.tsx:909-948`) → `populationStorage.ts:213` `saveMonthRun` →
  `saveMonthRunLocked` (`populationStorage.ts:229`) → inline IIFEs at lines 298-309 (risk) and
  310-321 (bi) → `archiveExistingRaw(rawDir, "risk"|"bi")` (line 193-211, supersede step, see next
  artifact) then `safeWriteJson(rawDir, "risk.raw.json"|"bi.raw.json", {...})`.
- `riskWorkbookResult.rows`/`biWorkbookResult.rows` themselves originate from Phase 1's
  `WorkbookWorker` (`workbookWorker.ts:14-47`, calling `processRiskWorkbook`/`processBiWorkbook`)
  and are held in React state (`setRiskWorkbookResult`/`setBiWorkbookResult`,
  `Population/index.tsx:721-722`) between Phase 1 completing and Phase 2's save.

**Reader function(s)**:
- `loadRawDataset` (`populationStorage.ts:844-858`) — used by `loadMonthForEditing`'s `raw` scope
  (line 944-949), which per the comment at lines 927-938 is **only actually requested** when the
  month's manifest status is still `"raw-saved"` (i.e. Phase 1/2's own re-display of an
  already-uploaded-but-not-yet-processed workbook) — once processed, nothing downstream reads
  these rows again for sampling/distribution/browse.
- `loadAllRawRows` (`populationStorage.ts:729-754`) — Browse tab, "risk-raw"/"bi-raw" dataset
  selection, across all months (`loadBrowseRows` dispatch, line 789-792).
- `loadBrowseRows` single-month raw dataset branch (`populationStorage.ts:775-783`) — Browse tab
  with a specific month filter and `dataset==="risk-raw"|"bi-raw"`.
- UI surface for both: `BrowseDataView.tsx` (Population tab's Browse sub-tab), dataset selector.

**Why it exists**: Preserves the exact as-imported rows (post-normalization, pre-BI-enrichment,
pre-CertScan-match, pre-validation/dedup) as an audit trail independent of whatever the processed
population later becomes — lets a user inspect what was originally uploaded, and is the source
`archiveExistingRaw` copies from on re-import so a prior import is recoverable. Without it, a
reprocess would have no record of what the original Excel export actually contained once
`population.final.json` is overwritten, and Browse's "raw" dataset views would have no data.

**Lifecycle**: First created on the month's first successful Phase 2 process+save. On every
subsequent process+save (re-upload/reprocess), the existing live file is archived first (see next
artifact) then overwritten. Never deleted outright by app code (only superseded/archived). If
missing: `loadRawDataset` returns `[]` (populationStorage.ts:856) — Browse's raw dataset views show
empty, `loadMonthForEditing`'s raw rows come back empty (no visible error, since the file is
legitimately absent for months already past `raw-saved` status by the caller's own gating). If
corrupt: generic `safeReadJson` `.bak` fallback applies.

---

#### Artifact: `1-population/{month}/1-raw/{base}.raw.{ISO-timestamp}.superseded.json`

**UI entry point**: Same trigger as above — Phase 2's process+save — but only fires when a
**prior** `risk.raw.json`/`bi.raw.json` already exists for that month (i.e. this is a re-import,
not the first). No dedicated user control; it's an automatic side effect of re-processing.

**Writer function(s)**:
- `archiveExistingRaw` (`populationStorage.ts:193-211`), called from inside the same two IIFEs
  noted above (lines 300, 312), immediately before the live raw file is overwritten. Reads the
  existing live file's raw bytes via `safeReadJson` (to get `existing.rawText`, preserving the
  prior file's own `supersedes` chain verbatim rather than re-serializing) and writes them
  unchanged via `safeWriteJsonText(rawDir, archiveName, existing.rawText)` (line 205).

**Reader function(s)**: **None found in `src/`.** No function in the codebase reads
`*.superseded.json` files back. They exist purely as an on-disk audit trail for manual inspection
(e.g. by an admin browsing the workspace folder directly, or via the Backup tooling's generic
file-copy, not a population-specific reader). This is a genuine **write-only artifact** — see
Orphans section.

**Why it exists**: Guarantees (per the docstring at populationStorage.ts:182-191, "A5") that a
prior raw import is "never silently lost" when a month is re-imported — without it, re-uploading a
corrected Excel file would irreversibly discard whatever the previous raw import contained, with
no way to recover it even if the reprocess turns out to have been a mistake.

**Lifecycle**: Created only on a re-import (2nd+ process+save for the same month). Never updated
after creation (immutable, per its name). Never deleted by app code. If the archive write itself
fails, `archiveExistingRaw` logs via `logError("population:archive-raw", ...)` and returns `null`
(the new `supersedes` field is then `null`) — the re-import still proceeds; this is the one
documented case where the "never silently lost" guarantee can actually be silently violated (its
own docstring calls this out as a deliberate best-effort exception, lines 188-191).

---

#### Artifact: `1-population/{month}/1-raw/risk.source.{ext}` and `bi.source.{ext}`

**UI entry point**: Same Phase 2 process+save action as the raw JSONs — written alongside them in
the same `Promise.all` (`populationStorage.ts:285-322`), conditioned only on whether a source
`File` object was supplied (`params.riskSourceFile`/`biSourceFile`).

**Writer function(s)**:
- `saveBinaryFile` (`populationStorage.ts:69-84`) — `dir.getFileHandle(fileName, {create:true})`
  → `createWritable()` → raw `ArrayBuffer` write. Called from the IIFEs at lines 286-291 (risk) and
  292-297 (bi) inside `saveMonthRunLocked`.
- Full chain: same as the raw-JSON artifact above, down to `saveMonthRunLocked`
  (`populationStorage.ts:229`), branching into these two IIFEs instead.

**Reader function(s)**: **None found in `src/`.** No function reads `risk.source.*`/`bi.source.*`
back for any in-app purpose (not re-parsed, not exported, not shown in Browse). Write-only, same
category as the `.superseded.json` archives.

**Why it exists**: Keeps the literal original Excel file bytes on disk (not just the parsed JSON
rows) as the ultimate ground-truth artifact — useful for manual re-verification or re-import with
a different mapping template if the JSON-normalized version is ever suspected of a parsing bug.
Without it, only the app's own interpretation of the file (the JSON rows) would survive; the
original workbook itself would be gone once the user's local file-picker selection is cleared.

**Lifecycle**: Created/overwritten on every Phase 2 process+save that includes a source file (no
archive-before-overwrite here, unlike the raw JSON's `.superseded.json` protocol — a re-import
silently replaces the previous source binary with no history). Best-effort: `saveBinaryFile`
catches its own errors and calls `logError("saveBinaryFile", ...)` (line 82) rather than failing
the whole save. If the write fails, no source binary exists for that import but the raw JSON /
processed population save still succeeds.

---

#### Artifact: `1-population/{month}/2-processed/population.final.json`

**UI entry point**: Phase 2's "معالجة المجتمع"/"إعادة معالجة المجتمع" button
(`PhaseTwoReportAndProcessing.tsx:159`) → automatic save-to-disk on success (same trigger as the
raw JSONs; all written in one `commitSaveToDisk` call, not separately controllable).

**Writer function(s)**:
- `saveMonthRunLocked` (`populationStorage.ts:326-335`): builds `finalData: PopulationFinalData`
  from `processedRows` and writes via `safeWriteJson(processedDir, "population.final.json",
  finalData)`. Comment at line 324-325 notes this write must complete before the replacement-index
  rebuild (which reads this file's envelope revision back via `readEnvelopeRevision`, line 346).
- Full chain: "معالجة المجتمع" click → `handleProcessPopulation` (`Population/index.tsx:758`) →
  `processPopulation(...)` (main thread, `processing/populationProcessor.ts:651`, produces
  `preparedRows`) → `performSaveToDisk`/`commitSaveToDisk` (`Population/index.tsx:873/894`) →
  `saveMonthRun` with `processedRows: processingResult.preparedRows.map(({rawRow:_rawRow,
  ...rest}) => rest)` (`Population/index.tsx:923-926` — **`rawRow` is deliberately stripped**
  before persisting, per the inline comment: "raw data is already in risk.raw.json") →
  `populationStorage.ts:326-335`.

**Reader function(s)**:
- `loadMonthPopulationFinal` (`populationStorage.ts:606-621`) — full main-thread `JSON.parse` via
  `safeReadJson`. Used by `loadBrowseRows`'s single-month population branch (line 770-773) and by
  `loadMonthForEditing`'s `population` scope (line 941-942, feeding Phase 3's sampling pool and
  Phase 4's distribution view via `populationProcessingResult`-equivalent state).
- `loadAllPopulationRows` (`populationStorage.ts:568-604`) — Browse tab, "all months, no filter"
  view; reads and parses every month's file with `mapWithConcurrency(months, 4, ...)`.
- `loadMonthPopulationFinalRawText` (`populationStorage.ts:650-684`) — **raw text only**, no
  parse; feeds `usePopulationBrowseWorker().loadRawJson` (`usePopulationBrowseWorker.ts:207-229`)
  for the worker-owned Browse query path (`populationQueryWorker.ts:132-155` does the actual
  `JSON.parse`+`unwrap` off-main-thread). This is a **second, independent read path for the same
  file** with a different cost profile than `loadMonthPopulationFinal` above — see Orphans/
  Asymmetries.
- `loadMonthPopulationFinalRevision` (`populationStorage.ts:687-698`) — envelope revision only (no
  row data), used for report-to-revision linkage (not traced further in this pass).
- Also read by `rebuildReplacementIndex`'s caller indirectly: `saveMonthRunLocked` itself reads
  this file's just-written envelope revision via `readEnvelopeRevision` (line 346) immediately
  after writing it, to stamp the replacement index's `sourceRevision`.

**Why it exists**: This IS the processed population — the authoritative per-month dataset that
Phase 3 (sampling), Phase 4 (distribution), Browse, reporting, and the replacement-candidate index
all derive from. Without it, there is no "the population for month X" concept at all; every
downstream feature (sampling apportionment, distribution assignment, KPI/report generation) has
no source data to operate on.

**Lifecycle**: Created on the month's first successful process+save. Overwritten (not archived —
see Observation carried over from the prior pass) on every reprocess, gated by the TOCTOU sample-
existence check (`saveMonthRunLocked`, lines 253-262) which requires explicit user confirmation
(`confirmedOverwrite`) once a sample has been drawn for that month. If missing:
`loadMonthPopulationFinal` returns `null` (populationStorage.ts:619) and `loadMonthPopulationFinalRawText`
returns `null` (line 680) — Browse shows empty/no-data state, Phase 3/4 have nothing to sample/
distribute. If corrupt: the parsed-read path (`loadMonthPopulationFinal`) gets the generic
`.bak` fallback via `safeReadJson`; the raw-text path (`loadMonthPopulationFinalRawText`) has its
own **explicitly documented gap** (populationStorage.ts:638-648): a present-but-corrupt live file
is handed to the worker as-is (not repaired via `.bak`, since detecting corruption would require
the exact parse this path exists to avoid), and the worker's parse failure surfaces as an
"error" response in Browse rather than silently falling back.

---

#### Artifact: `1-population/{month}/2-processed/processing.summary.json`

**UI entry point**: Same Phase 2 process+save trigger as `population.final.json` — written
together in the same `commitSaveToDisk` call, conditioned on `params.processingSummary` being
supplied (always is, from `Population/index.tsx:929-934`).

**Writer function(s)**:
- `saveMonthRunLocked` (`populationStorage.ts:362-369`): `safeWriteJson(processedDir,
  "processing.summary.json", { ...params.processingSummary, savedAt: now })`.
- Chain: same as `population.final.json` above, down to `commitSaveToDisk`
  (`Population/index.tsx:894-948`), which builds `processingSummary: { removedRows, duplicateRows,
  invalidResultRows, summary }` directly from `processingResult` (the in-memory
  `PopulationProcessingResult` Phase 2 just produced) — lines 929-934.

**Reader function(s)**:
- `loadProcessingSummary` (`populationStorage.ts:830-842`) — used by `loadMonthForEditing`'s
  `summary` scope (always requested, per `FULL_MONTH_LOAD_SCOPE`/`useMonthLoad.ts`'s
  `monthLoadBootSources`, line 38: `"processing.summary.json"` is always listed as a boot source
  regardless of caller scope). Feeds Phase 2's own report display
  (`PopulationProcessingReport.tsx`, `DataAccuracyReport.tsx`) when a month is re-opened without
  re-running the process step in the current session.

**Why it exists**: Lets Phase 2's data-accuracy report (removed/duplicate/invalid-result row
counts, BI fill-rate stats) survive a page reload / month re-selection without re-running
`processPopulation` — without it, re-opening an already-processed month would show no processing
report at all (only the raw population rows), losing the audit trail of what was filtered out and
why.

**Lifecycle**: Created/overwritten on every Phase 2 process+save, in lockstep with
`population.final.json` (same commit, same lock). Never archived separately. If missing:
`loadProcessingSummary` returns `null` (populationStorage.ts:840) — the report UI presumably shows
an empty/no-summary state (not verified further in this pass). If corrupt: generic `.bak`
fallback.

---

#### Artifact: `1-population/{month}/month.manifest.json`

**UI entry point**: Written last in every Phase 2 process+save (deliberately — depends on totals
from every other write in the batch, per comment at `populationStorage.ts:372-373`). Also updated
(status field only) by two other actions outside Phase 2: Phase 3's sample draw and Phase 4's
distribution action, both via `updateMonthStatus` (not the full manifest rewrite) — and by
`monthLock.ts`'s close/reopen-month actions (not read in this pass, but sharing the same
`manifestLockKey`).

**Writer function(s)**:
- Full manifest write: `saveMonthRunLocked` (`populationStorage.ts:374-396`) — builds the
  `MonthManifestData` object and `safeWriteJson(monthDir, "month.manifest.json", manifest)`.
- Status-only advance: `updateMonthStatus` (`populationStorage.ts:419-478`) — CAS-protected
  (casLoop + `withResourceLock(manifestLockKey(...))`), monotonic via `STATUS_RANK`
  (lines 407-413; `"closed"` is deliberately excluded from the rank table so it can never be
  advanced past). Called from Phase 3 (after a sample draw commits — not individually traced to a
  line number in this pass, but implied by `STATUS_RANK`'s `"sampled"` value existing) and Phase 4
  (after distribution — `"distributed"` status).

**Reader function(s)**:
- `loadMonthManifest` (`populationStorage.ts:817-828`) — used by `loadMonthForEditing` (always,
  per `monthLoadBootSources`, `useMonthLoad.ts:37`) to decide `needsRawWorkbooks`
  (`populationStorage.ts:938`, gating whether raw JSON is worth reading at all — see raw-JSON
  artifact above) and, more broadly, to drive the wizard's phase/status display across
  `Population/index.tsx`.
- `listMonthFolders` (`populationStorage.ts:480-513`) does **not** read the manifest — it derives
  month list purely from folder names (`parseMonthFolderName`), so a folder missing its manifest
  still appears in month pickers with no manifest-derived metadata.
- Global month selector / boot-progress checklist (`useMonthLoad.ts`'s `monthLoadBootSources`,
  line 37) surfaces this file's read as a named boot-progress item ("بيانات الشهر").

**Why it exists**: The manifest is the month's status ledger (raw-saved → processed-saved →
sampled → distributed → closed) and metadata record (file names, row counts, RNG seed placeholder,
processing fingerprint) — every phase-gating decision in the wizard (can this month still be
reprocessed? is a raw-workbook read worth doing? is the month closed to writes?) reads this file,
not the population/sample/distribution files themselves, to answer "where is this month in its
lifecycle." Without it, the wizard would have no authoritative status signal and would have to
infer status by probing for the existence of other files every time.

**Lifecycle**: Created on the month's first process+save (`status: "processed-saved"`). Status
advances monotonically via `updateMonthStatus` through `sampled`/`distributed`, and can be frozen
to `closed` by `monthLock.ts` (out of this cluster's direct scope but sharing this file). A closed
month's manifest is never touched by `updateMonthStatus` again (guarded at
`populationStorage.ts:449`). If missing: `updateMonthStatus`'s inner logic treats a missing month
folder as "nothing to advance, not a conflict" (lines 438-443) — not the same as a missing
manifest inside an existing folder, which `safeReadJson` would report as `.ok=false` and
`loadMonthManifest` turns into `null` (line 826), likely stalling wizard status logic that expects
a manifest to exist for any folder that has other data. If corrupt: generic `.bak` fallback,
though a corrupt manifest mid-status-advance could in principle cause `updateMonthStatus`'s
`STATUS_RANK` read to misbehave (not traced further).

---

#### Artifact: `1-population/{month}/2-processed/replacement-index/index.manifest.json` and
`{tier}.{stageKey}.json` buckets

**UI entry point**: Same Phase 2 process+save action, as a **best-effort side effect** — never a
direct user action, and its failure is explicitly documented as non-fatal to the overall save
(comment at `populationStorage.ts:338-344`).

**Writer function(s)**:
- `rebuildReplacementIndex` (`replacementIndexStorage.ts:133-241`) — called from
  `saveMonthRunLocked` (`populationStorage.ts:345-360`) only if the just-written
  `population.final.json`'s envelope revision could be read back (`readEnvelopeRevision`, line
  346). Buckets rows by `(certScanStatus, stageKey)` (lines 163-173 of
  replacementIndexStorage.ts) into up to 10 files (`ALL_TIERS × ALL_STAGE_KEYS`, 2×5) named via
  `bucketFileName` (line 37-39), each written with `safeWriteJson` (line 184), then publishes
  `index.manifest.json` via a `casLoop` (lines 204-236) that verifies `sourceRevision` and a
  `stageMappingsHash` (so a stage-mapping-only Settings edit, which doesn't touch
  `population.final.json`'s own revision, still correctly invalidates the index — see
  `isRebuildRedundant`'s doc comment, lines 87-106).
- Also independently triggered (not from this cluster's UI) by
  `src/data/distribution/replacementCandidateLookup.ts:88` when a stale/missing index is detected
  at replacement-lookup time — a self-healing background rebuild outside the Population tab
  entirely (Employee Workspace's referral-replacement flow).

**Reader function(s)**:
- `loadReplacementIndexManifest` (`replacementIndexStorage.ts:59-70`) and `loadReplacementBucket`
  (lines 108-121) — consumed by `src/data/distribution/replacementCandidateLookup.ts` (outside
  this cluster's direct scope) to find replacement candidates for a rejected/replaced sample row
  without reading the full `population.final.json`. UI surface: Employee Workspace's referral/
  replacement approval flow (not a Population-tab screen).

**Why it exists**: Per its own file header (replacementIndexStorage.ts:1-10), this predates and is
a deliberate exception to the general large-population performance proposal's phased sequencing —
it exists so that finding replacement candidates for a rejected sample row never requires reading
the full (potentially 200k-400k row) `population.final.json`. Without it, every replacement-
candidate lookup would have to load and scan the entire population in memory, on whatever thread
performs that lookup.

**Lifecycle**: Created/rebuilt on every process+save whose revision check succeeds, and rebuilt
on-demand by the replacement-lookup path if found stale (`isReplacementIndexFresh`, lines 74-85 —
checks format version, source revision, AND stage-mappings hash). Monotonic: a rebuild with a
`sourceRevision` not strictly newer than what's published is a no-op (`isRebuildRedundant`,
lines 97-106), preventing a straggling background rebuild from clobbering a newer index. Bucket
files that shrink to zero rows on a reprocess are proactively removed via `dir.removeEntry`
(lines 187-196, best-effort). If missing: `loadReplacementIndexManifest` returns `null`
(line 66-69) and `replacementCandidateLookup.ts` presumably falls back to a full-population scan
(per `populationStorage.ts:341-344`'s comment: "the replacement flow falls back to a
full-population read when the index is missing or stale"). If corrupt: generic `.bak` fallback via
`safeReadJson`.

---

#### Artifact: `2-samples/{month}/1-main/sampling-proof.json`

**UI entry point**: Phase 3 ("سحب العينة" / draw-sample action) — written unconditionally right
after a sample draw is saved, inside the same handler as the sample-save itself. Confirmed at
`Population/index.tsx:1080`, immediately following the `sample.master.json` save block
(lines 1043-1071) inside `handleDrawSample` (line 979).

**Writer function(s)**:
- `saveSamplingProof` (`populationStorage.ts:123-133`) — `ensureMonthWritable` guard then
  `safeWriteJson(sampleDir, "sampling-proof.json", proof)`. Silent `catch { /* ignore */ }`
  (line 132), no `logError` call.
- Chain: "سحب العينة" click → `handleDrawSample` (`Population/index.tsx:979`) → (sample draw +
  `sample.master.json` save succeeds) → `saveSamplingProof(directoryHandle, monthFolderName, {
  month, year, monthFolderName, drawnAt, drawnBy, rngSeed, samplingRules, portAllocations,
  totalRequested, totalActual, certScanActual, nonCertScanActual })` (`Population/index.tsx:
  1080-1093`).

**Reader function(s)**: **None found in `src/`.** A repo-wide grep for `"sampling-proof"` finds
only the single write call site — no load function exists anywhere in the codebase. Write-only,
like the `.superseded.json` archives and source binaries.

**Why it exists**: A durable, human-auditable record of exactly how and when a sample was drawn
(RNG seed, port allocations, requested vs. actual counts, CertScan/non-CertScan split, drawn-by
user) — independent of `sample.master.json` itself, which holds the resulting rows but not this
provenance metadata in one place. Serves as an audit artifact for compliance/dispute purposes
(e.g. "prove this sample was drawn fairly with this seed") even though nothing in the app
currently displays it back to a user.

**Lifecycle**: Created on every successful sample draw for a month. Overwritten (not archived) on
a redraw — no history of prior draws' proof documents is kept once the app's own file layer is
considered (though `sample.master.json`'s own supersede/versioning, outside this cluster's direct
scope, may separately preserve draw history — not verified here). If the write fails, it's
silently swallowed with no error surfaced to the user and no ring-buffer log entry — a real gap
given this file's stated audit purpose (the one artifact in this cluster where "silently lost"
would most defeat its own reason for existing).

---

#### Orphans and asymmetries

1. **Write-only artifacts (written, never read by app code)**:
   - `*.raw.{timestamp}.superseded.json` archives (`populationStorage.ts:193-211`) — no reader
     anywhere in `src/`.
   - `risk.source.{ext}` / `bi.source.{ext}` binary workbook copies
     (`populationStorage.ts:69-84, 286-297`) — no reader anywhere in `src/`.
   - `sampling-proof.json` (`populationStorage.ts:123-133`) — no reader anywhere in `src/`.
   All three exist as disk-level audit trail / recovery artifacts, presumably intended for manual
   inspection or a future feature, not for the app's own runtime consumption. None of the three
   are wrong to have, but none currently earn their write cost through any in-app read — worth
   confirming with the product owner whether a "view original source file" / "view sampling
   proof" screen is planned, since the data is already being captured.

2. **Read-but-never-written artifact class**: none identified in this cluster — every file this
   cluster reads (`population.final.json`, raw JSONs, manifest, config, replacement index,
   sampling proof, certscan global) has a writer traced above. (The replacement index also has a
   writer *outside* this cluster's own UI — `replacementCandidateLookup.ts:88` — which is a
   cross-cluster write path worth flagging to whichever cluster owns distribution/replacement, but
   it is still a genuine writer, not an orphan read.)

3. **Divergent read paths/formats for the same artifact — `population.final.json`**: Two
   independent, differently-costed read paths exist for the identical file:
   - `loadMonthPopulationFinal` (`populationStorage.ts:606-621`) — full main-thread `JSON.parse`
     via `safeReadJson`, used by single-month Browse and `loadMonthForEditing`.
   - `loadMonthPopulationFinalRawText` (`populationStorage.ts:650-684`) — raw text only, parsed
     off-main-thread by `PopulationQueryWorker`, used exclusively by the Browse tab's worker-owned
     query path.
   These two paths also have **different corruption-recovery guarantees**: the parsed path gets
   `safeReadJson`'s full live→`.bak` fallback with content-hash validation; the raw-text path's own
   docstring (lines 638-648) explicitly documents that it does NOT repair a present-but-corrupt
   live file the way the parsed path does, because doing so would require the exact parse this
   path exists to avoid. A user could see different resilience behavior for the same underlying
   file depending on which Population sub-screen they're on when a corruption occurs.

4. **Divergent read cost profile — "all months" vs. "single month" population reads**: confirmed
   in the prior audit pass and re-verified here: `loadAllPopulationRows` /
   `loadAllSampleRows` / `loadAllRawRows` (`populationStorage.ts:568-604, 700-754, 729-754`) always
   do a full main-thread `safeReadJson` parse per month file, with no worker offload and no
   caching across calls — unlike the single-month Browse path, which was specifically
   re-engineered (per its own doc comments citing "Phase B of the large-population performance
   proposal") to avoid exactly this cost via the raw-text + worker-parse path above. Selecting
   "all months" in Browse's dataset/month picker therefore reintroduces the main-thread parse cost
   the single-month path was built to eliminate — the same file format, walked by a structurally
   different (and less-optimized) reader.

5. **Manifest status written by two different code paths with different atomicity guarantees**:
   `month.manifest.json` is written wholesale (all fields) once, by `saveMonthRunLocked`
   (`populationStorage.ts:374-396`, plain `safeWriteJson`, no CAS), and thereafter has only its
   `status`/`revision` fields advanced by `updateMonthStatus` (`populationStorage.ts:419-478`,
   full CAS/casLoop protocol with revision + `_writeToken` verification). The initial full write
   is NOT CAS-protected the way subsequent status advances are — a genuinely simultaneous
   cross-machine first-save race for the same new month is not guarded the same way a later
   status bump is (though `withResourceLock(manifestLockKey(...))` does serialize same-tab/
   same-machine writers for both). This is a real asymmetry in write-safety posture for the same
   file across its own lifecycle, not necessarily a bug (the first write has no prior state to
   race against in the same way a status advance does), but worth naming explicitly.

---

#### Artifact count

13 distinct on-disk artifact families documented above (excluding the generic `.bak`/`.tmp`
staging files, which apply uniformly to all of them per the "Generic write mechanics" section):
`config.json`, `certscan.global.json`, `risk.raw.json`, `bi.raw.json`, `*.raw.*.superseded.json`
(one family, two base names), `risk.source.*`/`bi.source.*` (one family, two base names),
`population.final.json`, `processing.summary.json`, `month.manifest.json`,
`replacement-index/index.manifest.json` + up to 10 bucket files (one family), `sampling-proof.json`.
### Traceability Matrix — Cluster 3 (Sampling → Distribution → Answers)

Read-only, grounded in code (file:line). Roles/screens named from `src/auth/tabCatalog.ts` sub-tab ids
(`ew/xray-referrals`, `ew/referral-approval`, `ew/inspection-form`) and `Population` tab phases per
`CLAUDE.md`. "ForRead" = the dedup-cached read-only API in `distributionStorage.ts`.

---

#### 1. `2-samples/{month}/1-main/sample.master.json`

**UI entry point.** Population tab, Phase 3 → "سحب العينة" (draw sample) button → `handleDrawSample` in
`src/components/Sidebar/Tabs/Population/index.tsx:979-1094`. Admin/manager/whoever holds `canDrawSample`.
Also mutated (not created) by: (a) supervisor/manager approving a replacement request on the
Referral-Approval screen (`ew/referral-approval` → `useApprovalData.ts` → `approveReplacement` →
`replacement.ts`'s `executeReplacement`), and (b) the four-eyes release-approval flow (`approveSampleMaster`,
see "Why it exists" below — **has no UI caller**, see Orphans section).

**Writer function(s).**
- Draw: `handleDrawSample` (`index.tsx:1018-1037`) → `drawSample` (`sampleAlgorithm.ts:22`) → `saveSampleMaster`
  (`sampleStorage.ts:28-43`) → `safeWriteJson`.
- Replacement append: `executeReplacement` (`distribution/replacement.ts:155-214`) → `appendSampleRow`
  (`sampleStorage.ts:222-271`, CAS loop, idempotent-by-`xrayImageId`) → `saveSampleMaster` internally
  (`sampleStorage.ts:251`).
- Four-eyes release: `approveSampleMaster` (`sampleStorage.ts:175-219`, CAS loop, "first approval wins",
  never overwrites an existing `approval`) → `saveSampleMaster` (`:199`).

**Reader function(s).** `loadSampleMaster` (`sampleStorage.ts:63-82`, tries current dir then legacy dir) is
called from: Population tab Phase 2/3 re-process guard (`index.tsx:885`, `:519`); `ReportDesigner`
`KpiRenderer.tsx:96`; Reports tab `TabView.tsx:200,225,417`; Employee Workspace `XrayInspectionResults.tsx:230`
and `XrayReferrals.tsx:438` (load for display) and `:685` (fresh pre-write ownership check, see cluster-1 note);
`ReferralApproval/useApprovalData.ts:155`; PowerBI `exportManager.ts:27`; `reopenAnswer.ts:82`;
`referral/approveReferral.ts:96,262`; `populationStorage.ts:254,766` (reprocess/overwrite guards). No
`ForRead`/cached variant exists for this file — every call is a fresh read.

**Why it exists.** The immutable(-ish) drawn sample set — the population subset actually under QC review for
the month, plus the running port/stage allocation tallies. Without it there is no sample to distribute,
answer, or report on; every downstream artifact in this cluster (`distribution.*`, mirrors, answers) is
keyed off `sample.master.json`'s `rows[]`.

**Lifecycle.** Created once per month at draw time. Updated by `appendSampleRow` (replacement rows) and by
`approveSampleMaster` (adds `approval`, both bump `revision`/`_writeToken`). Never deleted. A re-draw is
hard-blocked once any distribution event exists (`index.tsx:1004-1014`, "would orphan every existing
assignment and answer"). Missing → every downstream reader treats it as "no sample yet" (`null`/`[]` rows,
Population tab shows Phase 3 as not started). Corrupt → `safeReadJson` returns not-ok; callers vary — most
treat as "no sample" (silent), which for a month with live distribution events would be a serious
inconsistency (distribution log referencing rows that "don't exist").

---

#### 2. `2-samples/{month}/1-main/sampling-proof.json`

**UI entry point.** Same button as above — Population tab Phase 3 "سحب العينة" → `handleDrawSample`
(`index.tsx:1080-1093`), fired immediately after the `sample.master.json` save block, independent of whether
that save succeeded.

**Writer function(s).** `handleDrawSample` (`index.tsx:1080`) → `saveSamplingProof`
(`src/data/population/populationStorage.ts:123-133`) → `safeWriteJson`. Errors are swallowed
(`try { ... } catch { /* ignore */ }`, `populationStorage.ts:129-132`) — no error surfaced to the UI or log.

**Reader function(s).** **None found.** No `loadSamplingProof`/reader function exists anywhere in `src/`; grep
for the type `SamplingProof` and the literal `"sampling-proof.json"` shows only the definition and the one
write call site. This artifact is write-only in the current codebase.

**Why it exists.** Per its type shape (`month`, `year`, `drawnAt`, `drawnBy`, `rngSeed`, `samplingRules`,
`portAllocations`, totals) it duplicates a subset of `sample.master.json` as a standalone, presumably
audit-facing "proof of draw" document — but nothing in the app currently surfaces or verifies it.

**Lifecycle.** Written once per draw (best-effort, silently swallows failure). Never updated, never deleted,
never read back. If missing or corrupt: no functional impact anywhere in the app today, since nothing
consumes it.

---

#### 3. `2-samples/{month}/1-main/sampling.plan.json`

**UI entry point.** Same draw action — Population tab Phase 3 "سحب العينة" → `handleDrawSample`
(`index.tsx:1040-1059`), wrapped in its own try/catch so a plan-write failure "must not fail the draw
itself" (comment at `:1041`).

**Writer function(s).** `handleDrawSample` → `loadPriorMonthAdvisory` (switching-rule advisory) →
`buildSamplingPlan` (`samplingPlanStorage.ts:171-228`, pure) → `saveSamplingPlan`
(`samplingPlanStorage.ts:231-246`) → `safeWriteJson`.

**Reader function(s).** `loadSamplingPlan` (`samplingPlanStorage.ts:249-260`) exists and is exercised only by
`samplingPlanStorage.test.ts:146,153`. **No production/UI call site reads it back** — grep across
`src/components` and all non-test `.ts` files under `src/data` finds zero callers of `loadSamplingPlan`.

**Why it exists.** Per its own module docblock (`samplingPlanStorage.ts:1-13`): "the documented 'why N,
against what limit' that an auditor needs alongside the raw draw" — lot definition, target fraction,
risk-basis narrative, B4 switching-rule advisory (prior-month suspicion rate → tightened-review
recommendation), all bound to the same `rngSeed`/`samplingAlgorithmVersion` as the sample master. Explicitly
documented as "purely additive... never gates a draw."

**Lifecycle.** Created once per draw (best-effort). Never updated after creation (no append/patch function
exists), never deleted. Legacy months simply lack the file (documented as expected). Missing/corrupt has zero
functional impact today since no reader exists in the running app — an auditor would have to be pointed at
the raw JSON file directly, not any in-app screen.

---

#### 4. `2-samples/{month}/1-main/distribution.events/{eventId}.json`

**UI entry point.** Multiple distinct role/screen actions, all in the Population tab Phase 4 (distribution)
or Employee Workspace approval/reopen screens:
- Population tab Phase 4, single "تعيين" (assign) action → `handleAssign`
  (`useDistributionActions.ts:138-169`), role: whoever has `canDistributeSamples`.
- Phase 4, "إعادة تعيين" (reassign) → `handleReassign` (`useDistributionActions.ts:171-219`).
- Phase 4, "تعليم كمكتمل" (mark complete) → `handleMarkComplete` (`useDistributionActions.ts:221-255`).
- Phase 4, "طلب استبدال" from the distribution screen itself (supervisor-side request, distinct from the
  employee-side one below) → `handleRequestReplacement` (`useDistributionActions.ts:257-291`).
- Phase 4, "التوزيع الجماعي" (bulk assignment) → `handleApplyBulkAssignment`
  (`useDistributionActions.ts:293-340`), role: `canBulkAssign`.
- Employee Workspace, `ew/xray-referrals` screen, employee requesting a replacement/referral → resolved via
  supervisor approval (`ew/referral-approval` → `useApprovalData.ts` → `approveReferral`/`approveReplacement`
  in `data/referral/approveReferral.ts`, which append `reassigned`/`assigned`+`replaced` events).
- Employee Workspace, `ew/xray-referrals`, employee self-service reopen request → `submitReopenRequest`
  (`data/referral/requestReopen.ts:30-108`), which for `instant:true` role/feature-flag combos applies via
  `reopenSubmittedAnswer`, and for `instant:false` appends a best-effort `reopen-requested` audit event
  (`requestReopen.ts:88-105`).
- Supervisor/manager approving a reopen request on `ew/referral-approval` → `approveReopen`
  (`data/referral/approveReferral.ts:336-381`) → `reopenSubmittedAnswer` (`answers/reopenAnswer.ts`), which
  itself appends a `reopened` event when the entry was `completed` (`reopenAnswer.ts:82-109`).

**Writer function(s).** All the above funnel through `appendDistributionEvent`/`appendDistributionEvents`
(`distribution/distributionStorage.ts:264-359`) → `writeImmutableEventBatch`
(`distributionStorage.ts:36-58`, concurrency-4 worker pool) → `writeImmutableDistributionEvent`
(`distribution/distributionEventStore.ts:41-61`) → `safeWriteJson` into `distribution.events/{eventId}.json`,
verified by an immediate re-read (`:57-60`). This immutable-file write happens **before** the compatibility
projection (`distribution.log.json`) is touched.

**Reader function(s).** Never read individually by file name — always read as a directory scan via
`loadImmutableDistributionEvents` (`distributionEventStore.ts:63-79`, sorted by `eventAt`/`eventId`) or the
authoritative merge path `readCurrentDistributionSource` → `readAppendOnlyDirectory`
(`distributionStorage.ts:102-135`). Both are internal to `loadDistributionLog`
(`distributionStorage.ts:255-262`), which is the sole authoritative entry point folding events+projection+
immutable files together. Every UI/business-logic caller reaches this data only through `loadDistributionLog`
or `loadOrDeriveDistributionCurrent`/their `ForRead` siblings — no call site in `src/components` or
non-test `src/data` reads `distribution.events/` directly, bypassing the merge.

**Why it exists.** The authoritative, append-only, per-event source of truth for every assignment/
reassignment/completion/replacement/reopen transition. Because each event is its own immutably-named file,
two writers (different tabs/machines) never target the same file, avoiding the classic shared-mutable-log
race. Without it, `distribution.log.json`/`distribution.current.json` (both derived or legacy-compatible)
would have nothing authoritative to rebuild from after corruption.

**Lifecycle.** Created once per event, at the moment named above; never updated (immutable — a same-id
rewrite with different content throws `"Distribution event id collision"`, `distributionEventStore.ts:50`);
never deleted. If a file is missing after being referenced by the compatibility log, the merge still works
(compatibility log entries not backed by an immutable file are preserved as historical/legacy events). If a
file is corrupt/unreadable, `readAppendOnlyDirectory`'s `onUnreadable: "throw"` propagates as a hard error —
"no caller can derive a silently incomplete snapshot" (comment at `distributionStorage.ts:113-115`).

---

#### 5. `2-samples/{month}/1-main/distribution.log.json`

**UI entry point.** Not directly triggered by any single UI action — it is the **compatibility projection**,
written as a side effect of the *same* actions listed in artifact #4 (assign/reassign/complete/replacement-
request/bulk-assign/approve-referral/approve-replacement/approve-reopen/reopen-request), immediately after
the immutable event files for that action are durable.

**Writer function(s).** `appendDistributionEvents` (`distributionStorage.ts:283-359`), inside its `casLoop`:
reads `readProjectedEventIds` + `loadDistributionLog` (`:317-318`), computes `nextRevision`, calls
`preserveAppendedBatchOrder` (`:186-197`) to interleave the caller's batch order, then `safeWriteJson(dir,
LOG_FILE, updated)` (`:330`).

**Reader function(s).** Never read as the sole source — always merged. `loadDistributionLog`
(`distributionStorage.ts:255-262`) calls `readCurrentDistributionSource` (which reads this file via
`readCompatibilityLog`, `:91-100`) and `readLegacyDistributionLog` (unnumbered legacy folder), then
`mergeDistributionLogSources` (`:163-184`) combines both compatibility logs with the immutable events
directory via `mergeDistributionEvents` (`distributionEventStore.ts:88-122`). A cheaper stamp-only reader,
`readDistributionLogStamp` (`distributionStorage.ts:215-235`), reads this file (and the legacy one) for
revision/writeToken comparison only, skipping the full immutable-event directory scan — used inside the CAS
verify step and nowhere else. **No call site in `src/components` reads `distribution.log.json` directly** —
all consumption goes through `loadDistributionLog`/`loadDistributionLogForRead`.

**Why it exists.** Documented in CLAUDE.md and confirmed in code as "a legacy projection" — a single mutable
file that pre-A7-era code (and any tooling expecting one shared log) can still read, kept alive for backward
compatibility rather than as the source of truth. Losing it would not lose data (the immutable events
directory has everything), but would break any external/legacy tool expecting a single log file, and would
force every `loadDistributionLog` call to do a full directory scan with no cheap stamp shortcut.

**Lifecycle.** Created on the first `appendDistributionEvents` call for a month. Updated (revision bumped) on
every subsequent event batch. Never deleted. If missing, `normalizeCompatibilityLog` (`:150-153`) substitutes
an empty log (`revision: 0`) and the merge still recovers full history from the immutable events directory —
i.e. **this file can be entirely absent with zero data loss**, by design. If corrupt, `readCompatibilityLog`
throws (`"Corrupt distribution compatibility log"`) rather than silently dropping history.

---

#### 6. `2-samples/{month}/1-main/distribution.current.json`

**UI entry point.** Not directly user-triggered as a save target; it is the **rebuildable cache**, written as
a side effect of two paths: (a) the explicit `refreshDistribution` helper called after every Phase 4 mutation
in `useDistributionActions.ts` (`:104-136`, called from `handleAssign`/`handleReassign`/
`handleMarkComplete`/`handleRequestReplacement`/`handleApplyBulkAssignment`), and (b) the lazy slow-path
inside `loadOrDeriveDistributionCurrent` (`distributionStorage.ts:427-474`) whenever a reader hits a stale/
missing cache — this can fire from **any** screen that reads distribution state, not just Population tab
Phase 4 (e.g. Employee Workspace `ew/xray-referrals` simply loading the page can trigger a cache rebuild+write
if the cache was stale).

**Writer function(s).** `saveDistributionCurrent` (`distributionStorage.ts:361-371`) → `safeWriteJson(dir,
CURRENT_FILE, current)` then, **same call**, `syncSampleMirrors(...)` (side effect, see artifacts #7/#8).
Called explicitly from `refreshDistribution` (`useDistributionActions.ts:134`), and fire-and-forget
(`void saveDistributionCurrent(...).catch(logRejection(...))`) from `loadOrDeriveDistributionCurrent`
(`distributionStorage.ts:463-465`) on every cache-invalidation slow path.

**Reader function(s).** `loadDistributionCurrent` (private, `distributionStorage.ts:373-395`) is only called
from inside `loadOrDeriveDistributionCurrent` (`:438`) — never read raw by any external caller. All UI/logic
consumption is via `loadOrDeriveDistributionCurrent` (authoritative — validates `deriveVersion`,
`logRevision`, `eventSetId`, per-employee quota presence before trusting the cache; re-derives on any
mismatch) or its deduped `loadOrDeriveDistributionCurrentForRead` sibling (`:492-499`, explicitly documented
"Never use this for a fresh-read-before-write correctness check"). Call sites: Population tab Phase 4
(`useDistributionActions.ts:110`, authoritative, inside `refreshDistribution`); `XrayReferrals.tsx:443`
(`ForRead`, display) and `:687` (authoritative, pre-write ownership re-check before a replacement decision);
`XrayInspectionResults.tsx`; `ReferralApproval/useApprovalData.ts`; `referral/approveReferral.ts:108,143,268`
(authoritative — the approval flow explicitly derives fresh from the log rather than trusting this cache, per
its own comment about restored/copied workspaces, `approveReferral.ts:106-108`); `answers/reopenAnswer.ts:83`
(authoritative); Reports `TabView.tsx`, `ReportDesigner/KpiRenderer.tsx`, PowerBI `exportManager.ts`
(all `ForRead`, reporting-only).

**Why it exists.** Pure performance cache so every screen doesn't have to fold the entire event log on every
render. Without it, every distribution read (Reports, KPI, Employee Workspace) would replay the full fold on
every load — correct but slower for months with many events. Losing/corrupting it costs nothing but a
recompute: `loadOrDeriveDistributionCurrent` treats a missing/corrupt/stale cache as "re-derive."

**Lifecycle.** Created on first successful derive after any event exists. Updated on every explicit
`refreshDistribution` call and opportunistically on any stale-cache read. Never deleted. Corrupt →
`safeReadJson` inside `loadDistributionCurrent` returns not-ok, `loadOrDeriveDistributionCurrent`'s fast-path
check fails (`cached` is falsy), falls to the slow path and rewrites a fresh cache — self-healing.

---

#### 7. `2-samples/{month}/1-main/main.samples.json`

**UI entry point.** **Never written by a direct user action** — it is a pure background side effect of
artifact #6's write. Any of the Population-tab Phase 4 mutations or any screen's lazy cache rebuild
(see artifact #6's "UI entry point") indirectly triggers this write.

**Writer function(s).** `syncSampleMirrors` (`samples/sampleMirrorStorage.ts:45-94`), called only from inside
`saveDistributionCurrent` (`distributionStorage.ts:370`). Writes are gated by a **monotonic revision guard**
(`:66-69`): only written if `existingMainRevision === null || existingMainRevision < sourceLogRevision`, so an
out-of-order/stale derive can never clobber a mirror written from a newer log revision.

**Reader function(s).** `loadEmployeeSampleMirror`-adjacent — actually **no dedicated loader for
`main.samples.json` itself exists**; grep for `MAIN_SAMPLES_FILE`/`main.samples.json` shows only the write
site and the monotonic-guard read (`readMirrorRevision`, `:34-43`, used internally by `syncSampleMirrors` to
decide whether to rewrite, not exposed as a general reader). No `loadMainSamplesMirror` function exists and no
UI reads this file back. Compare with artifact #8 (per-employee mirror), which *is* read by the UI.

**Why it exists.** Per its type name and the module's stated purpose, a whole-month mirror of
`distribution.current.json`'s `entries` — but with no reader anywhere in the app, it currently duplicates
`distribution.current.json` on disk without being consumed by anything.

**Lifecycle.** Created on first `syncSampleMirrors` call for the month; updated whenever a newer
`sourceLogRevision` derive occurs; never deleted; never read back in production code (see Orphans section).

---

#### 8. `2-samples/{month}/2-employee/{username}.samples.json`

**UI entry point.** Same background trigger as artifact #7 — a side effect of `saveDistributionCurrent`
(any Phase 4 action or any lazy cache rebuild). Not a direct user-facing write.

**Writer function(s).** `syncSampleMirrors` (`sampleMirrorStorage.ts:71-93`) — buckets `current.entries` by
`entry.assignedTo`, then per employee, same monotonic-revision guard (`:81-83`) as artifact #7, written in
parallel via `Promise.all`.

**Reader function(s).** `loadEmployeeSampleMirror` (`sampleMirrorStorage.ts:96-108`) is called from:
`XrayReferrals.tsx:446` — **only as a fallback** when the authoritative derive (`loadOrDeriveDistributionCurrentForRead`,
line 443) returns null, and only for non-oversight users (`!canSeeAll`, employee's own `ew/xray-referrals`
screen); and `getUserWorkspaceFootprint` (`sampleMirrorStorage.ts:134-167`), a pre-user-deletion advisory scan
in the User Management tab's delete-user flow (reads the mirror instead of the full derived state, explicitly
documented as acceptable staleness for an advisory check, `:126-132`).

**Why it exists.** A small, employee-scoped read optimization so an employee's own sample list doesn't
require loading/deriving the whole month's distribution state — used as the fallback read path and as a cheap
footprint check before deleting a user.

**Lifecycle.** Created/updated exactly as artifact #7, per-employee. Never deleted (not even when a user is
removed — `getUserWorkspaceFootprint` exists specifically to warn about this data before deletion, but nothing
purges the mirror file itself). If missing/corrupt: `loadEmployeeSampleMirror`'s `try/catch` returns `null`
(`:101-107`), and callers fall back to either the authoritative derive (already the primary path in
`XrayReferrals.tsx`) or an empty footprint.

---

#### 9. `2-samples/{month}/2-employee/employee-answers/{username}.answers.json`

**UI entry point.** Employee Workspace, `ew/xray-referrals` screen, several distinct actions by the owning
employee (or a supervisor/manager acting for them):
- "حفظ/تقديم" (save/submit an item's answer) → `handleSave` (`XrayReferrals.tsx:529-560`).
- "طلب استبدال" (employee-side replacement request) → handler around `XrayReferrals.tsx:746`.
- "طلب إحالة" (referral request) → handler around `XrayReferrals.tsx:810`.
- Self-service reopen request (non-instant) → `submitReopenRequest` (`requestReopen.ts:69-83`) appending to
  `reopenRequests`.
- Supervisor/manager/admin coaching note ("ملاحظة جودة") → `setItemQualityNote` (`answerStorage.ts:245-262`),
  UI caller not traced in this pass but documented as independent of the referral/approval trail.
- Reopen-for-correction (supervisor/manager direct, or via approved reopen request) →
  `reopenItemAnswer`/`reopenSubmittedAnswer` (`answerStorage.ts:205-236`, `reopenAnswer.ts`).

**Writer function(s).** All funnel through the single choke point `updateEmployeeAnswerFile`
(`answerStorage.ts:127-166`, CAS loop + `ensureMonthWritable` month-lock), called by: `saveEmployeeAnswers`
(`:168-183`), `upsertItemAnswer` (`:185-197`), `reopenItemAnswer` (`:205-236`), `setItemQualityNote`
(`:245-262`), `appendReferralToEmployee`/`appendReplacementToEmployee`/`appendReopenToEmployee`
(`:265-319`, each idempotent-by-`requestId`).

**Reader function(s).** `loadEmployeeAnswers` (`answerStorage.ts:99-125`) — direct per-employee reads from
`XrayReferrals.tsx`, `XrayInspectionResults.tsx`, `reopenAnswer.ts:53`, `requestReopen.ts` (indirectly via
`reopenSubmittedAnswer`). `loadAllEmployeeFiles` (`answerStorage.ts:322-337`, directory scan, `onUnreadable:
"skip"`) — used for cross-employee aggregation by: `referralStorage.ts`'s `loadReferralLog`/
`loadReplacementLog`/`loadReopenLog` (feeding the `ew/referral-approval` supervisor screen via
`useApprovalData.ts`), `Reports/TabView.tsx`, `ReportDesigner/KpiRenderer.tsx`, `backup/backupStorage.ts`
(workspace backup), `Population/index.tsx` (likely orphan-scan/reporting), PowerBI `exportManager.ts`.

**Why it exists.** The employee's per-month record of what they answered, plus their own outgoing
referral/replacement/reopen requests — the actual QC review output the whole app exists to collect. Losing
it loses the inspection results themselves; the code explicitly reasons each employee "owns" their file
exclusively so there are no shared-file write conflicts across employees (though referral/replacement/reopen
queues share the CAS loop with the answer items themselves — see cluster-1 finding on write contention).

**Lifecycle.** Created (as an in-memory `emptyAnswerFile`) on first load if absent; first persisted on first
write. Updated on every save/submit/reopen/note/request action, `revision` monotonically incremented. Never
deleted (explicitly preserved even across user deletion — `getUserWorkspaceFootprint` in artifact #8 exists
specifically to flag `answerFileMonths` that "must be preserved regardless"). Missing → `emptyAnswerFile`
default, employee sees a blank slate (no data loss signal). Corrupt → `safeReadJson` not-ok →
`loadEmployeeAnswers`'s catch also returns `emptyAnswerFile` (via the legacy-dir fallback path,
`:113-124`) — i.e. **a corrupt answers file silently degrades to "no answers yet" with no error surfaced to
the UI**, which for a file holding submitted QC results is a meaningful blind spot.

---

#### 10. `2-samples/{month}/1-main/approvals/{supervisorUsername}.decisions.json`

**UI entry point.** Employee Workspace, `ew/referral-approval` screen, supervisor/manager/admin clicking
"اعتماد" (approve) or "رفض" (deny) on a pending referral/replacement/reopen request → `useApprovalData.ts`'s
`approveReferral`/`denyReferral`/`approveReplacement`/`denyReplacement`/`approveReopen`/`denyReopen`
(`useApprovalData.ts:202-390`), which call into `data/referral/approveReferral.ts`'s functions of the same
names.

**Writer function(s).** `updateReferralStatus`/`updateReplacementStatus`/`updateReopenStatus`
(`referral/referralStorage.ts:62-76,138-153,192-207`) all delegate to `appendDecisionEvent`
(`approvals/approvalStorage.ts:96-154`) — `withResourceLock` (same-tab serialization) wrapping a `casLoop`;
each new event is B5 hash-chained to the previous one via `previousDecisionHash = hashDecisionEvent(lastEvent)`
(`:119-124`), stamped server-side from stored state, never trusted from the caller.

**Reader function(s).** `loadSupervisorDecisions` (single supervisor, `approvalStorage.ts:55-77`) — used
internally. `loadAllSupervisorDecisions` (`:80-94`, directory scan) — used by `referralStorage.ts`'s
`loadReferralLog`/`loadReplacementLog`/`loadReopenLog` (feeding the `ew/referral-approval` screen's request
list and effective-status join), and directly by `approveReferral.ts` at steps 5a/5c (cross-reviewer guard
and first-wins reconciliation, re-scanning every supervisor's file immediately before and after writing a
decision). `verifyDecisionChain` (`approvalStorage.ts:27-34`) exists to detect a broken hash chain but **no
call site invokes it in production code** — grep shows only its own definition; the tamper-evidence mechanism
is built but nothing currently verifies it at read time (see Orphans).

**Why it exists.** Records who approved/denied which referral/replacement/reopen request and when, joined
against the requester's file to produce the "effective status" the approval screen shows. The B5 hash chain
makes post-hoc tampering with a supervisor's own decision history detectable (tamper-evident, not
tamper-proof — no secret key, per the code comment). First-wins-by-`reviewedAt` resolution
(`effectiveDecision`, `:186-195`) is what makes the outcome deterministic when two supervisors both act on the
same request from different machines.

**Lifecycle.** Created on first decision by that supervisor. Updated (appended) on every subsequent decision
by the same supervisor, `revision` incremented. Never deleted. Missing → `loadSupervisorDecisions` returns an
empty-decisions default (`:70-76`); a request simply shows as having no decision from that supervisor yet, not
an error. Corrupt → same fallback via the inner `try { } catch { /* file may not exist yet */ }` — **a
genuinely corrupt decisions file is silently treated identically to "no decisions yet,"** which would make a
previously-recorded approval/denial disappear from the effective-status computation without any error
surfaced.

---

#### Orphans and asymmetries

1. **`sampling-proof.json` — write-only, zero readers.** No `loadSamplingProof` function exists anywhere in
   `src/`. Written best-effort (errors silently swallowed, `populationStorage.ts:129-132`) on every sample
   draw and never consumed. Either dead weight that should be removed, or a genuinely missing "auditor views
   proof" screen that was never built.

2. **`sampling.plan.json` — write-only in production.** `loadSamplingPlan` (`samplingPlanStorage.ts:249`)
   exists and is unit-tested, but has zero non-test call sites. The A1/B4 documentation purpose ("the
   documented 'why N, against what limit' that an auditor needs") is unmet in the actual UI — an auditor has
   no in-app screen showing this file's contents today.

3. **`approveSampleMaster` (the A3 four-eyes sample-release approval) has no UI caller.** Grep across all of
   `src/components` and non-test `src/data` finds zero call sites for `approveSampleMaster` — only
   `approveSampleMaster.test.ts` exercises it. The CAS-safe, idempotent, "first approval wins" release-gate
   logic is fully implemented and tested but the product does not currently expose a button/screen that
   invokes it. `SampleApproval`'s doc comment itself says "Wave B gates the UI on this field" (`sampleTypes.ts:33-37`)
   — this appears to be a genuinely unfinished feature, not a design choice.

4. **`main.samples.json` (whole-month mirror) has no reader at all**, unlike its per-employee sibling
   (`{username}.samples.json`, which XrayReferrals.tsx and getUserWorkspaceFootprint both read). It is written
   on every distribution-current cache refresh (with the same monotonic-revision guard as the per-employee
   mirrors) but nothing in the app reads it back — a pure write-amplification cost with no current payoff.

5. **`verifyDecisionChain` (B5 tamper-evidence) is built but never invoked.** The hash-chain is written
   correctly on every decision append (`appendDecisionEvent`), but no reader — not `loadReferralLog`, not
   `useApprovalData.ts`, not any UI screen — ever calls `verifyDecisionChain` to check it. The tamper-evidence
   mechanism currently has no consumer, so a broken chain would go undetected by the running app.

6. **Mirror freshness is entirely implicit, not an explicit invariant** (both `main.samples.json` and
   per-employee mirrors, artifacts #7/#8). They only refresh as a side effect of `saveDistributionCurrent`,
   which itself only fires from an explicit Phase-4 `refreshDistribution` call or an opportunistic
   cache-staleness rebuild inside `loadOrDeriveDistributionCurrent`. There is no code path that says "an event
   was appended, therefore resync mirrors" directly — it's transitively true only because appending an event
   also invalidates the `distribution.current.json` cache, which *may* get rebuilt on the next read, which
   *then* syncs mirrors. A month whose cache stays valid indefinitely (no further stale-triggering reads)
   would never resync `main.samples.json` again after its last write, with nothing tracking or bounding that
   staleness window.

7. **Corrupt-vs-missing conflation, repeated across the cluster, silently loses signal.** `loadEmployeeAnswers`
   (answers file) and `loadSupervisorDecisions` (decisions file) both collapse "file corrupt" and "file never
   existed" into the same empty-default fallback (`answerStorage.ts:113-124`, `approvalStorage.ts:64,69`
   catch blocks). A previously-written, now-corrupted answers file or decisions file would present identically
   to "employee/supervisor has done nothing yet" — for QC answers and approval decisions specifically, that's
   a loss of exactly the audit trail this cluster exists to preserve, with no error surfaced anywhere in the
   read path (contrast with `distribution.events/` and `distribution.log.json`, which both throw loudly on
   corruption instead).

8. **Format/path asymmetry between `sample.master.json` writers and one reader's freshness assumption.**
   `referral/approveReferral.ts` explicitly documents (`:106-108`) that it deliberately avoids trusting
   `distribution.current.json` even when its revision metadata matches, specifically citing "a restored or
   manually copied workspace" as a scenario where the cache's stamped revision can lie. This is a correct,
   defensive read pattern, but it also means the two-tier `ForRead`/authoritative API split documented for
   `distributionStorage.ts` is not actually sufficient on its own to prevent staleness bugs — this call site
   had to go one level further and re-derive from the log directly rather than trust *any* cached artifact,
   which is a stronger discipline than the `ForRead` naming convention alone communicates to other callers.
### Cluster 4 traceability matrix — reporting / reportDesigner / powerbiExport / templates

Read-only audit. Every claim below is grounded in code actually read (paths + line numbers cited).
Two artifact classes are covered: (A) files persisted to the workspace disk, (B) generated report
editions that are **not** persisted (produced into a new tab or a Blob download only) — the owner
specifically asked these be documented as "artifacts" too.

---

#### A. Files persisted to the workspace

##### A1. `4-reports/…/designs/designs.index.json`

- **UI entry point:** Reports tab → "مصمم التقارير" sub-tab (`ReportDesignerTab`, mounted by `ReportsTab` in `src/components/Sidebar/Tabs/Reports/TabView.tsx:1258-1274`) → list view. Written as a side effect of three user actions in `src/components/Sidebar/Tabs/ReportDesigner/TabView.tsx`: clicking "إنشاء" (`handleCreate`, lines 635-657), the debounced/explicit "حفظ" while a design is open (`performSave`/`handleExplicitSave`, lines 149-175), and "حذف" via the confirm dialog (`handleDelete`, lines 674-690).
- **Writer function(s):** `saveDesign()` → `updateDesignIndex()` (`src/data/reportDesigner/storage/reportDesignStorage.ts:133-161`, `:43-73`); `deleteDesign()` → `updateDesignIndex()` (`reportDesignStorage.ts:197-224`). Call chain: `TabView.tsx handleCreate/performSave/handleDelete` → `saveDesign`/`deleteDesign` (`reportDesignStorage.ts`) → `updateDesignIndex` → `casLoop` → `safeWriteJson`.
- **Reader function(s):** `loadDesignIndex()` (`reportDesignStorage.ts:185-195`), called from `TabView.tsx:565` (on mount / `directoryHandle` change, populates the list view) and `TabView.tsx:687-689` (refresh after delete). Sole consumer surface: the Report Designer list view (cards grid).
- **Why it exists:** Lets the list view enumerate saved designs (name, version, `updatedAt`) without opening every `{reportId}.json` — a cheap manifest. Without it, the list view would have to read every design file just to render its cards.
- **Lifecycle:** Created on first design save in a workspace (`getDirectoryHandle(..., {create:true})` in `getDesignsDir`, `reportDesignStorage.ts:23-28`); updated on every save/delete; never explicitly deleted (empty `{designs:[]}` is a valid terminal state after the last design is removed). CAS-protected (`revision`/`_writeToken`) but with **no delayed re-verify** — the code comment (lines 37-41) accepts this because "a transient one-write-behind entry self-heals on the next save." If missing/corrupt, `safeReadJson` failure falls back to `{designs: []}` (line 191) — an empty list, not an error; existing `{reportId}.json` files are NOT rediscovered automatically (no directory scan fallback observed).

##### A2. `4-reports/…/designs/{reportId}.json`

- **UI entry point:** Same Report Designer sub-tab. Created by "إنشاء" (`handleCreate`, `TabView.tsx:635-657`); updated by every canvas edit via an 800ms debounced autosave (`useEffect` at `TabView.tsx:106-121`) or explicit "حفظ" (`handleExplicitSave`, lines 169-175); also flushed on unmount/tab-close via `registerPendingSaveFlush` (lines 130-147, so an edit <800ms before navigating away isn't lost).
- **Writer function(s):** `saveDesign()` → `saveDesignFile()` (`reportDesignStorage.ts:84-131`), called from `TabView.tsx performSave` (line 162). Chain: canvas element mutation (`addElement`/`updateElement`/`handleElementChange` etc., `TabView.tsx:181-357`) → `setDoc` → debounce effect → `performSave` → `saveDesign` → `saveDesignFile` → `casLoop` → `safeWriteJson`.
- **Reader function(s):** `loadDesign()` (`reportDesignStorage.ts:170-183`), called from `TabView.tsx:664` (`handleOpen`, opening a design into the editor) and `TabView.tsx:591` (background `Promise.all` over the whole index to populate card thumbnails via `Canvas` in "view" mode, lines 585-598, 800-813).
- **Why it exists:** The actual canvas document (pages/elements/styles) for one custom report design. Without it the design simply doesn't exist; deleting it (with no index entry) would silently orphan an index row that opens to a "not found" state.
- **Lifecycle:** Created on "إنشاء"; updated continuously while the editor is open (debounced); superseded in place on every save (no version history kept beyond the `revision` counter — old content is not retained anywhere, unlike templates' tombstone pattern). Deleted via `removeEntry` when available, else tombstoned in place with `{deleted:true, reportId, deletedAt}` (`reportDesignStorage.ts:208-216`) — note this is a **different, weaker** tombstone shape than templates' `.deleted.bak.json` (see Orphans/Asymmetries). CAS with a delayed re-verify closure (lines 110-121) — the stronger of the two designer files, "where real content divergence would actually matter" (doc comment, lines 78-83).

##### A3. `6-templates/templates.index.json`

- **UI entry point:** EmployeeWorkspace tab → "ew/inspection-form" sub-tab, which renders `Tabs/TemplateBuilder/TabView.tsx` (`TemplateBuilderTab`). Written as a side effect of "حفظ" (`handleSave`, lines 252-284) and "حذف" (`handleDelete`, lines 286-...) on a template.
- **Writer function(s):** `saveTemplate()` → `updateTemplateIndex()` (`src/data/templates/templateStorage.ts:111-145`, `:20-50`); `deleteTemplate()` → `updateTemplateIndex()` (lines 177-232). Chain: `TemplateBuilderTab.handleSave` (`TabView.tsx:267`) → `saveTemplate` → `updateTemplateIndex` → `casLoop` → `safeWriteJson`.
- **Reader function(s):** `loadTemplateIndex()` (`templateStorage.ts:165-175`) — four call sites: `TemplateBuilderTab` on mount (`TabView.tsx:183-185`, populates its own list) and after save/delete (lines 270, 297); `XrayReferrals.tsx:250-252` (populates the "نموذج الفحص" dropdown for the inspector who's about to set/apply the active template); no read found in `XrayInspectionResults.tsx` (it reads the *selection* + the one selected template directly, not the full index — see A5).
- **Why it exists:** Cheap manifest so both the Template Builder's own list and the XrayReferrals template-picker dropdown can be populated without loading every `{templateId}.json`.
- **Lifecycle:** Created on first template save; updated on every save/delete; empty `{templates:[]}` is a valid terminal state. Same CAS-without-delayed-reverify pattern as A1, same missing/corrupt fallback (`{templates: []}`, line 171).

##### A4. `6-templates/{templateId}.json`

- **UI entry point:** `TemplateBuilderTab` "إنشاء نموذج جديد" / "إنشاء نموذج افتراضي" (`handleCreate`/`handleCreateDefault`, lines 198-227) opens the editor with a new in-memory schema; "حفظ" (`handleSave`, lines 252-284) persists it.
- **Writer function(s):** `saveTemplate()` → `saveTemplateFile()` (`templateStorage.ts:59-100`), called from `TabView.tsx:267`. `handleSave` bumps `version` itself before calling save: `version: mode === "create" ? 1 : (schema.version ?? 0) + 1` (`TabView.tsx:263`) — this is the **one place** `TemplateSchema.version` is actually incremented; `saveTemplateFile` itself only manages the separate CAS `revision` field, never touches `version`.
- **Reader function(s):** `loadTemplate()` (`templateStorage.ts:147-163`) — read by: `TemplateBuilderTab.handleEdit` (`TabView.tsx:234`, opens a template for editing); `XrayReferrals.tsx:235` inside `applyTemplate()` (loads the schema body once an id is chosen, to drive the inspection form's visible fields); `XrayInspectionResults.tsx:244` (loads the *currently selected* template to render read-only inspection results/answers against its field labels); `Reports/TabView.tsx:234` inside `loadExecInput()` (loads the active template so `buildExecutiveReportRows` can resolve free-text field labels → `fieldId`s via `createFieldResolver`, `executiveReportData.ts:28-34` — this is what lets the executive report / KPI / PowerBI paths interpret answers keyed by label).
- **Why it exists:** The actual inspection-form schema (phases, fields, conditional visibility) inspectors fill out, and that every downstream reporting path (executive rows, KPI cards, PowerBI export) needs to map free-text answer labels back to semantic fields (`hasImageLabel`, `noImageReasonLabel`, etc. in `ExecutiveReportFieldMappings`). Without it, `XrayReferrals`/`XrayInspectionResults` have no form to render, and `buildExecutiveReportRows` falls back to `config.expertResultFieldId` alone with no label-based resolution (rows would show mostly `null` for image-quality/marking/suspicion fields).
- **Lifecycle:** Created on first save (version 1); every subsequent save bumps `version` (see above) and the CAS `revision`. On delete (`deleteTemplate`, `templateStorage.ts:177-232`): the live document is first archived as `{templateId}.deleted.bak.json` (a full snapshot, `{...templateResult.value, deletedAt}}`, lines 189-194), then the live file is removed via `removeEntry` (or, if unsupported, tombstoned in place as `{deleted:true, templateId, deletedAt}`, lines 219-224) — so a delete can leave up to two artifacts (the `.deleted.bak.json` archive AND, on `removeEntry`-unsupported browsers, a tombstoned original). If the active `template.selection.json` pointed at the deleted id, it's cleared to `""` in the same locked operation (lines 199-210) — see A5.

##### A5. `6-templates/template.selection.json`

- **UI entry point:** EmployeeWorkspace → "ew/xray-referrals" (`XrayReferrals.tsx`) → the "نموذج الفحص" template-select control → `handleTplSelect` (line 525-527) → `applyTemplate(id, canSetTemplate)` (lines 232-247). Only saved when `shouldSave`/`canSetTemplate` is true (a permission-gated actor actively choosing/changing the active template) — loading the page and auto-re-applying a previously saved selection (`useEffect` at lines 253-257) passes `shouldSave=false` and does NOT re-write the file.
- **Writer function(s):** `saveInspectionTemplateSelection()` (`src/data/templates/templateSelectionStorage.ts:40-94`), called from `XrayReferrals.tsx applyTemplate` line 237. Also cleared (not user-initiated) by `deleteTemplate()` (`templateStorage.ts:199-210`) when the active selection points at the template being deleted.
- **Reader function(s):** `loadInspectionTemplateSelection()` (`templateSelectionStorage.ts:25-38`) — read by: `XrayReferrals.tsx:253` (on mount, to auto-apply the previously chosen template); `XrayInspectionResults.tsx:231` (to resolve which template's field labels to render against submitted answers); `Reports/TabView.tsx:227` inside `loadExecInput()` (to resolve `templateSelection.templateId` before loading the template body for `buildExecutiveReportRows`, line 233-235) — this is the same `loadExecInput` used by every "generate" action for sample/distribution/executive/management reports AND by `KpiRenderer.tsx` (indirectly, since `useExecutiveRows()` builds rows the same way but passes `template: null` explicitly — see Orphans below, this is an asymmetry).
- **Why it exists:** A single, global (not per-month), shared pointer to "which inspection template is currently active" so referral entry, inspection results display, and every reporting path agree on one form. Without it, `XrayReferrals`/`XrayInspectionResults` would have no way to know which of possibly several saved templates governs the current inspection workflow.
- **Lifecycle:** Created on first template selection; updated whenever a permissioned user changes the active template; cleared to `{templateId: "", ...}` (not deleted) when the pointed-at template is deleted. CAS with delayed re-verify (`templateSelectionStorage.ts:65-77`), locked under `template-selection:rmw` (line 49). Missing/corrupt → `loadInspectionTemplateSelection` returns `null` (line 34), which every reader treats as "no active template" (forms render empty/gated states).

##### A6. `6-templates/{templateId}.deleted.bak.json`

- **UI entry point:** `TemplateBuilderTab` "حذف" button → confirm → `handleDelete` (`TabView.tsx:286-...`) → `deleteTemplate`.
- **Writer function(s):** `deleteTemplate()` (`templateStorage.ts:177-232`), specifically lines 189-194: `safeWriteJson(dir, \`${templateId}.deleted.bak.json\`, {...templateResult.value, deletedAt: ...})`. Not CAS-protected itself (single write, no read-modify-write needed for a fresh tombstone name).
- **Reader function(s):** **None found.** No call site anywhere in `src/` reads a `*.deleted.bak.json` file back (no restore/undelete UI, no admin recovery tool visible in this cluster). It is a write-only forensic/manual-recovery artifact — an admin would have to open the workspace folder directly and rename the file back to `{templateId}.json` to "undelete" a template; nothing in-app does this.
- **Why it exists:** Best-effort audit trail / manual-recovery safety net before an irreversible template delete, given there's no in-app undo. Without it, a mistaken delete would be unrecoverable (short of restoring from the `safeWriteJson` `.bak` backup layer, which is a different, lower-level mechanism scoped to `template.selection.json`/index files, not deleted templates).
- **Lifecycle:** Created exactly once per delete of a given `templateId` (a second delete of the same id, after re-creation, would overwrite the earlier tombstone — `getFileHandle(..., {create:true})` semantics inside `safeWriteJson`, not append/versioned). Never updated, never programmatically deleted.

##### A7. `6-templates/deck2.style-choices.json`

- **UI entry point:** Reports tab → "التقرير التنفيذي" card / KPI dashboard toolbar → "تخصيص تصميم العرض" (admin-only, `isAdmin` gate: `Reports/TabView.tsx:650-661` and `992-1003`) → opens `DeckDesignCustomizer` (`Reports/DeckDesignCustomizer.tsx`) → its "حفظ" button → `handleSave` (lines 85-96).
- **Writer function(s):** `saveDeckStyleChoices()` (`src/data/reporting/executive/deck2/styleChoices.ts:40-97`), called from `DeckDesignCustomizer.tsx:93`. The choices themselves accumulate in `pendingChoices.current` (a ref, not saved per-click) from `postMessage` events sent by the live-preview iframe's slide variant-cycle switcher (`onMessage` handler, `DeckDesignCustomizer.tsx:46-55`, listening for `{type: "deck2-style-choice", slideId, variantIndex}`) — so the actual write only happens on the explicit "حفظ" click, batching however many slide-variant choices were cycled during the session.
- **Reader function(s):** `loadDeckStyleChoices()` (`styleChoices.ts:28-38`) — read by: `DeckDesignCustomizer.tsx:36` (to seed the customizer with previously saved choices); `Reports/TabView.tsx:330` inside `handleExport("deck")` and `:451` inside `generate("executive-deck")` — both pass `saved?.choices` into `openExecutiveDeckV2`, so every real (non-preview) executive-deck generation applies the admin's saved per-slide style choices.
- **Why it exists:** Lets an admin pick, per deck2 slide id, which of that slide's variant renderings (0-3, e.g. table vs ledger vs briefing vs grid layouts — see `slideKit.ts`/`levelAccuracySlideBuilders`'s `bodyVariants` array) is the one shown to end users, globally and across months (comment `styleChoices.ts:9-11`: "Global (not per-month)"). Without it, every deck2 generation would fall back to variant index 0 for every slide (the default when `styleChoices` is `{}`).
- **Lifecycle:** Created on first "حفظ" in the customizer; updated on subsequent saves (full replace of the `choices` map, not a merge against what's on disk — though the CAS loop still re-reads-and-overwrites for conflict detection, `styleChoices.ts:53-61`, the *value* written is always the caller's full local `pendingChoices.current`, so two admins editing concurrently on different slides would have the second save's full local state win, potentially dropping the first admin's un-reloaded local edits — see Orphans/Asymmetries). Never deleted in-app. Missing/corrupt → `loadDeckStyleChoices` returns `null` (line 36), all readers fall back to `{}` (empty choices → all slides render variant 0).

##### A8. `5-system/powerbi-export/{month}/population.csv`

- **UI entry point:** Reports tab → "التقارير" section → "تصدير Power BI / CSV" card → "تصدير" button → `handlePbiExport()` (`Reports/TabView.tsx:358-376`).
- **Writer function(s):** `runPowerBiExport()` (`src/data/powerbiExport/exportManager.ts:22-49`) → `writeCsvExport()` (`src/data/powerbiExport/exportWriter.ts:46-95`) → `writeTextFile()` (lines 38-44, plain `createWritable`, no CAS — single-shot export, not shared multi-writer state). Row source: `buildExecutiveReportRows()` called directly inside `exportManager.ts:32-40` (fresh load of population/sample/distribution/employee-files, NOT reusing any cached model from the Reports tab's own `model` state).
- **Reader function(s):** **None in-app.** This file is explicitly meant for an external consumer (Power BI Desktop, per the bundled `README.txt`, A10). No code in `src/` reads it back.
- **Why it exists:** Lets the whole month's enriched population (same row shape/semantics as the executive report — `POPULATION_HEADERS` in `exportManager.ts:12-20` is a fixed subset of `ExecutiveReportRow` fields) be modeled in Power BI outside the app.
- **Lifecycle:** Regenerated in full on every "تصدير" click (`getFileHandle(..., {create:true})` overwrite semantics, `exportWriter.ts:39`) — no versioning, no history; each export simply replaces the prior file for that month. Missing/corrupt is irrelevant to in-app behavior (nothing reads it back); only matters to whatever the user has open in Power BI.

##### A9. `5-system/powerbi-export/{month}/sample.csv`

- Same UI entry point, writer chain, and lifecycle as A8 — written in the same `writeCsvExport()` call (`exportManager.ts:45-48`), as `allRows.filter(r => r["selectedInSample"] === true)` (line 43), i.e. a pure client-side filter of the exact same `execRows` array used for `population.csv`, not a separate load/build. No in-app readers.

##### A10. `5-system/powerbi-export/{month}/README.txt`

- **UI entry point:** Same "تصدير" click as A8/A9 — written unconditionally as part of the same `writeCsvExport()` call (`exportWriter.ts:61-87`).
- **Writer function(s):** `writeTextFile()` (`exportWriter.ts:38-44`), content built inline (bilingual AR/EN import instructions + a manifest of the files just written + an `exportedAt` timestamp).
- **Reader function(s):** None in-app (by definition — it's instructions for a human opening Power BI Desktop). The Reports tab UI does separately render its own copy of "which files were exported" from the returned `ExportManifest` (`Reports/TabView.tsx:1167-1206`, the `pbiResult` panel with a "نسخ" path-copy button) — that's a distinct in-memory read of the function's *return value*, not a re-read of the file from disk.
- **Why it exists:** Human-readable onboarding for whoever opens the export folder in Power BI Desktop, so the CSVs aren't dropped with zero context.
- **Lifecycle:** Regenerated (overwritten) on every export, same as A8/A9.

---

#### B. Generated reports (never written to the workspace)

For every edition below: the destination is either (i) a new same-origin tab via `document.write()` (`writeReportToWindow`, `src/data/reporting/htmlReport.ts:45-61`), opened synchronously via `openReportWindow()` *before* the (possibly async/chunked) HTML build runs so the click's transient user-activation isn't lost (`htmlReport.ts:17-27`, `writeOrCloseOnFailure`, lines 90-109); or (ii) a `Blob` file download (`downloadHtml`, `htmlReport.ts:63-73`) as the fallback if the popup was blocked, or as the primary path for `.xlsx` (via SheetJS `XLSX.writeFile`, which itself triggers a browser download, not a workspace write). None of these editions ever touch `DirectoryHandleLike`/`safeWriteJson`.

##### B1. Sample report — document (HTML, A4)

- **UI control:** Reports tab → "تقرير العينة" card → format toggle set to "تقرير تفصيلي" (document) → "التصدير", or the "تقرير العينة" quick-action button (`Reports/TabView.tsx:1151-1154`, both routing through `generate("sample")`, lines 386-415).
- **Builder function:** `openSampleReport()` (`src/data/reporting/sampleReport.ts:586-589`) → `buildSampleDocument()` (lines 429-443) → `computeSampleLineage()` + `sampleDocPages()` (chunked, `await yieldToMain()` after every page, lines 191-301).
- **Destination:** New tab via `openReportWindow`/`writeOrCloseOnFailure` (`sampleReport.ts:587-588`).
- **Input required:** `loadMonthForEditing()` (population rows + sample + manifest) plus two revision reads (`loadMonthPopulationFinalRevision`, `loadSampleMasterRevision`) for the source-revision footer — assembled in `generate()`'s `sample`/`sample-xlsx`/`sample-deck` branch (`Reports/TabView.tsx:386-402`).

##### B2. Sample report — deck (HTML, 16:9)

- **UI control:** Same card, format = "عرض تقديمي" → `generate("sample-deck")`.
- **Builder function:** `openSampleDeck()` (`sampleReport.ts:591-594`) → `buildSampleDeck()` (lines 445-455) → `sampleDeckSlides()` (yields after each of 5 slides, lines 331-421).
- **Destination:** New tab, same mechanism as B1.
- **Input required:** Same `sampleInput` as B1 (population + sample + manifest + revisions).

##### B3. Sample report — Excel workbook

- **UI control:** Same card, format = "بيانات (Excel)" → `generate("sample-xlsx")`.
- **Builder function:** `buildSampleXlsx()` (`sampleReport.ts:463-568`) — 6 sheets (lineage summary, received/processed/strata/stages/drawn), chunked row build for Sheet 2 (`EXPORT_CHUNK_SIZE = 1000`, yields, lines 461, 497-508), plus an optional source-revisions sheet.
- **Destination:** Browser file download via `XLSX.writeFile(wb, ...)` (line 567) — SheetJS's own download mechanism, not `htmlReport.ts`.
- **Input required:** Same `sampleInput` as B1/B2.

##### B4. Distribution report — document

- **UI control:** "تقرير التوزيع" card, document format, or the "تقرير التوزيع" quick action → `generate("distribution")` (`Reports/TabView.tsx:416-441`).
- **Builder function:** `openDistributionDocument()` (`src/data/reporting/distributionReport.ts`, imported dynamically at `Reports/TabView.tsx:438`).
- **Destination:** New tab (same `openReportWindow`/`writeOrCloseOnFailure` pattern, confirmed by `distributionReport.ts:17` importing those exact helpers from `./htmlReport`).
- **Input required:** `loadSampleMaster` + `loadOrDeriveDistributionCurrentForRead` (current distribution state) + display-name map + two revisions (sample, distribution-current) — `Reports/TabView.tsx:417-428`.

##### B5. Distribution report — deck

- **UI control:** Same card, deck format → `generate("distribution-deck")` → `openDistributionDeck()`.
- **Destination:** New tab.
- **Input required:** Same as B4.

##### B6. Distribution report — Excel workbook

- **UI control:** Same card, xlsx format → `generate("distribution-xlsx")` → `buildDistributionXlsx()`.
- **Destination:** Browser download (SheetJS).
- **Input required:** Same as B4.

##### B7. Executive report — document

- **UI control:** Featured "التقرير التنفيذي" card (document format) or the KPI-dashboard toolbar's "فتح التقرير التفصيلي (HTML)" button (`Reports/TabView.tsx:630-639`, `handleExport("document")`) or the "التقرير التنفيذي" quick action.
- **Builder function:** `openExecutiveReport()` (`src/data/reporting/executive/index.ts:40-50`) → `buildExecutiveReport()` (lines 19-30) → `buildReportModel()` + `buildDocumentSlides()` (chunked).
- **Destination:** New tab.
- **Input required:** Full `ExecutiveReportInput` via `loadExecInput()` (`Reports/TabView.tsx:221-255`) — population, sample, all employee answer files, resolved template (via selection), distribution, plus source revisions for population/sample/distribution.

##### B8. Executive presentation — deck v2 (the live default)

- **UI control:** KPI-dashboard toolbar "فتح العرض التنفيذي (HTML)" (`handleExport("deck")`, line 645-649) or the "التقرير التنفيذي" card's deck format → `generate("executive-deck")` (lines 450-454).
- **Builder function:** `openExecutiveDeckV2()` (`src/data/reporting/executive/deck2/index.ts`, imported dynamically), called with the admin's saved `deck2.style-choices.json` (`saved?.choices`, A7) applied.
- **Destination:** New tab.
- **Input required:** Same `ExecutiveReportInput` as B7, plus A7's saved style choices (falls back to `{}` if none saved or no workspace).

##### B9. Executive presentation — deck v1 (reference/comparison edition, not user-facing)

- **UI control:** **None found in the shipped Reports tab.** `executive/deck/index.ts:1-9` states explicitly: "REFERENCE EDITION (v1). As of 2026-07-14 the Reports tab exports deck2 instead; this edition is kept for comparison and the dev preview (`/deck-preview.html`) only." No call site of `openExecutiveDeck`/`buildExecutiveDeck` found under `src/components/`.
- **Builder function:** `buildExecutiveDeck()`/`openExecutiveDeck()` (`executive/deck/index.ts:20-41`).
- **Destination:** New tab (same `openOrDownload` helper), but only reachable via the standalone `/deck-preview.html` dev entry point, not the production Reports UI.
- **Input required:** Same `ExecutiveReportInput` shape as B7/B8, supplied by whatever loads `/deck-preview.html` (outside this cluster's UI scope).

##### B10. Executive report — Excel workbook

- **UI control:** "التقرير التنفيذي" card xlsx format, or KPI-dashboard "بيانات التقرير (Excel)" button (`handleExport("xlsx")`, lines 667-671) → `buildExecutiveXlsx()`.
- **Destination:** Browser download (SheetJS, via `executive/workbook/workbook.ts`).
- **Input required:** Same `ExecutiveReportInput` as B7.

##### B11. Management report — document

- **UI control:** "التقرير الإداري"-labeled card (labels-driven title, `labels.mgmt_report_title`), document format → `generate("management")` → `openManagementReport()` (synchronous, no `await` — `Reports/TabView.tsx:473-475` calls it without `await`, unlike every other edition).
- **Destination:** New tab.
- **Input required:** Same `loadExecInput()` as B7/B8/B10 — `generate()`'s `management`/`management-xlsx`/`management-deck` branch reuses it (lines 460-462).

##### B12. Management report — deck

- **UI control:** Same card, deck format → `generate("management-deck")` → `openManagementDeck()`.
- **Destination:** New tab.
- **Input required:** Same as B11.

##### B13. Management report — Excel workbook

- **UI control:** Same card, xlsx format → `generate("management-xlsx")` → `buildManagementWorkbook()` (also called without `await` in `Reports/TabView.tsx:465-466`, consistent with B11 — SheetJS's `XLSX.writeFile` is itself synchronous/fire-and-forget for the download trigger).
- **Destination:** Browser download (SheetJS).
- **Input required:** Same as B11.

---

#### Orphans and asymmetries

1. **`REPORT_SCHEMA_VERSION` (`reportTypes.ts:1`) and `TemplateSchema.version` are persisted with no runtime branching.** Confirmed again in this pass: `reportDesignStorage.ts` never reads or switches on `REPORT_SCHEMA_VERSION`; `templateStorage.ts`'s `saveTemplateFile` never inspects `schema.version` (only `TemplateBuilderTab.handleSave`, `TabView.tsx:263`, increments it, purely as a display/audit counter). Neither field gates any parsing/migration logic anywhere in this cluster.

2. **`{templateId}.deleted.bak.json` is write-only** (A6) — created by `deleteTemplate`, never read by any code path. It's a manual-recovery artifact with no in-app recovery UI; an admin must restore it by hand outside the app.

3. **`5-system/powerbi-export/{month}/*` (A8-A10) are write-only from the app's perspective** — by design (external Power BI consumption), but worth flagging explicitly since it's the one artifact class in this cluster where "no reader" is the intended, not accidental, state.

4. **Tombstone format mismatch between designs and templates.** Deleting a design (`reportDesignStorage.ts:208-216`) tombstones in place as `{deleted:true, reportId, deletedAt}` — overwriting the original content entirely (no snapshot of the deleted design body is kept anywhere). Deleting a template (`templateStorage.ts:189-224`) first snapshots the full document to `{templateId}.deleted.bak.json`, THEN either removes or in-place-tombstones the original. So a deleted report design's content is unrecoverable in-app or by hand, while a deleted template's content survives in the `.deleted.bak.json` file. Same CAS/index infrastructure, two different data-loss postures for what the code comments describe as parallel patterns.

5. **`template.selection.json` read with two different fallback behaviors depending on caller.** `XrayInspectionResults.tsx:231-245` and `Reports/TabView.tsx:227-235` both do `selection?.templateId ? await loadTemplate(...) : null` — consistent. But `KpiRenderer.tsx`'s `useExecutiveRows()` (`renderers/KpiRenderer.tsx:102-110`) calls `buildExecutiveReportRows` with `template: null` **unconditionally** — it never reads `template.selection.json` or `loadTemplate` at all, unlike every other `buildExecutiveReportRows` caller (`exportManager.ts:38` also hardcodes `template: null`, but that's for the PowerBI export's own documented reason of using `config.expertResultFieldId` directly). Practically: `createFieldResolver(null)` (`executiveReportData.ts:28-34`) returns an empty label→fieldId map, so any KPI card or PowerBI-export field that depends on **label-based** resolution (image quality, marking, suspicion level, suspected types, smuggle method) falls back to `config.expertResultFieldId` only where applicable, and reads `null` for the rest — a real asymmetry between what the interactive Report Designer / PowerBI export can compute versus what the full executive report/deck can compute from the exact same underlying data, purely because of which callers bother to resolve the active template first.

6. **`deck2.style-choices.json` last-write-wins on the whole `choices` map, not a merge.** `saveDeckStyleChoices` (A7) is CAS-protected against silent overwrite (verified on read-back), but the *value* being written is always the calling admin's full local `pendingChoices.current` accumulated client-side — if admin A opens the customizer, cycles slide 1's variant, and admin B (on another machine) saves first with their own accumulated choices for slides 2-3, admin A's eventual save (if their local state wasn't refreshed from disk first) will overwrite B's slides 2-3 choices with A's stale/empty view of them. The CAS loop prevents a *lost update at the storage layer* (it will retry/fail loudly on a mid-save race) but does not prevent this *application-layer* last-writer-wins semantic once A's save actually lands after B's.

7. **`designs.index.json` / `templates.index.json` have no reconciliation with actual files on disk.** Both `loadDesignIndex`/`loadTemplateIndex` simply return `{designs:[]}`/`{templates:[]}` on a missing/corrupt index file (A1, A3) — there is no fallback directory scan to rediscover orphaned `{id}.json` files that exist on disk but whose index entry was lost (e.g. index write failed after the per-id file write succeeded, in the small window between the two `withResourceLock`-serialized-but-not-atomic operations in `saveDesign`/`saveTemplate`). Not proven to happen in practice (the per-id write happens first, then the index update, both under the same lock — so a crash between them is the only way to produce this), but the recovery path if it does happen is manual (open the workspace folder directly).
### Cluster 5 — full traceability matrix

Scope: `src/data/backup/`, `src/data/audit/`, `src/data/notifications/`, `src/data/feedback/`,
`src/data/labels/`, `src/data/preferences/`, `src/data/month/`, plus `src/auth/authActivityLog.ts`
(named explicitly by the owner as a contrast case for `actions.log.json`, technically owned by
`src/auth/` not this cluster).

Every "writer function(s)" call chain below was walked from the actual UI handler down to the disk
write; every "reader function(s)" entry was checked by grep across `src/` (test files excluded
unless noted). Read-only audit — nothing in the repo was changed.

---

#### `5-system/backups/{createdAt-mode-suffix}/backup.manifest.json`

**UI entry point.** Archive tab → "نسخ احتياطي الآن" button → `handleBackup` in
`src/components/Sidebar/Tabs/Archive/index.tsx:154-177`. Also written by the **daily/weekly
auto-backup background process**: on every app mount where `session.role` is `admin` or `manager`,
`session.mode !== "demo"`, and the workspace is `"ready"`, an effect in
`src/App.tsx:132-176` fires once per such mount (dep array includes `autoBackupAttemptKey`, so a
manual retry also re-triggers it) and calls `createDailyAdminBackupIfDue`. Also written as the
mandatory **pre-restore rollback** step inside `restoreBackupSnapshot` (same UI entry point as the
restore itself, see below).

**Writer function(s), full chain.**
- Manual: `handleBackup` (`Archive/index.tsx:154`) → `createBackup` (`backupStorage.ts:897`) →
  `safeWriteJson(backupDir, "backup.manifest.json", manifest)` at `backupStorage.ts:949`.
- Auto (daily/weekly, background): `App.tsx:150` → `createDailyAdminBackupIfDue`
  (`backupStorage.ts:994`) → (if due) `createBackup` (`backupStorage.ts:897`) → same write at
  `:949`. Cadence: checked on every qualifying mount; actually writes at most once per
  `periodKey(frequency)` (`todayKey`/`weekKey`, `backupStorage.ts:173-191`) — i.e. at most once a
  day (daily) or once a (ISO) week (weekly), gated by `auto-backup-state.json`.
- Pre-restore: `handleRestore` (`Archive/index.tsx:238`) → `restoreBackupSnapshot`
  (`backupStorage.ts:1061`) → `createBackup(..., "pre-restore")` (`backupStorage.ts:1075`) → same
  write at `:949`.

**Reader function(s).**
- `loadBackupHistory` (`backupStorage.ts:1162`) — reads every backup folder's manifest to build the
  history list. Consumed by Archive tab's "آخر النسخ الاحتياطية" panel
  (`Archive/index.tsx:597-633`, populated via `refresh()` at `:115`).
- `pruneAutoBackups` (`backupStorage.ts:855`) — reads every backup folder's manifest to decide
  `mode`/`createdAt` for retention.
- `exportMonthXlsx`/`copyAllJsonFiles` do **not** read it (they write it); `restoreBackupSnapshot`
  does not itself read the target backup's manifest — it only reads the `json/` mirror directory
  directly (`backupStorage.ts:1074`).

**Why it exists.** The single source of truth for "what does this backup folder contain and how
was it made" — `mode` (manual/automatic/pre-restore) drives retention policy, `monthsFolders`/
`jsonFilesBackedUp`/`datasets` drive the history UI's row counts. Without it, `loadBackupHistory`
and `pruneAutoBackups` cannot distinguish a real completed backup folder from partial debris, and
the whole automatic-retention and history UI silently show nothing for that folder (see orphans
section — this is exactly what already happens for a manifest-write failure).

**Lifecycle.** Created once per backup, at backup time, never updated afterward. Deleted only when
`pruneAutoBackups` (`backupStorage.ts:855-895`) removes the whole backup folder for an `automatic`
backup beyond the 30 most recent (`AUTO_BACKUP_RETENTION_COUNT`); `manual`/`pre-restore` backups
(and therefore their manifests) are **never** auto-deleted. If missing/corrupt: `safeReadJson`
returns not-ok, `loadBackupHistory` and `pruneAutoBackups` both `continue`-skip that folder — it
becomes invisible to history and immune to pruning simultaneously (see orphans section).

---

#### `5-system/backups/{folder}/backup.complete.json`

**UI entry point.** Same as the manifest above (all three write paths: manual, auto, pre-restore) —
written unconditionally right after the manifest, inside the same `createBackup` call.

**Writer function(s).** `createBackup` (`backupStorage.ts:897`) →
`safeWriteJson(backupDir, BACKUP_COMPLETE_FILE, { completedAt })` at `backupStorage.ts:959`,
deliberately positioned *after* the JSON tree copy, the optional XLSX export, and the manifest
write — its presence is meant to mean "this backup folder's own content is fully written."

**Reader function(s).** **None found anywhere in `src/`.** `loadBackupHistory` and
`pruneAutoBackups` both key exclusively off `backup.manifest.json`; no code path reads
`backup.complete.json` back. Confirmed write-only.

**Why it exists.** Documented sentinel (comment at `backupStorage.ts:38-44`) meant to make an
interrupted backup detectable — since the manifest is written just before it, a crash between the
two writes should, in principle, be distinguishable ("manifest present, complete.json absent" =
partial). In practice nothing consumes that signal.

**Lifecycle.** Created once, last, per backup; never updated; deleted only when its parent backup
folder is pruned (same rule as the manifest). If missing while the manifest is present: currently
invisible to every read path — see orphans section, finding **A**.

---

#### `5-system/backups/{folder}/json/**/*.json` (the JSON mirror tree)

**UI entry point.** Same three triggers as the manifest (manual button, daily/weekly auto-backup,
pre-restore step).

**Writer function(s).** `createBackup` → `copyAllJsonFiles` (`backupStorage.ts:461`) →
`collectJsonFileEntries` (flattens the *entire* workspace tree, skipping only the `backups/` folder
itself under a system root, `:422-459`) → `mapWithConcurrency(pending, 8, ...)` → per file:
`readTextFile` (source) + `writeTextFile` (`backupStorage.ts:232`, into `json/{mirrored path}`).
This walk is generic — it copies every `.json` file anywhere under the workspace root, including
the misplaced `feedback/messages.json` (see cluster-4 finding on that path) and
`3-user-data/labels.snapshot.json`.

**Reader function(s).** `restoreBackupSnapshot` → `restoreJsonTree` (`backupStorage.ts:567`) reads
this tree back over the live workspace on restore (see below). No other reader.

**Why it exists.** This tree, not the manifest, is the actual restorable payload — the manifest is
just an index/summary of it.

**Lifecycle.** Written once per backup, never updated in place. Deleted with the parent folder under
the same pruning rule. If a file the walk expected disappears mid-walk (concurrent `.tmp`
create/remove from a live save), `collectEntries` tolerates a `NotFoundError` and keeps what it
already gathered (`backupStorage.ts:370-384`) — a backup can therefore be silently missing a file
that was mid-write at the exact moment of the walk, with no flag raised anywhere.

---

#### `5-system/backups/{folder}/xlsx/*.xlsx` (opt-in convenience export)

**UI entry point.** Archive tab → the "تضمين ملفات XLSX" checkbox (`includeXlsxExports` state,
`Archive/index.tsx:378-391`) must be checked before "نسخ احتياطي الآن" is clicked — opt-in only, not
part of the automatic/daily backup path (`createDailyAdminBackupIfDue` always calls `createBackup`
with default `options = {}`, i.e. `includeXlsxExports` is `undefined`/false).

**Writer function(s).** `createBackup` (`backupStorage.ts:922-934`, only if
`options.includeXlsxExports`) → `exportMonthXlsx` (`:747`) per month + `exportTemplatesXlsx`
(`:819`) → `writeRowsAsChunkedXlsx` (`:308`) → `writeBinaryFile` (`:241`). Each dataset is checked
against `XLSX_MAX_ROWS_PER_DATASET` (100,000) via `assertXlsxDatasetWithinLimit` (`:293`) before
export; an oversized dataset throws, caught by `createBackup` and surfaced as `xlsxWarning` — the
JSON backup still completes.

**Reader function(s).** **None.** Explicitly documented as NOT part of the restorable snapshot
(`CreateBackupOptions` doc comment, `backupStorage.ts:146-153`) — "convenience exports," for
external viewing/analysis only. `restoreBackupSnapshot` never touches the `xlsx/` folder.

**Why it exists.** Lets an admin get a spreadsheet dump of a month's data (population, risk/BI raw,
sample, distribution, employee answers, templates) alongside a backup without a separate export
flow — but it is explicitly a side artifact, not a recovery mechanism.

**Lifecycle.** Written once, opt-in, at backup time only; never updated; deleted with the parent
backup folder under the normal pruning rule.

---

#### `5-system/restore.inprogress.json`

**UI entry point.** Archive tab → "استعادة" on a history item → two-step confirm dialog
(`RestoreDialog`, `Archive/index.tsx:749-850`, requires typing the exact backup folder name) →
`handleRestore` (`:238`).

**Writer function(s).** `restoreBackupSnapshot` (`backupStorage.ts:1061`) →
`safeWriteJson(systemDir, RESTORE_INPROGRESS_FILE, { startedAt, startedBy })` at `:1089`, written
*after* the pre-restore rollback backup succeeds but *before* `restoreJsonTree` starts overwriting
the live workspace. Deliberately not removed in a `finally` — the code comment at `:1080-1087`
states it is left behind on purpose if the restore walk throws partway through, and also left in
place (not just "on throw") if `restoreJsonTree` returns any `skipped` paths (`:1104-1116`, i.e. a
detected partial restore) — only removed at `:1124-1130` once the walk fully succeeds with zero
skips, and even that removal is best-effort/guarded (a `removeEntry` failure there is logged but
does not flip the restore result to failure, `:1126-1129`).

**Reader function(s).** **None found anywhere in `src/`.** No startup check, no Archive-tab banner,
no health-check reads this file back to warn "a previous restore did not finish." It is pure
write/leave-behind with no consumer.

**Why it exists.** Meant to make an interrupted restore (browser crash, tab closed, permission
revoked mid-walk) detectable after the fact — a genuinely important signal, since a partial restore
leaves the live workspace in a mixed old/new state. As written today it records the fact but nothing
surfaces it.

**Lifecycle.** Created at the start of every restore attempt; deleted only on a restore that
completes with zero skipped subdirectories. If a restore fails or partially completes, the file is
permanently left on disk until a *future successful* restore happens to remove it (any restore's
cleanup path removes the same fixed filename, not necessarily tied to the failed attempt). If
missing when expected: not checked anywhere, so "missing" and "restore succeeded" are
indistinguishable to any reader — because there is no reader.

---

#### `5-system/backups/auto-backup-state.json`

**UI entry point.** Written only as a side effect of a **successful automatic backup** — i.e. the
daily/weekly background trigger in `App.tsx:132-176` (see manifest section above), never by the
manual "نسخ احتياطي الآن" button (`createBackup(..., "manual", ...)` never reaches the `mode ===
"automatic"` branch). Also read (not written) by the Archive tab to render "آخر نسخة تلقائية" /
"المجلد" / "بواسطة" (`Archive/index.tsx:456-473`).

**Writer function(s).** `createBackup` (`backupStorage.ts:897`), inside the
`if (mode === "automatic")` branch at `:963-984` → `safeWriteJson<AutoBackupState>(backupsDir,
AUTO_STATE_FILE, {...})` at `:975`. Explicitly documented as a **casLoop exemption**
(`:965-974`): plain `safeWriteJson`, no revision/`_writeToken`, "last-write-wins" by design — the
comment argues the real record is the immutable backup folder itself, so losing this pointer's race
never loses a backup, only which folder is *remembered* as "last automatic."

**Reader function(s).** `loadAutoBackupState` (`backupStorage.ts:1139`) — consumed by Archive tab's
auto-backup panel (`Archive/index.tsx:86,125,456-473`). Also read by
`createDailyAdminBackupIfDue` (`backupStorage.ts:994-1015`) itself, via `safeReadJson` directly
(not through `loadAutoBackupState`) at `:1002`, to decide whether today's/this-week's period was
already covered (`periodKey` match against `state.lastBackupPeriodKey`).

**Why it exists.** The de-dupe mechanism for the once-a-day/once-a-week auto-backup — without it,
every qualifying app mount for an admin/manager would create a fresh automatic backup.

**Lifecycle.** Created on the first successful automatic backup; overwritten (not appended) on every
subsequent one; never explicitly deleted (survives backup pruning — it lives directly under
`backups/`, not inside a prunable backup subfolder). If missing/corrupt: `loadAutoBackupState`
returns `null` (`:1146`) and `createDailyAdminBackupIfDue`'s read at `:1002` fails silently into
`state = null` (via the outer `try` at `:999-1013`, which only distinguishes a *read* failure from
"never backed up" if the read itself throws — a corrupt-but-readable JSON that fails shape
validation is normalized by `normalizeAutoBackupState`, not treated as absent) — net effect: a
missing/corrupt state file simply looks like "no automatic backup has ever run," triggering one
immediately.

---

#### `5-system/backups/auto-backup-settings.json`

**UI entry point.** Archive tab → "فترة النسخ" `<select>` (يومي/أسبوعي) in the auto-backup panel
(`Archive/index.tsx:441-449`) → `handleFrequencyChange` (`:179`). Gated by `canCreateBackup`
(`archive.createBackup` permission) — the `<select>` becomes a read-only `<div>` for users without
it (`:451-455`).

**Writer function(s).** `handleFrequencyChange` (`Archive/index.tsx:179`) →
`saveAutoBackupSettings` (`backupStorage.ts:1042`) → `safeWriteJson(backupsDir,
AUTO_SETTINGS_FILE, settings)` at `:1054`. Also explicitly documented as a **casLoop exemption**
(`:1036-1041`) — "last-admin-wins" whole-object overwrite of a single scalar, no partial-update risk
argued.

**Reader function(s).** `loadAutoBackupSettings` (`backupStorage.ts:1017`) — called from: (a)
`createDailyAdminBackupIfDue` (`:1001`) to know which `periodKey` function to use; (b) `createBackup`
itself when `mode === "automatic"` (`:964`) to stamp `frequency` into the new `auto-backup-state.json`;
(c) Archive tab's `refresh()` (`:126`) to populate the `<select>`/readonly display.

**Why it exists.** The only admin-configurable knob for the automatic-backup cadence.

**Lifecycle.** Created on first save (defaults to `{ frequency: "daily", updatedAt: epoch,
updatedBy: "system" }` if never saved, `:1029-1033`); overwritten on every subsequent save; never
deleted. If missing/corrupt or `frequency` is neither `"daily"` nor `"weekly"`: falls back to the
same hardcoded daily default (`:1023,1029-1033`).

---

#### `5-system/audit/actions.log.json` (live governance action log)

**UI entry point.** **Not a single UI action** — it is appended as a side effect from six different
places across the app, whenever one of the `WorkspaceActionType` union members happens (see the
dedicated "governance action log coverage" section below for the full enumeration and, critically,
which declared action types are never actually reached).

**Writer function(s).** `appendWorkspaceAction` (`actionLog.ts:225`) — common entry point for every
call site. Full write chain: `withResourceLock("audit/actions.log.json:rmw")` →
`casLoop` (`maxRetries: 4, baseDelayMs: 50`) → read `readLogFile` → append entry → if the combined
list exceeds `maxActionEntries` (10,000), `archiveOverflow` (`:176`) runs and must succeed *before*
the live list is trimmed → `safeWriteJson` → read-back verify (revision + `_writeToken`) — no
delayed `verify` callback is supplied here (unlike its sibling module below).

**Reader function(s).** `readWorkspaceActions` (`actionLog.ts:293`) — consumed by UserManagement
tab → "actions" sub-tab, `TabView.tsx:217-230` (initial load) and `:633-639` (manual "تحديث"
refresh), rendered via `AuditSections.tsx`'s action-type label map (`um_action_type_*` keys,
`AuditSections.tsx:13-28`).

**Why it exists.** A governance/compliance trail of high-stakes actions (who deleted a user, drew a
sample, approved a referral, closed a month) — without it there is no record of these events beyond
whatever the underlying data files themselves imply.

**Lifecycle.** Created on first append (empty shell `{revision:0, entries:[]}` is the implicit
starting state, `actionLog.ts:149`); every governance action appends one entry (never overwrites
past entries). At 10,000 live entries, the oldest overflow is archived to
`actions.archive.{year}.json` (per the entry's own `at` timestamp's year) and trimmed from the live
file in the same write. Never deleted outright. If missing/corrupt: `readLogFile` (`:132-150`)
treats it as an empty log; `readWorkspaceActions` returns `[]` on any failure (`:293-302`).

---

#### `5-system/audit/actions.archive.{year}.json`

**UI entry point.** Never directly user-triggered — a pure side effect of `actions.log.json`
crossing its 10,000-entry cap during any of the same six append call sites above.

**Writer function(s).** `archiveOverflow` (`actionLog.ts:176-218`), called from inside
`appendWorkspaceAction`'s `casLoop` attempt (`:249-260`), before the live-log trim. Groups overflow
entries by `entryYear` (parsed from each entry's own `at` field, `:67-70`), reads the existing
archive for that year (`readArchiveFile`, `:153-168`), filters out ids already present (idempotent
against casLoop retries, `:194`), and — on the *first* write for a given year — links to the prior
calendar year's archive via `previousArchiveHash = hashActionArchive(prior)` (djb2 over the whole
prior archive JSON, `:63-65,199-203`) if that prior archive exists and has `revision > 0`. Writes via
plain `safeWriteJson` (`:211`) — no CAS/revision on the archive file itself (only the live log has
CAS protection; the archive write happens inside the live log's own CAS attempt, so a retry
re-derives and re-writes it, made safe by the id-based idempotency check).

**Reader function(s).** `readWorkspaceActionArchive` (`actionLog.ts:305-316`) exists and is
exported, but **grep across `src/` finds no call site for it outside `actionLog.test.ts`/
`actionLogArchival.test.ts`.** No UI component imports or renders it. The `hashActionArchive`
tamper-evidence chain (`previousArchiveHash`) is likewise **written but never independently
re-verified** anywhere in the app — there is no "verify the archive chain" reader at all, so a
corrupted or hand-edited archive file would go undetected until (if ever) someone manually recomputes
the hash chain outside the app, per `docs/architecture/SECURITY_MODEL.md`'s own framing of this as
tamper-*evident*, not tamper-*proof*.

**Why it exists.** A6 retention policy: keeps the live audit log bounded (10,000 entries) for
performance/readability while never discarding history — evicted entries move to a permanent,
year-partitioned, hash-chained archive instead of being deleted.

**Lifecycle.** Created on the year's first overflow; appended to (never overwritten wholesale) on
subsequent overflows into the same year; never pruned/deleted by any code path. If missing: treated
as an empty shell (`readArchiveFile`, `:156-167`) — a new archive starts fresh, and the
`previousArchiveHash` link to that (missing) year is simply omitted (`revision > 0` check at
`:202` guards against linking to a nonexistent prior archive). If archival itself throws mid-write:
`archiveOverflow` returns `false`, and — critically — the live log is written *without* trimming
that cycle (kept temporarily over the 10,000 cap) rather than dropping the entries
(`actionLog.ts:249-260`); the next append retries archival.

---

#### `5-system/notifications/notifications.json`

**UI entry point.** Post: `ew/notifications` tab (`src/components/Sidebar/Tabs/NotificationCenter/
index.tsx:8,34`, wraps `NotificationManager`) → the post form in
`src/components/Sidebar/Tabs/EmployeeWorkspace/views/NotificationManager.tsx:111`. Accept: the
`NotificationBanner` component, mounted unconditionally in `App.tsx:241` → its accept button →
`src/components/NotificationBanner/NotificationBanner.tsx:92`.

**Writer function(s).**
- Post: `NotificationManager.tsx:111` → `postNotification` (`notificationStorage.ts:143`) →
  `mutateNotifications` (`:85`) → `withWorkspaceWriteAccess` → `withResourceLock
  ("notifications/notifications.json:rmw")` → `casLoop` (`maxRetries: 6, baseDelayMs: 50`,
  **no delayed `verify` callback**) → `safeWriteJson` (`:113`) → read-back verify.
- Accept: `NotificationBanner.tsx:92` → `acceptNotification` (`notificationStorage.ts:165`) → same
  `mutateNotifications` path — idempotent per user (`:170-182`, a no-op if already accepted or the
  notification vanished).

**Reader function(s).** `loadNotifications` (`notificationStorage.ts:68`) — consumed by (a)
`NotificationManager.tsx` for the manager/admin "posted notifications" list, and (b)
`NotificationBanner.tsx` to compute `shouldShowBanner`/`getUnacceptedFor`
(`notificationTypes.ts:62-82`) for the must-accept audience (`employee`/`supervisor`,
`isNotificationAudienceRole`, `:46-48`).

**Why it exists.** Workspace-wide broadcast announcements from admin/manager to staff, with a
per-user read receipt (`acceptances`) so managers can see who has acknowledged a given notice.

**Lifecycle.** Created on first post; every post appends, every accept appends one acceptance record
to the target notification (never removes). Capped at 500 total notifications
(`MAX_NOTIFICATIONS`, `:24`) via a bare `.slice(-500)` on every write (`:111`) — **oldest
notifications and their acceptance history are silently and permanently dropped past that cap, with
no archival**, unlike the audit log's A6 pattern. If missing/corrupt: `loadNotifications` returns
`[]` on any failure (`:71-77`); `readNotificationsFile` treats a missing folder as normal for a
fresh workspace (`:61-64`).

---

#### `feedback/messages.json` (workspace root — NOT under `5-system/`)

**UI entry point.** The floating `FeedbackWidget`, mounted unconditionally in `App.tsx:346` for
every role. Submit: the widget's own form → `handleSubmit`
(`src/components/FeedbackWidget/FeedbackWidget.tsx:94`). Reply/resolve (manager/admin only,
`CAN_MANAGE = ["manager","admin"]`, `:23,58`): `handleReply` (`:116`).

**Writer function(s).**
- Submit: `handleSubmit` (`FeedbackWidget.tsx:99`) → `submitFeedback`
  (`feedbackStorage.ts:118`) → `mutateFeedback` (`:85`) → `getFeedbackDir(dir)` at `:41-43` — calls
  `dir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, {create:true})` **directly on the raw
  workspace `directoryHandle`**, not via `getSystemRoot()` — so the folder created is
  `<workspace-root>/feedback/`, not `5-system/feedback/`, unlike every sibling module in this
  cluster. → `withResourceLock` → `casLoop` (default retries/delay, **no `conflictError` override
  beyond the default, no delayed `verify`** — explicitly justified in a comment at `:81-84` as
  low-stakes: "a rare lost update means at most a re-submission").
- Reply: `handleReply` (`FeedbackWidget.tsx:123`) → `replyToFeedback` (`feedbackStorage.ts:137`) →
  same `mutateFeedback` path.

**Reader function(s).** `loadFeedback` (`feedbackStorage.ts:67`) — consumed by `FeedbackWidget`'s
own `refresh()` (`:63`), for both the submitting user's own message list and (for
manager/admin) the "all messages" admin view.

**Why it exists.** In-app suggestion/issue/inquiry channel so staff can reach admins without leaving
the app.

**Lifecycle.** Created on first submission; every submit/reply appends (unshift for new messages,
push for replies) — no cap, no pruning, unbounded growth. If missing/corrupt:
`loadFeedbackFile` treats it as an empty log (`:61-64`). Also transparently reads a **legacy bare-
array shape** with no `revision`/`_writeToken` wrapper (`:52-54`) alongside the current wrapped
shape — a real migration path from before CAS protection was added.

---

#### `3-user-data/labels.snapshot.json`

**UI entry point.** **Three** distinct triggers, not one:
1. Settings tab → any individual label field's blur-to-save (`LabelSettingRow`'s `save`,
   `src/components/Sidebar/Tabs/Settings/index.tsx:317-327`) — fires `exportLabelsSnapshot` at
   `:326` immediately after `setLabel`, but only if the value actually changed (no-op guard at
   `:322`) and only if a workspace is connected.
2. Settings tab → per-field "استعادة القيمة الافتراضية" reset button (`reset`, `:329-334`) — same
   pattern, `exportLabelsSnapshot` at `:333`.
3. Settings tab → "استعادة الكل" (reset-all, with a confirm step) → `handleResetAll`
   (`:398-404`) — `exportLabelsSnapshot` at `:403`.
4. **Also** written as a side effect of every backup (manual, auto, or pre-restore) —
   `createBackup` calls `exportLabelsSnapshot(directoryHandle)` unconditionally at
   `backupStorage.ts:916`, right before the JSON tree walk, so a backup always captures the *current*
   overrides, not a stale snapshot.

(Correction to this cluster's earlier prod-readiness note: labels are **not** only snapshotted at
backup time — every live Settings-tab edit round-trips to disk immediately when a workspace is
connected. The snapshot can only go stale relative to `localStorage` if the user edits labels while
**no workspace is connected** at all — `directoryHandle` is null-guarded at each of the three
Settings-tab call sites above.)

**Writer function(s).** `exportLabelsSnapshot` (`src/data/workspace/labelsSnapshot.ts:31-42`) →
`getUserDataRoot(directoryHandle, true)` → `safeWriteJson(userDataDir, "labels.snapshot.json",
{overrides: getCustomLabelOverrides(), savedAt})`. Best-effort: wrapped in try/catch, logs to the
error ring buffer via `logError("labels:export-snapshot", ...)` on failure, never throws to its
callers (so a snapshot failure never blocks a label edit or a backup).

**Reader function(s).** `importLabelsSnapshot` (`labelsSnapshot.ts:49-66`) — the **only** reader,
called from exactly one place: Archive tab's post-restore opt-in "استيراد المستخدمين والتسميات"
button, `handleImportUsersLabels` (`Archive/index.tsx:272-337`, button rendered only after
`justRestored` is set, `:399-411`). Never auto-applied by `restoreBackupSnapshot` itself — the
restore's own `restoreJsonTree` walk *does* overwrite this file on disk (it's inside the JSON
mirror), but that overwritten-on-disk snapshot only takes effect in the running app's `localStorage`
-backed label state once a user explicitly clicks the import button afterward.

**Why it exists.** Bridges the gap between label overrides (which live only in `localStorage`, a
per-browser-profile store the workspace-folder backup mechanism cannot see) and the workspace
backup/restore flow — "Tier-1 Item F" per the code comment (`labelsSnapshot.ts:1-8`).

**Lifecycle.** Created on first label customization (if a workspace is connected) or first backup;
overwritten (not appended — `overrides` is the full current override set each time) on every
subsequent trigger; never deleted by any code path (deletion would require manually removing the
file or the whole `3-user-data/` folder). If missing/corrupt: `importLabelsSnapshot` returns `0`
applied keys on a failed read (`:52-53`) or on any thrown error (`:63-65`) — the import button
simply reports "0 تسمية مخصصة مطبّقة" with no distinct error for "missing" vs. "corrupt."

---

#### `localStorage["xray_custom_labels_v1"]`

**UI entry point.** Same Settings-tab triggers as the snapshot above (`setLabel`/`resetLabel`/
`resetAllLabels` calls at `Settings/index.tsx:323,331,401`) — this is the **live, primary** store;
the workspace snapshot above is a downstream mirror of it, not the other way around.

**Writer function(s).** `setLabel`/`resetLabel`/`resetAllLabels` (`labelsStore.ts:635-656`) each
mutate the module-level `customLabels` object then call `persistLabels()` (`:610-620`), which does
`localStorage.setItem(...)` (or `removeItem` if the override set is now empty) inside a try/catch
that silently swallows any failure ("non-fatal fallback," `:617-619` — no `logError` call here).

**Reader function(s).** `getLabels()` (`:622-624`, synchronous merge of `DEFAULT_LABELS` +
`customLabels`) — called throughout the entire app wherever label-driven UI text is rendered (via
`useLabels()` hook, `src/data/labels/useLabels.ts`, for reactive components, or direct `getLabels()`
calls for one-off reads). `getCustomLabelOverrides()` (`:627-629`) — used only by
`exportLabelsSnapshot` above. `isCustomized()` (`:631-633`) — used by `LabelSettingRow` to show the
"is-custom" badge/default-value hint.

**Why it exists.** The actual runtime label-override state — everything else (the workspace
snapshot) exists only to make this recoverable across a workspace backup/restore, since
`localStorage` is scoped per browser profile and invisible to the File System Access workspace.

**Lifecycle.** Hydrated once at module load from `localStorage` (`labelsStore.ts:601-608`, inside a
try/catch that resets to `{}` on any parse error); updated on every label edit; never proactively
cleared except via "استعادة الكل." If the stored JSON is corrupt: the load-time catch at `:605-607`
silently discards it and starts from an empty override set — **no `logError` call, no user-visible
signal that a customization was lost**, unlike nearly every disk-backed read path in this cluster.

---

#### `sessionStorage["xray_global_month_v1"]`

**UI entry point.** Global month selector in the app's top toolbar/sidebar (consumed via
`useGlobalMonth()`, `src/data/month/useGlobalMonth.ts`) — selecting an existing month or starting a
new one calls `setSelectedMonth`/`startNewMonth` on `GlobalMonthProvider`.

**Writer function(s).** `persistSelection` (`GlobalMonthProvider.tsx:24-31`) — called from every
selection-changing path: the initial resolve effect (`:56-67`), `setSelectedMonth` (`:103-113`),
`startNewMonth` (`:115-127`), and `refreshMonths` (`:129-145`). Plain
`sessionStorage.setItem`/`removeItem` inside a try/catch that silently no-ops on failure (`:28-30`,
comment: "the selection just won't survive a reload").

**Reader function(s).** `readStoredFolderName` (`:16-22`) — read exactly once, at provider mount,
inside the initial month-list-load effect (`:56-67`, via `resolveInitialSelection`,
`globalMonthLogic.ts:24-33`). Never re-read after mount; subsequent reconciliation
(`reconcileSelection`, `:36-49`) works purely off the in-memory `selection` state and the freshly
fetched `months` list, not off `sessionStorage` again.

**Why it exists.** Lets the app remember which month was selected across a same-tab page reload
(session-scoped, not persistent) without needing a workspace round-trip just to restore UI state.

**Lifecycle.** Written on every selection change; the key is removed (not left stale) when
selection becomes `{kind:"none"}` (workspace disconnects, `:26`). Never explicitly deleted otherwise
— survives until the tab/browser session ends (browser-native `sessionStorage` lifetime) or is
overwritten by a new selection. If missing or referencing a folder that no longer exists:
`resolveInitialSelection` (`globalMonthLogic.ts:24-33`) falls back to `latestMonthSelection` — no
error surfaced, just silently picks the newest month (or a synthesized `pending` current month if
none exist).

---

#### `5-system/user-presets/{username}.browse-preset.json`

**UI entry point.** Employee Workspace tab → x-ray referrals view → column-configuration UI (drag
column order / hide-show / width) → save triggers `saveUserBrowseDatasetPreset`
(`src/components/Sidebar/Tabs/EmployeeWorkspace/views/XrayReferrals.tsx:963`, keyed under
`REFERRALS_PRESET_KEY`). This is the **only** call site in the whole app — non-admin users'
column customization on the referrals dataset specifically, not the general population Browse view.

**Writer function(s).** `XrayReferrals.tsx:963` → `saveUserBrowseDatasetPreset`
(`browsePresetStorage.ts:73-101`) → `withResourceLock
("user-presets/{username}.browse-preset.json:rmw")` → read existing, merge in the one changed
dataset key, `safeWriteJson`. **No `casLoop`/revision protection** — plain read-modify-write under
only a same-tab lock. This is a **documented, deliberate** decision (per `docs/edit logs/
2026-07-12.md`, "Batch D": "`{username}.browse-preset.json` is a per-user file only ever written by
that one user, so it is single-writer by design... cross-machine last-writer-wins on one person's
own column preferences is acceptable and needs no CAS") — not an oversight, correcting this
cluster's earlier report which flagged it as an unexplained gap.

**Reader function(s).** `loadUserBrowsePreset` (`browsePresetStorage.ts:49-71`) — called from
`BrowseDataView.tsx:556-561` (population Browse tab, for the *shared admin* preset merged with the
per-user one) and, by the same underlying dataset-kind mechanism, from `XrayReferrals.tsx`'s own
load path and `XrayInspectionResults.tsx` (grep hit, not traced in detail — same storage module).

**Why it exists.** Personal column layout/visibility/width preferences per employee, per dataset,
independent of the admin-shared defaults.

**Lifecycle.** Created on first save for that user+dataset; each save only updates the one dataset
key inside the file, preserving other datasets' presets (`browsePresetStorage.ts:87-96`); never
deleted by any code path (not even when the user is deleted via UserManagement — orphaned preset
files accumulate). If missing/corrupt or the stored `username` doesn't match: treated as absent,
returns an empty-defaults shell (`:60-65`).

---

#### `5-system/user-presets/admin-shared.browse-preset.json`

**UI entry point.** Population tab → Browse sub-tab → column configuration, saved by an
**admin-role** session specifically — `BrowseDataView.tsx:853` gates the call behind
`readSession()?.role === "admin"`.

**Writer function(s).** `BrowseDataView.tsx:854` → `saveAdminBrowseDatasetPreset`
(`browsePresetStorage.ts:142-179`) → `withResourceLock
("user-presets/admin-shared.browse-preset.json:rmw")` → `casLoop` (default retries, no override) →
read existing, merge in one dataset key, bump `revision`, stamp `_writeToken`, `safeWriteJson`,
read-back verify. Full CAS protection, unlike the per-user file above — justified by being a
genuinely shared, multi-admin file.

**Reader function(s).** `loadAdminBrowsePreset` (`browsePresetStorage.ts:103-140`) — called from
`BrowseDataView.tsx:558` for every viewer of the Browse tab (not just admins — the admin-chosen
layout is the shared default everyone sees, merged with their own per-user override where one
exists). Includes a legacy-migration fallback: if the new shared-preset file is absent, it falls
back to reading a **legacy per-user file literally named `"admin"`**
(`safeUserFileName("admin")`, `:120-134`) — real migration path predating the shared-file
introduction, not dead code.

**Why it exists.** One admin-curated default column layout/visibility for the Browse view, applied
to every viewer regardless of role, distinct from each individual's own per-user override.

**Lifecycle.** Created on first admin save; each save updates one dataset key, preserving others;
never deleted. If missing/corrupt: falls through the legacy-file fallback described above, then to
an empty-defaults shell (`:136-139`).

---

#### `5-system/audit/activity.log.json` (auth sign-in activity log — contrast case, owned by `src/auth/`)

Included per the owner's explicit request, to make the write/read asymmetry against
`actions.log.json` visible. This file is **not** part of this cluster's owned directories
(`src/auth/authActivityLog.ts`), but shares the same `5-system/audit/` folder and the same
`casLoop` infrastructure.

**UI entry point.** Not a discrete UI action — driven by the auth session lifecycle in
`src/auth/AuthGate.tsx`: session start (`startAuthActivitySession`, called on successful login),
periodic heartbeat every time the heartbeat interval fires (`recordAuthActivityHeartbeat`,
`AuthGate.tsx:293-297`, `window.setInterval`) or the tab becomes hidden
(`document.visibilityState === "hidden"`, `:307-308`), and session end on logout/expiry/replacement
or `pagehide` (`endAuthActivitySession`, `:311`).

**Writer function(s).** All four lifecycle functions (`authActivityLog.ts:164-211`) mutate an
in-memory `memoryEntries` array, then call `queueFlush()` (`:153-157`), which chains onto a
module-level `writeChain` promise → `flushMemoryToWorkspace` (`:115-151`) → `casLoop` (no
`maxRetries` override, default 10, **no delayed `verify`** — comment at `:126-128` argues the
merge-by-session-id pattern is self-healing) → `safeWriteJson`. Distinctive **merge-by-id** design
(`mergeEntries`, `:56-65`): unlike `actions.log.json`'s pure append, this reconciles the in-memory
list with the freshest on-disk list by entry `id` on every flush, capped at `MAX_ACTIVITY_LOG_ENTRIES`
(5,000) via `.slice(-5000)` — **no archival on overflow**, a third variant of the cap/no-archive
pattern also seen in `notifications.json`.

**Reader function(s).** `readAuthActivityLog` (`authActivityLog.ts:213-218`) — consumed by
UserManagement tab → "activity" sub-tab (`TabView.tsx:188-201` initial load, `:618-624` manual
refresh), rendered via `AuditSections.tsx`.

**Why it exists.** Session-shaped (who signed in when, how long, why it ended) — explicitly
documented in `actionLog.ts:1-14` as deliberately kept separate from the governance action log
because the two have incompatible schemas (session/heartbeat vs. append-only discrete events).

**Lifecycle.** Created on first login after `configureAuthActivityLogWorkspace` is given a live
workspace handle (`AuthGate.tsx:197-198`, itself deferred until a session exists, per the comment at
`:188-196`, to avoid an unnecessary write-permission prompt); continuously updated via heartbeat;
capped at 5,000 entries with silent oldest-drop, no archive. If missing/corrupt: `readDiskLog`
(`:85-98`) treats it as empty, filtering any malformed entries via `isValidEntry` (`:100-113`) rather
than rejecting the whole file.

---

#### Governance action log — which UI actions actually append, and which declared types never fire

The `WorkspaceActionType` union (`actionLog.ts:72-88`) declares 15 action kinds. Grepping every
`appendWorkspaceAction(` call site in `src/` (test files excluded) finds only **6 distinct action
kinds actually appended, from 5 files**:

| Action kind | Call site |
|---|---|
| `month-closed` / `month-reopened` | `Archive/index.tsx:208`, inside `handleMonthLockConfirm` — fires after `closeMonth`/`reopenMonth` succeed |
| `user-deleted` | `UserManagement/TabView.tsx:452`, inside `handleDeleteUser` — fires after the user is removed from the in-memory/synced state |
| `referral-approved` / `referral-denied` / `replacement-approved` / `replacement-denied` / `reopen-approved` / `reopen-denied` | `EmployeeWorkspace/views/ReferralApproval/useApprovalData.ts:213,241,268,296,324,352` — one call site per decision outcome |
| `distribution-bulk-assigned` | `Population/useDistributionActions.ts:315` |
| `sample-drawn` | `Population/index.tsx:1060` |
| `answer-reopened` | `src/data/answers/reopenAnswer.ts:112` |

**Declared but never appended anywhere in `src/` (outside test fixtures):**
- `user-created` — `TabView.tsx:290-321`'s `handleAddUser`/`persistState` path has no
  `appendWorkspaceAction` call.
- `permission-changed` — `TabView.tsx:471-484`'s `updateTabPermission` has no
  `appendWorkspaceAction` call, despite `docs/audit/TIER1_SPEC_2026-07-05.md:387` explicitly
  specifying `UserManagement/index.tsx:433 updateTabPermission` as its intended call site.
- `feature-permission-changed` — `TabView.tsx:486-503`'s `updateFeaturePermission`, same gap
  (spec'd at `TIER1_SPEC_2026-07-05.md:388`).
- `backup-restored` — `Archive/index.tsx:238-270`'s `handleRestore` has no
  `appendWorkspaceAction` call at all, despite the type existing specifically for this
  (spec'd at `TIER1_SPEC_2026-07-05.md:394`: "Settings/backup UI call site of
  `restoreBackupSnapshot`").

All four dead types nonetheless have live Arabic display-label mappings ready and waiting in
`AuditSections.tsx:13-28` (`um_action_type_user_created`, `um_action_type_permission_changed`,
`um_action_type_feature_permission_changed`, `um_action_type_backup_restored`) — the UI is fully
prepared to render these entries; they will simply never appear, because nothing writes them. See
orphans finding **B**.

---

#### Orphans and asymmetries

**A. `backup.complete.json` is write-only; the manifest/completion-race gap it exists to close is
therefore still open in practice.** Written last, on every backup, specifically so a caller could
detect "manifest present but completion sentinel absent = interrupted backup." No reader exists.
`loadBackupHistory` and `pruneAutoBackups` both trust `backup.manifest.json` alone. A process killed
between the manifest write (`backupStorage.ts:949`) and this sentinel's write (`:959`) produces a
backup folder that looks fully valid in the history list and counts toward/against retention, while
its JSON mirror or XLSX exports could in principle still be fine (they're written *before* the
manifest) — so the actual risk window is narrow, but the sentinel that was built to flag it is
inert.

**B. Four `WorkspaceActionType` values are fully wired on the read/display side (labels in
`AuditSections.tsx`) but have zero write-side call sites**: `user-created`, `permission-changed`,
`feature-permission-changed`, `backup-restored`. This is the largest surprise in this pass — the
original TIER1 spec (`docs/audit/TIER1_SPEC_2026-07-05.md:386-394`) named exact intended call sites
for all four, but the current `TabView.tsx`/`Archive/index.tsx` code at those exact locations
(`updateTabPermission`, `updateFeaturePermission`, `handleAddUser`, `handleRestore`) has no audit
append. Either the spec was never fully implemented for these four, or the append calls were later
removed during a refactor (`UserManagement/index.tsx` → `TabView.tsx`) without anyone noticing the
label mappings were left behind. Net effect for the owner's stated goal ("which UI actions leave an
audit trail, and by implication which do not"): **creating a user, changing the tab-permission
matrix, changing the feature-permission matrix, and restoring a backup currently leave NO entry in
the governance action log**, despite being exactly the kind of high-stakes actions this log exists
to capture — arguably more consequential than `answer-reopened` or `referral-denied`, which *are*
captured.

**C. `restore.inprogress.json` is write-only** — same shape as finding A but higher stakes: it is
specifically designed to flag an interrupted restore (a genuinely dangerous state: partially
overwritten workspace), and nothing anywhere reads it back to warn a user on next launch or next
Archive-tab visit.

**D. `readWorkspaceActionArchive` and the audit archive's hash chain are both write-only in
practice.** The reader function is exported and tested but never called from any UI component; the
`previousArchiveHash` tamper-evidence chain is computed and written on every archive but never
independently re-verified anywhere in the app.

**E. Three independent "cap with no archive" implementations, inconsistent with the fourth
("cap with mandatory archive") implementation in the same cluster/family:**
- `actions.log.json` — caps at 10,000, **archives before trimming** (A6, the one correct/complete
  implementation).
- `notifications.json` — caps at 500, plain `.slice()`, **no archive, silent permanent loss**.
- `activity.log.json` (auth, contrast case) — caps at 5,000, plain `.slice()`, **no archive, silent
  permanent loss**.
No comment anywhere argues these two omissions are deliberate (contrast with the feedback module's
own explicit "low-stakes, no verify needed" comment) — it reads as three modules solving the same
"bounded live log" problem three different ways without a shared policy.

**F. `feedback/messages.json` lives outside every numbered-root/`5-system` convention this cluster
otherwise follows uniformly** (confirmed again on this pass — `getFeedbackDir`,
`feedbackStorage.ts:41-43`, calls `dir.getDirectoryHandle(SYSTEM_FOLDER_NAMES.feedback, ...)`
directly on the raw workspace handle rather than through `getSystemRoot()`). Still backed up
correctly today only because `copyAllJsonFiles`'s tree walk is generic rather than path-aware.

**G. Coverage gaps in what no backup captures, confirmed exhaustively this pass:**
- `localStorage["xray_custom_labels_v1"]` — covered indirectly via `labels.snapshot.json`, but only
  when a workspace was connected at the moment of the edit (guarded `if (directoryHandle)` at every
  Settings-tab call site); a label changed while genuinely offline (no workspace picked at all) is
  never snapshotted until the next connected edit.
- `sessionStorage["xray_global_month_v1"]` — never captured by any backup; acceptable, purely
  derivable UI state.
- `xlsx/` exports — deliberately excluded from restore by design (documented), not a gap so much as
  a documented non-goal.
- Any `.json` file physically outside the workspace root entirely (there are none in this
  cluster — everything, including the misprovisioned `feedback/` folder, is still inside the root
  and thus still swept by the generic walk).

**H. Correction to this cluster's earlier (prior-turn) report, made explicit here for the record:**
that report's finding #3 ("`saveUserBrowseDatasetPreset` has no CAS/revision protection... unlike
every other multi-writer file in this cluster") is technically accurate about the code but wrong
about it being an oversight — `docs/edit logs/2026-07-12.md` documents it as a deliberate
single-writer carve-out ("Batch D"). Also, finding #6 in that report understated how often
`exportLabelsSnapshot` runs — it is not backup-time-only, it also fires on every individual
Settings-tab label save/reset when a workspace is connected (`Settings/index.tsx:326,333,403`),
which narrows (though does not eliminate) the staleness window described there.
## Part VIII — Findings

Four themes, then the ranked list. The traceability pass in Part VI changed the picture
substantially: it surfaced Theme 0, which was invisible to the first pass because you cannot see a
missing consumer by reading a module — only by tracing every artifact's readers and finding none.

### Theme 0: Built, correct, and never wired up

The single largest pattern in the codebase. In each case the *hard* half — a correct,
concurrency-safe, often tamper-evident write path — was built and tested, and the consuming UI was
not. The app pays the full write and storage cost of machinery nobody can currently use.

| Mechanism | What exists | What's missing |
|---|---|---|
| `approveSampleMaster` — A3 four-eyes sample-release gate | CAS-safe, idempotent, tested | **No button or screen invokes it.** Its own type doc says "Wave B gates the UI on this field" |
| `migrateWorkspaceSchema` | Built, tested, dry-run-first | **Zero non-test callers.** A legacy/mixed workspace can never receive its schema stamp |
| `verifyDecisionChain` — B5 tamper evidence | Chain written correctly on every decision | **Never invoked.** Tamper-evidence with no verifier |
| Audit archive hash chain | `previousArchiveHash` computed per year | `readWorkspaceActionArchive` never called from any UI path |
| `loadSamplingPlan` | Exists, unit-tested | Zero non-test callers |
| `backup.complete.json` | Written last, specifically to be detectable | **Never read.** Interrupted-backup detection is inert |
| `restore.inprogress.json` | Written before the destructive walk | **Never read.** Interrupted-restore detection is inert |
| Report Designer query engine | ~500 lines, full test suite | Zero non-test callers — **owner confirmed: delete** |
| `sampling-proof.json` | Written at draw time | No reader anywhere |
| `main.samples.json` | Whole-month mirror, revision-guarded | **Zero readers** (its per-employee sibling *is* used) |
| Raw-import `.superseded.json` archives | Verbatim copy before overwrite | No reader |
| `risk.source.{ext}` / `bi.source.{ext}` | Original workbook bytes preserved | No reader |
| `workspace.manifest.json` payload | Written at structure creation | Existence-checked only; **content never read** |

Not all of these are defects. Provenance artifacts have value even if only a human ever opens them
in a file browser. But that should be a *decision*, not an accident — and right now nothing in the
product tells a user these files exist or how to use them.

### Theme 1: The same concept implemented N times, and the copies have drifted

| Concept | Copies | Drifted? |
|---|---|---|
| JSON envelope + content hash | 2 — djb2/numeric vs SHA-256/string | **Yes** — one hash never verified |
| Safe read with fallback ladder | 2 — `safeReadJson` vs `readJsonFile` | **Yes** — only one recovers `.tmp` |
| `safeWriteJson` stage/verify/rollback | 2 — streamed vs small-file | ~90% duplicated |
| CAS read-modify-write | 4 — audit, notifications, feedback, preset | **Yes** — see Finding 4 |
| Bounded live log | 3 — audit, notifications, activity | **Yes** — only audit archives before dropping |
| Per-port accuracy fold | 3 | By design, but interchangeable-looking |
| Stage-alias normalization | 2 — main thread vs worker | "Keep in sync by hand" comment |
| Hamilton rounding/weighting | 2 — sampling vs bulk assignment | Not yet |

### Theme 2: Correctness rests on convention, not types

The distribution three-file split, the `ForRead` vs authoritative loaders, the stage-mapping
hand-sync, the accuracy-fold grain distinctions. All correct today; all enforced by discipline.

### Theme 3: Performance work stopped halfway

Phases A and B shipped, so single-month Browse is fast. Phase 2 processing, all-months reads,
`buildReportModel`, and Designer KPI tiles never got the same treatment. Phase C
(port-partitioned storage, 10–18 days) remains unshipped and blocked on backup coordination.

---

### Ranked findings

**1. (HIGH) Four of the highest-stakes governance actions leave no audit trail.**
`user-created`, `permission-changed`, `feature-permission-changed`, and `backup-restored` all have
finished Arabic display labels sitting ready in `AuditSections.tsx:13-28`, and
`docs/audit/TIER1_SPEC_2026-07-05.md:386-394` names the exact intended call sites — but none of
those sites (`TabView.tsx`'s `updateTabPermission`/`updateFeaturePermission`/`handleAddUser`,
`Archive/index.tsx`'s `handleRestore`) actually call `appendWorkspaceAction`. **Only 6 of 15
declared action kinds ever fire.** Creating a user, editing either permission matrix, and restoring
a backup — arguably the four actions most worth logging — are invisible in the audit UI, which
silently presents itself as complete.

**2. (HIGH) Report Designer KPI cards are both slow and wrong.**
`KpiRenderer.tsx:79-121` is a *per-element* hook: every tile independently loads population +
sample + distribution + all employee files and rebuilds the whole month via
`buildExecutiveReportRows`, with no sharing, no cache, and no `yieldToMain()` anywhere. Ten tiles do
ten times the work. **And it hardcodes `template: null`** — it never loads `template.selection.json`
unlike every other report surface, so KPI tiles silently cannot resolve label-based fields (image
quality, marking, suspicion level, suspected types, smuggling method). The same field for the same
month shows a different answer depending on which surface you look at. Fix both together: hoist the
load into a context keyed on `(directoryHandle, monthFolder)` and pass the resolved template.

**3. (HIGH) Phase 2 population processing runs on the main thread.**
`Population/index.tsx:782` calls `processPopulation` directly, no worker, despite Phase 1 parsing
already having worker infrastructure for exactly this reason. Phase 2 is the heavier half — per-row
date parsing, BI map lookups, CertScan substring matching. Chunked yields prevent a hard freeze, but
for a 200k–400k row month everything else competes with this loop throughout.

**4. (HIGH) A corrupted `users.permissions.json` silently resets to six hardcoded default users** —
indistinguishable from a brand-new empty workspace. Compounding it: `validateEnvelope`
(`jsonEnvelope.ts:182-184`) short-circuits to `true` for the string-schema envelope, and
`isJsonEnvelope` only checks the field is present. So this file's `contentHash` is computed on every
write and **never verified on any read**. The integrity mechanism that would catch the corruption
exists, runs, and is skipped — for the one file deciding who can log in and what they can do.

**5. (HIGH) All-months reads bypass the worker path entirely.**
`loadAllPopulationRows`/`loadAllSampleRows`/`loadAllRawRows` do a full main-thread parse of every
month's file, concurrency-capped at 4, uncached across calls. Two different performance postures for
conceptually the same operation, depending only on whether a month filter is applied.

**6. (MEDIUM) Corrupt answer and decision files silently read as "nothing done yet."**
Both `{username}.answers.json` and `{supervisor}.decisions.json` collapse to empty on corruption
with no error surfaced. A supervisor's corrupted approval history is indistinguishable from a
supervisor who never approved anything — in exactly the files where that distinction carries audit
weight. Contrast `distribution.events/` and `distribution.log.json`, which both throw loudly.

**7. (MEDIUM) `buildReportModel()` has no internal yield points.** Row build, decision-fact-table
explosion, aggregates including an O(rows × 15) cross-team matrix, and reviewer KPIs run
back-to-back before any edition's slide loop starts yielding.

**8. (MEDIUM) Feedback storage sits outside the numbered-root convention.**
`feedbackStorage.ts:41-43` bypasses `getSystemRoot()`, creating an undocumented 7th top-level root.
Backups capture it only because the walk is generic rather than path-aware — accidentally correct.
A landmine for any workspace migration tool or file-browser UI assuming only `1-` through `6-`.

**9. (MEDIUM) Notifications drop data at 500 with no archival**, while the audit log beside it uses
identical primitives and explicitly archives-before-trim, returning `false` rather than dropping an
entry unarchived. `activity.log.json` (cap 5,000) also drops silently. Three bounded-log
implementations, one retention policy between them. **This is the proof the four duplicated CAS
implementations have drifted in behavior, not just shape.**

**10. (MEDIUM) Deleting a report design is unrecoverable; deleting a template is recoverable.**
Templates snapshot their full body to `{templateId}.deleted.bak.json` first; designs are overwritten
in place with no snapshot. Same CAS infrastructure, opposite data-loss postures. And the tombstone
has zero readers — recovery means renaming a file by hand.

**11. (MEDIUM) Neither index file has orphan recovery.** `designs.index.json` and
`templates.index.json` both fall back to an empty list on missing/corrupt, with no reconciliation
against the `{id}.json` files actually on disk. A corrupted index makes intact designs invisible.

**12. (MEDIUM) `sampling-proof.json` write failure is silently swallowed.**
`catch { /* ignore */ }` with no `logError` (`populationStorage.ts:132`). This is an *audit-trail*
artifact — a silent write failure means no proof and no indication you have no proof.

**13. (MEDIUM) Mirror freshness depends on an implicit side-effect chain**, not an explicit
invariant: event append → cache invalidation → *maybe* a later stale read triggers rebuild → *that*
resyncs mirrors. A month whose cache stays valid never resyncs its mirrors again. Harmless today
(mirrors are advisory); a trap for any future feature that trusts them.

**14. (MEDIUM) `population.final.json` has two read paths with different resilience.** The
main-thread reader repairs a corrupt live file from `.bak`; the worker raw-text reader explicitly
cannot, because detecting corruption requires the parse being avoided. Same file, different survival
odds depending on which sub-screen is open.

**15. (LOW) `deck2.style-choices.json` is app-layer last-write-wins.** CAS prevents a storage-layer
clobber, but the app always writes the admin's full locally-accumulated choices map, so two admins
editing different slides concurrently can stomp each other's unsynced slides.

**16. (LOW) `month.manifest.json`'s first write is plain `safeWriteJson`**, while every subsequent
status advance uses full CAS. Asymmetric safety across one file's own lifecycle.

**17. (LOW) Three parallel port-accuracy computations** — image-level, decision-level folded, and
decision-level split by L1/L2. Each individually justified, but nothing stops a slide showing two
different "accuracy" figures for the same port with no visual cue. Recommend one parameterized fold
(`grain: "image" | "decision-combined" | "decision-per-level"`) or distinct field naming.

**18. (LOW) Rows with unrecognized L1/L2 results are silently dropped** from the population
(`populationProcessor.ts:762-774`), surfaced only as a summary count. A new result code from the
risk agency would make rows vanish without a prominent prompt.

**19. (LOW) Dead pre-numbered-layout code** in `workspaceDefaults.ts` describes a root-level file
scheme that no longer exists; `loadWorkspaceFiles` hardcodes those fields to `null`.

**20. (LOW) Three same-valued `"1.0.0"` schema constants** for three distinct axes. Easy copy/bump
mistake.

**21. (LOW) Unindexed search.** `rowMatchesSearch` loops every column of every row per keystroke.
It runs in the worker now; a precomputed lowercase blob per row at load time would make it one
contains-check per row.

**22. (LOW) Corrupt label storage silently resets everything** (`labelsStore.ts:601-608`) — no
`logError`, no user-visible signal.

**23. (LOW) `xray_firstrun_dismissed_v1:*` keys accumulate in `localStorage` forever**, permanently
irrelevant after first import, never cleaned up.

**24. (LOW) `.tmp`/`.bak` staging files have no envelope-awareness at the backup layer** — a
mid-write crash could leave a `.tmp` that the generic tree-copy captures as if it were live content.

### Two corrections to the first-pass findings

The traceability pass corrected two things the first audit got wrong. Both are recorded here rather
than quietly dropped:

- **`saveUserBrowseDatasetPreset`'s missing CAS is deliberate and documented**, not an oversight —
  a single-writer carve-out recorded in `docs/edit logs/2026-07-12.md` ("Batch D"). The first pass
  flagged it as a gap. It isn't.
- **`labels.snapshot.json` is written on every individual Settings-tab label edit** when a workspace
  is connected, not only at backup time. That substantially narrows the staleness window the first
  pass described.

---
## Part IX — Documentation drift found

1. **`4-reports/` does not hold generated report artifacts.** All 13 report editions open in a new
   tab via `document.write()` or download via Blob — none are written to the workspace. Only Report
   Designer designs live under `4-reports/`.
2. **The `feedback/` root is undocumented entirely.** Zero mentions in `data-system-report.md`,
   which CLAUDE.md calls authoritative for every file and path.
3. **The audit UI overstates its own coverage** — `AuditSections.tsx` ships display labels for four
   action types that never fire (Finding 1).
4. **Dead layout code in `workspaceDefaults.ts`** describes a superseded root-level file scheme.
5. **No drift found** in the sampling/distribution cluster — CLAUDE.md's description of the three
   distribution files matches the code exactly.

---

## Appendix — Preserved strengths worth not breaking

- **One source of truth for report numbers.** `buildExecutiveReportRows` feeds PowerBI export, the
  Designer, and all six executive editions via `buildReportModel`. They cannot disagree.
- **Determinism guards in sampling.** Algorithm-version stamping plus the deliberate `localeCompare`
  avoidance so Arabic port-name ties resolve identically across machines.
- **Archive-before-trim in the audit log.** A real "never dropped without archiving" invariant —
  archival failure leaves the log over cap rather than losing an entry.
- **Forward-compatible event folding.** Newer-schema events are dropped, never mis-folded.
- **First-wins decision reconciliation.** Deterministic under concurrent supervisors.
- **Index-last / manifest-last write ordering.** Makes a single interrupted commit detectable.
- **Restore is merge-only, never prune**, plus an automatic pre-restore rollback snapshot.
- **The approval flow's defensive pattern** (`approveReferral.ts`) — reload fresh, replay-guard,
  ownership-check against freshly derived state explicitly bypassing the cache, re-verify,
  cross-reviewer guard, first-wins reconcile. This is the reference implementation for
  correctness-critical writes in this codebase; copy it rather than inventing a new pattern.
- **Terminal-vs-retryable error classification in `casLoop`**, keyed on `error.name` rather than
  message text, so a transient Chromium `NotReadableError` isn't mistaken for permission loss.
