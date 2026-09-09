# A — Enhanced Structure and Plan

**Date:** 2026-09-07
**Status:** Revision 2 of the 2026-09-06 architecture study (`docs/next-app/0-PROPOSED-STRUCTURE-SOURCE.md`, 72 sections)
**Baseline app:** XQAP v132.1.0 — `/home/user/XQAP-XRay-Quality-Assurance-Platform`, in production
**Companion documents:** `B-CURRENT-VS-PROPOSED-COMPARISON.md` (side-by-side), `C-VIABILITY-AND-MISTAKES-FIXED.md` (viability verdict and mistake register)

**What this document is.** The next revision of the proposal, not a review of it. It keeps the proposal's correct ideas, corrects the ones that are wrong for this domain, closes the gaps it left open, folds in the operational practices XQAP already paid for in production incidents, and turns the whole thing into something a team can start Phase 0 from on Monday.

---

## 0. Bottom line up front

**The enhanced architecture is the submitted proposal's platform ideas — causal event ordering, per-writer immutable segments with head beacons, a disposable local cache, backup cut vectors, quarantine, a shared report scene model, worker-owned sync — delivered as a sequence of versioned releases of the *existing* React 19 single-HTML app, not as a from-scratch rebuild on a new UI stack.** Five things change materially from the submitted study. (1) The rewrite is dropped: the framework swap to Lit/Web Awesome/Tabulator/ECharts is unjustified against evidence, unpriced against 260 `.tsx` files / 39,701 non-test TSX lines / 23,705 CSS lines / 147 component test files / 1,484 Arabic label keys, and it re-opens the RTL bug class that cost 23 recorded fix rounds. (2) The concurrency design is re-tuned from a chat workload to this one: bounded **in-place** segment rotation instead of micro-batched closed segments, a 30–45 s sync baseline instead of 1–4 s tiers, a **flat** heads directory instead of a three-level `writers/` tree, and a hard per-tick file-operation budget — because the measured bottleneck on the department share is per-file round trips, not bytes (v61.0: 192,063 ops → 78 ops; 3–6 hours → seconds for 8,000 events). (3) Optimistic writes are restricted to append-only personal events; every **ownership-changing** command (assign, reassign, replace, approve, close month, draw sample) stays synchronous, because "decide from a stale in-tab snapshot" is the single most-repeated bug shape in this codebase's history (independently rediscovered five times, v43.6 → v98.5). (4) The storage-format question is re-anchored: the shipped columnar+gzip codec already delivers 139.07 MB → 1.05 MB (132×) on real customer data, so MessagePack/ZSTD/Parquet become benchmark-gated options, while the *actual* unsolved problem — V8's 536,870,888 UTF-16 code-unit `JSON.parse` ceiling, already at 84.9% on a live customer's `bi.raw.json` — is named as a non-negotiable and answered with a partitioned snapshot layout, which the proposal never mentions. (5) A migration and coexistence plan is added, covering live workspaces holding processed months, seeded sample draws and thousands of distribution events — the single largest omission in the submitted study. Everything else in the proposal that is right (sections 5, 9, 12, 13, 26, 32, 38–43, 45–47, 60) is kept and sharpened.

---

## 1. What survives from the proposal unchanged

The study was largely right. These are adopted as written, with only the annotations noted.

| § | Idea | Verdict |
|---|---|---|
| 1, 2 | Single self-contained `.html` artifact; no runtime install; data files are system data, not dependencies | **Keep.** Already true today (`vite-plugin-singlefile`, `dist/index.html` = 4,507,893 bytes on the 2026-09-07 build). |
| 3.1 | Startup capability gate with required/optional reporting | **Keep**, extended with a `file://` column (§4.10). |
| 4 | Layered architecture: UI → domain → local data engine → sync/conflict → file adapter | **Keep.** This is the right shape and XQAP's layering is weaker. |
| 5 | *A mutable physical file should normally have exactly one logical writer* | **Keep — this is the single most important sentence in the study.** XQAP converged on it independently five times (audit per actor, error log per user, notification acks per employee, feedback per thread, answers per writer-session) after incident XQ-IO-032 (2026-08-25). |
| 6 | Durable shared model is domain events | **Keep**, with XQAP's domain event vocabulary substituted for tasks/chat (§4.5, §7). |
| 9 | `writerId = employeeId + deviceId + instanceId` | **Keep.** XQAP already hashes device+session into segment names; the explicit triple is cleaner. |
| 12 | Per-writer head files as cheap change beacons | **Keep**, but flattened (§4.3) — this is one of the study's two best structural ideas. |
| 13 | Ordering by unique event ID + per-writer monotonic sequence + entity baseVersion; timestamps for display only | **Keep — the study's other best idea.** XQAP's fold orders by wall-clock `eventAt` (`src/data/distribution/distributionDerivation.ts`), which is a genuine clock-skew exposure. |
| 14, 15 | Local cache is disposable and reconstructable; share stays the source of truth; `idb` over Dexie; SQLite-WASM rejected as default | **Keep.** The "disposable" framing is exactly the property that makes this safe. |
| 16 | SyncEngine as a first-class named subsystem, not scattered functions | **Keep.** XQAP got here already (`src/data/workspace/workspaceSync.ts` is *the* one sync path) but never named the components. |
| 17.1, 17.2 | `FileSystemObserver` only ever as an accelerator, never a correctness dependency; Web Locks are origin-scoped, never distributed | **Keep.** |
| 18 | Optimization has three dimensions: bytes, file-op count, decode CPU/RAM | **Keep — and then actually enforce it** (the study names file-op count and never budgets it; §4.6). |
| 21 | Array rows, dictionary encoding, numeric dates, omit nulls, never Base64 binaries in bulk data | **Keep.** Already implemented in `src/data/storage/columnarCodec.ts`. |
| 23.1, 23.2 | Do not compress tiny records individually; `serialize → compress → encrypt` ordering | **Keep.** `COMPRESS_MIN_ROWS = 2000` in `src/data/storage/storagePolicy.ts` is the same rule. |
| 25, 57 | Excel parsed in a worker; normalize types once; drop unused columns early; never build giant row-object JSON on the UI thread | **Keep.** Item 3 (*remove unused columns early*) is a real gap in XQAP — `PreparedPopulationRow` carries ~47 fields including `rawRow`. |
| 26 | Workers are mandatory: Data / Sync / Import / Report / Backup | **Keep**, plus a mandatory chunked-transfer rule (§3.9). |
| 32 | Zod at every trust boundary; never apply decoded shared data without validation | **Keep**, extended to three decode outcomes (§3.12). |
| 38–43 | Report Data Model → Report Layout Model → shared tokens → { HTML, PPTX }; never convert finished HTML | **Keep. This is the study's best contribution and the only genuinely new user-facing capability.** |
| 44–47 | Backup / export / archive are three different features; writer cut vectors; hashed integrity manifest; restore validator; quarantine | **Keep.** Directly fixes real XQAP defects (§3.13). |
| 48.2, 48.3 | Never embed a permanent key in the HTML; the real boundary is Windows/SMB/NTFS plus app authorization | **Keep.** Honest and correct. |
| 49, 50 | Permission changes are themselves immutable audited events; a command is not complete until its audit event exists | **Keep.** Closes a real XQAP defect: four declared action types (including `backup-restored`) were never fired at any call site. |
| 51 | Attachment bytes never inside events; events carry metadata + SHA-256 only; do not recompress already-compressed formats | **Keep.** |
| 53.1, 53.3 | `vite-plugin-singlefile`; a build that **fails** unless exactly one `.html`, no external script/stylesheet/font, workers inline, license notices retained | **Keep**, implemented as a build-failing plugin hook rather than a post-hoc script (§3.14). |
| 55 | Feature code never calls File System APIs directly; everything goes through a service → command bus → event store → sync → file adapter | **Keep. Non-negotiable.** |
| 59 | Maintenance only while an authorized instance is open; never delete old events until a new snapshot is written **and verified** | **Keep**, plus the compaction protocol the study omits (§4.4). |
| 60.2, 60.3, 60.4 | Property/fuzz testing over reorder/duplicate/drop/corrupt/clock-skew; N-client concurrency simulation; final benchmarking on the **real** UNC share | **Keep — and pull forward to Phase 1** (§8). XQAP has no property-based testing at all. |
| 62 Phase 0 | Do not build the application before the browser + UNC baseline is confirmed | **Keep**, re-scoped to this domain's volumes (§8). |
| 64 | The explicit-rejections list | **Keep in full.** Every line of it is correct. |
| 65, 66, 67 | The three named risks | **Keep**, with §67 given an actual numeric budget. |

---

## 2. What changes, and why

Each change below is a correction, not a preference. The argument is given, not asserted.

### 2.1 P0 — Re-target the study from a task+chat app to this domain

**Proposal as written:** §7 ("How 10 employees update the same task"), §8's conflict table (chat messages, comments, assignees, counters, due dates, rich collaborative documents), §11.1 (chat flush every 100–500 ms), §17 (1–2 s chat polling), §71 (validation prototype = one task with 10 assignees + one department chat), §62 Phase 4 (task + chat proof-of-architecture).

**Why it must change:** XQAP has no chat and no multi-assignee task. Its actual conflict surfaces are: ownership of an `xrayImageId` through the assign → reassign → complete → replace → reopen lifecycle; four-eyes sample approval; two admins importing or drawing the same month; month close/reopen; and an answer submitted against a row that was replaced underneath it. §8's table contains a rule for none of them. Meanwhile every ownership bug in the edit logs lives in exactly those omitted entities, and the fold that governs them is described in `docs/architecture/DATA_ARCHITECTURE_AND_LESSONS_LEARNED_2026-08-25.md` §4.3 as "the single most bug-prone piece of the whole system."

**Change:** §8 is rewritten per domain entity (§4.5 below). §71's prototype and §62 Phase 4's acceptance criteria are replaced with this domain's real hard cases: a 117,336-row month import, an 8,000-event / 15-employee distribution save, two supervisors approving the same replacement request, a backup taken mid-save, and the incident catalogue from the lessons-learned document §9.

### 2.2 P0 — Incremental adoption inside the existing app, not a rebuild

**Proposal as written:** §62 phases 1–9 build a new platform, then a single paragraph ("Business modules — only after the platform is proven") for what is, in this product, the majority of the code.

**Why it must change:** three independent reasons.

1. **No migration path exists in the study.** §10 has a `system/migrations/` folder and §60.1 lists "schema migrations" as a unit-test topic; nothing converts a live workspace. Real workspaces contain columnar+gzip processed months, `distribution.events/*.ndjson` and `answers.events` segments, per-actor audit files carrying `previousArchiveHash` chains, `users.permissions.json`, and `sample.master.json` files stamped with `rngSeed` + `samplingAlgorithmVersion`. A rewrite that cannot ingest those is a different product.
2. **No estimate exists.** Not one calendar figure appears in 72 sections. The honest number is in §8 below and it is large.
3. **The domain is where the fixes live.** ~348 of the ~960 dated edit-log entries are `Fix:` entries, and most encode domain edge cases (fold legality, re-read-before-ownership-write, draft-preserving refresh, tri-state reads). A rebuild rediscovers them.

**Change:** every idea in this document lands as a normal versioned release of the same single HTML. On-disk changes are additive, or they ship their own admin-triggered, archive-not-delete migration module per the binding CLAUDE.md post-launch policy. No second application, no parallel run, no cutover. §8's phase plan is rewritten accordingly. (If the owner instead wants a *broader* product — tasks, chat, attachments — that is a different decision, and §7.10 says what would still have to be ported.)

### 2.3 P0 — Drop the UI framework swap

**Proposal as written:** §27 (Lit, justified in one sentence: "lightweight; fast reactive rendering; standard Web Components; TypeScript-friendly; low framework lock-in"), §28 (Web Awesome Core), §29 (Tabulator), §30 (ECharts), §62 Phase 6 (one line).

**Why it must change:**

- The study never states a deficiency in React 19 for this use case. The single-file goal is already met by the current build.
- The cost is never priced: 260 `.tsx` files (113 non-test, 39,701 non-test lines), 43 CSS files (23,705 lines), 147 component test files that use Testing Library queries which do not pierce shadow roots, `labelsStore.ts` (1,966 lines, ~1,484 keys), 66 icon-consuming files, and the `tabRegistry ↔ tabCatalog` agreement test.
- Shadow DOM breaks the class-based `src/styles/primitives.css` layer (CSS custom properties inherit through shadow boundaries; class systems do not).
- Every proposed library re-opens the Arabic RTL surface. `docs/research/VISUAL_LIBRARIES_2026-07-14.md` already rated ECharts **SKIP** on exactly this basis ("no built-in bidi/RTL layout; axis/legend mirroring is manual") plus 368 KB gzip, versus the ~21.7 KB gzip of headless `d3-shape` + `d3-scale` currently used. The study cites neither the verdict nor the size.
- RTL appears **once** in the entire study, as a Phase 6 bullet, in an app whose every user-facing string is Arabic and whose numbers are formatted with Latin digits inside Arabic sentences (`AR_LOCALE = "ar-SA-u-nu-latn"` in `src/utils/formatting.ts`) — precisely the mixed-run case that produced 23 recorded RTL/bidi fix entries.

**Change:** React 19 stays. It hosts custom elements natively, so Web Awesome controls, Tabulator and ECharts can each be trialled *inside* the shipped app, one surface at a time, behind an RTL screenshot harness and a bundle-delta gate (§8 Phase 8). The store-first state model (§14) and the shared design tokens (§40) are adopted regardless of framework — they are the parts that actually carry value.

### 2.4 P0 — Port the storage primitives; do not reimplement from §16

**Proposal as written:** §16's SyncEngine component list (`FileAdapter`, `SegmentWriter`, `RetryPolicy`, …) is a sketch; §16.1's durability step is one line ("write immutable shared segment → `close()` → verify persisted bytes/hash").

**Why it must change:** that one line stands in for roughly 3,700 lines of SMB-hardened code encoding 36 distinct `XQ-IO-*` error codes and two named production incidents:

| File | Lines | What it encodes |
|---|---:|---|
| `src/data/storage/safeWrite.ts` | 2,356 | tmp-stage → **byte-exact** staged verify → commit → re-verify, `.bak` snapshot, rollback-or-promote ladder, tri-state read, 4 MB `Blob.slice()` streaming windows |
| `src/data/storage/appendOnlyEventLog.ts` | 1,127 | in-place segment append, 128 KiB rotation, `MAX_SEGMENT_PATH_COMPONENT_CHARS = 48`, per-writer chain lock, checkpoint/dedup, commutative `eventSetDigest` |
| `src/data/storage/casLoop.ts` | 226 | UUID write-token CAS, 10 retries, jittered backoff, 80–180 ms delayed re-verify, DOMException-**name** classification |
| `src/data/storage/transientFileErrors.ts` | — | which `DOMException.name` values are transient vs terminal |
| `src/data/storage/memoryDirectory.ts` | — | the in-memory directory double with simulated permission states that ~160 test files depend on |

A naive "verify bytes after close" on SMB hits exactly the failure v97.1 fixed: a just-written file that is transiently unreadable is **inconclusive**, not failed, and treating it as failed orphaned real assignments in production (`XQ-DIST-007` vs `XQ-DIST-008`).

**Change:** the File Adapter, SegmentWriter and RetryPolicy are defined as thin layers *over the ported code*. §16.1 is treated as a summary of `safeWrite.ts`, not a replacement for it. `memoryDirectory.ts` becomes the adapter's test double on day one.

### 2.5 P0 — Classify commands: ownership vs append-only

**Proposal as written:** §16.1 ("apply optimistic local state → persist to local outbox → write immutable shared segment"), §61 statuses `Saved locally` / `Synced` / …, applied uniformly to every command.

**Why it must change:** the "ownership-conflict bug class — the same shape, independently rediscovered at least five times" (lessons-learned §6.1: v43.6/43.7, v59.9/57.9, v88.0/89.1, v90.0, v98.4/98.5) is precisely *a decision made from a snapshot the tab loaded earlier*. v90.0 — called "the most serious instance" — transferred another employee's already-assigned row with no event trail and no notification. An optimistic assignment shown as "Saved locally" is invisible to every other machine for seconds to minutes, and the next ownership command in that tab builds on it. The outbox is also per-browser-profile: on a shared or roaming Windows PC, an employee who logs off strands unsynced events in a profile nobody reopens.

**Change:** two command classes, enforced at the CommandBus.

| Class | Examples | Policy |
|---|---|---|
| **Append-only / personal** | answer save, inspection note, notification acknowledgement, feedback message, browse preset | Optimistic render allowed; outbox permitted; `Saved locally → Synced` statuses apply. |
| **Ownership-changing** | assign, bulk assign, reassign, replace, replacement approval, referral approval, sample draw, sample approval, month close/reopen, permission change | **Synchronous.** Head scan → re-fold authoritative state → validate → write → verify. Never enters the outbox. No optimistic apply. |

Additional rules: sign-out is blocked until the outbox is empty; the unsynced count is always visible in the shell; and the outbox is discarded/quarantined — never replayed — when the workspace epoch has advanced (§4.9).

### 2.6 P1 — Re-tune segments and polling to this workload

**Proposal as written:** §11 (micro-batched *closed* segments: 20/100/250 events or 64–256 KB, flush every 1–3 s), §11.1 (chat 100–500 ms), §17 (1–2 s / 2–4 s / 8–15 s / 30 s / 30–60 s tiers), §10 (three-level `writers/{month}/{employee}/{device-instance}/segments/`).

**Why it must change:**

- **File count.** At this app's click cadence — one Manual Review action every few seconds — a 1–3 s flush degenerates to roughly one file per user action. That is the shape v61.0 eliminated: 192,063 filesystem operations and 3–6 hours for 8,000 events on the target UNC share, reduced to 78 operations. The current design writes ~18 segment files for a 9,000-event month (128 KiB ≈ 500 events per segment); the proposal's would write thousands, and every reader pays a `getFile()` per segment on every fold **forever**, because §11 defers compaction to "later".
- **Head-scan cost.** With 40 users × ~2 device-instances, a head scan under §10's nested layout needs ~80 `getDirectoryHandle` + ~80 `getFile` calls after three levels of enumeration. Against the Chromium-reported UNC figure (1,000 small file operations: 3.4 s local vs 142 s over a Windows-hosted UNC share — cross-OS, therefore directional only), a single scan is plausibly tens of seconds. The 1–3 s chat target is unreachable and 40 clients polling at 8–15 s would saturate the share. **The exact per-operation cost on the department's share must be benchmarked in Phase 0** — the study names file-op count as a first-class dimension (§18) and then never budgets it.
- **Path length.** `XQ-IO-031`/`XQ-IO-032` were caused by Windows' 260-character path limit on deep UNC paths; the current code carries a hard 48-character segment path-component budget for that reason. §10's layout is deeper than today's and never mentions path length.

**Change:** bounded **in-place** append with rotation at ~128 KiB (retain the current constants as the starting point, re-derived from the Phase 0 numbers); a **flat** `heads/{writerId}.head` directory so a scan is one directory enumeration; a 30–45 s sync baseline plus a focus-triggered probe coalesced to ~10 s (the current `SyncTick.tsx` behaviour); a per-PC sync leader via Web Locks (§17.2, adopted); a measured **files-opened-per-minute budget per client** enforced in CI-visible metrics; and the chat tiers deleted along with the chat feature they exist for.

### 2.7 P1 — Name the read ceiling and fix it with layout, not codec

**Proposal as written:** §19 claims JSON "becomes 250–300 MB"; §24.2 mandates a format benchmark on a "known ~20 MB Excel case"; the V8 string-length ceiling is never mentioned anywhere in 72 sections.

**Why it must change:** the numbers are understated by roughly 2× and the actual failure mode is missing. Measured on real customer data (`docs/edit logs/2026-08-15.md`): a 28,068,581-byte workbook produced a 1,000,805,318-byte workspace (35.66×, where the plan had assumed ~11×); `bi.raw.json` reached 573,236,797 bytes, decoding to 455,755,299 UTF-16 code units against V8's hard maximum of **536,870,888** — 84.9% of a ceiling past which `JSON.parse` throws `RangeError` and the month becomes **unreadable**, not merely slow. Writes were fixed in v86.0 by 4 MB windowed streaming; reads were not, because `JSON.parse` needs the whole string. MessagePack and ZSTD do not move this ceiling — they only slow the approach to it. Only Parquet's column projection or an explicit partitioned layout removes it.

**Change:** the ceiling becomes a non-negotiable in §2 of the architecture. The snapshot layout is **index + parts + bounded LRU** (the design already scoped as Phase C in `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md`, estimated there at 10–18 engineering days and explicitly blocked on backup coordination), regardless of which codec wins the benchmark. Acceptance test: *a 600k-row BI import round-trips without materializing a single JS string or a single object graph over the whole dataset.* The import worker writes the snapshot itself and returns only summary + progress, so React never accumulates the full row array (the Phase D gap that v117.8 explicitly left open).

### 2.8 P1 — Make the shipped format the benchmark baseline

**Proposal as written:** §20's format table and §24.2's six-way benchmark (A naive JSON, B JSON+GZIP, C row-array JSON+ZSTD, D columnar JSON+ZSTD, E MessagePack+ZSTD, F Parquet+ZSTD).

**Why it must change:** test D *is the format currently shipping*, and the study does not know it. `src/data/storage/columnarCodec.ts` + `compressedEnvelope.ts` + `storagePolicy.ts` already deliver, on the real 117,336-row month: `population.final.json` 139.07 MB → 23.41 MB columnar → **1.05 MB** columnar+gzip (132×); `bi.raw.json` 573 MB → 3.4 MB; `risk.raw.json` 211 MB → 1.6 MB; encode 2,699 ms, serialize 270 ms, parse 222 ms, decode 903 ms. Stored size is a solved problem. ZSTD's marginal gain over gzip on top of a 132× reduction is not worth creating a mixed-codec workspace that older HTML copies cannot read.

**Change:** columnar+gzip with a plain uncompressed head line (`"format":"xqapz-gzip-1"`, `COMPRESSED_FORMAT_ID` in `compressedEnvelope.ts`) is the default and the benchmark **baseline column**. MessagePack, ZSTD and Parquet must each beat it on **peak RAM, time-to-first-page with partial reads, and file-operation count** — not on stored size, where they cannot win meaningfully. Any codec adopted keeps the plain head line (so CAS, change probes and format detection stay O(1) via an 8 KB head read regardless of file size) and a `format.meta` minimum-reader-version.

### 2.9 P1 — Specify conflict resolution end to end

**Proposal as written:** §7.2 ("the merge engine later detects that the two changes are incompatible and produces a conflict record"), §61 (a `Conflict requires review` status string).

**Why it must change:** XQAP's real gap is not *detection* — the fold already detects, producing `droppedEventIds` and `absentRowEventIds` — it is *surfacing*. Those arrays are logged via `logError` and never shown to the actor whose action was discarded, and 30+ CAS sites all end in one generic Arabic "write conflict" toast. A conflict record nobody is shown is the same silent drop with more code. The study never says who owns a conflict record, where the queue lives, or what a user can do with one.

**Change:** three things are specified. **Owner:** the acting user for a dropped/rejected event; an admin for import and month-level collisions. **Surface:** a per-user *rejected actions* feed built from `droppedEventIds`/`absentRowEventIds` plus baseVersion mismatches, and an admin conflict queue for workspace-level collisions. **Actions:** per entity — retry against current version, discard, or escalate (§4.5's table names the permitted action per row).

### 2.10 P1 — Close the last-writer-wins gap the study claims to reject

**Proposal as written:** §64 rejects "last writer wins"; §10 has a `snapshots/imports` folder; nothing else.

**Why it must change:** `docs/architecture/data-system-report.md` documents, dated and deliberately deferred, that `risk.raw.json`, `bi.raw.json`, `population.final.json`, `processing.summary.json` and the initial `sample.master.json` draw are protected only by a same-machine Web Lock — two admins processing or drawing the same month from two machines is last-write-wins for the processed output. The cheaper fix was evaluated and deferred on cost grounds (the population file is documented at 10–15 minutes per write on a slow disk, which makes CAS's re-read-and-retry model unaffordable). §64's rejection without a mechanism is an aspiration. Worse: §10's `snapshots/` folders have no stated writer, so a materialized snapshot rewritten by many clients would be the exact anti-pattern §5 forbids.

**Change:** immutable **versioned** snapshots per month (`population.v{n}`) plus one tiny CAS-protected `current` pointer file; the losing admin's snapshot is retained and surfaced rather than overwritten (matching the existing `archiveExistingRaw` → `.superseded.json` behaviour); one elected snapshot writer per workspace for any materialized derived snapshot.

### 2.11 P1 — Write the RTL/Arabic rule set before any UI work

**Proposal as written:** "RTL support" (§62 Phase 6, one bullet) and "Supports RTL presentation configuration" (§37, one clause).

**Why it must change:** 23 RTL/bidi/Western-digit fix entries are recorded across the edit logs (v34.7, v37.13, v40.7, v59.8, v59.46/47, v59.85, v95.1, v120.5, v125.4), the same number-range-reversal shape rediscovered in the executive deck, the changelog tab, the Report Designer ribbon and the sidebar. For PPTX specifically the risk is concrete and verifiable: PptxGenJS emits `rtl="1"` per paragraph, cannot embed fonts, and sets only the `a:latin` theme typeface while Arabic glyphs render from the complex-script slot — and every KPI string this app produces is an Arabic sentence containing Latin digits, which is the known-bad mixed-run case.

**Change:** a written bidi rule set (document-root `dir="rtl"`, logical CSS properties only, Western digits, `unicode-bidi` isolation for mixed runs, explicit directional-icon mirroring) becomes an entry gate, not a Phase 6 bullet. `labelsStore.ts` is ported unchanged and an ESLint rule fails on Arabic literals outside the labels modules (there are currently 1,177 hard-coded Arabic lines across 61 non-test `.tsx` files — the rule stops that growing). Every candidate UI library gets an RTL screenshot harness pass before adoption. An Arabic PPTX fidelity spike on the department's actual Office build is the **entry** gate for the reporting phase, not an exit criterion.

### 2.12 P1 — Restore semantics for running clients

**Proposal as written:** §46 ("restore validation"), §61 ("backup restore verification").

**Why it must change:** the study validates the *archive* and says nothing about the *live system*. XQAP already hand-built what the study omits: a pre-restore rollback backup, a `RESTORE_INPROGRESS` sentinel at the workspace root, and `restoreVisibility` so other machines observe a completed restore. And the study's own local-first outbox makes restore strictly *harder*: a laptop asleep during a restore wakes with queued events newer than the restored cut and re-applies them, silently undoing the rollback.

**Change:** restore bumps a **workspace epoch** in `format.meta`. Every client compares epoch on sync; an outbox from an older epoch is quarantined and surfaced for review, never replayed. The pre-restore rollback backup, in-progress sentinel and cross-machine visibility remain mandatory validator steps. Backups additionally get a first-class "save `.deptbackup` to a second location" admin action recorded in the audit log (today, backups live under `5-system/backups/` on the same share — share loss takes both), and `AUTO_BACKUP_RETENTION_COUNT` semantics (manual and pre-restore kept forever, automatic pruned to 30) are carried forward. Backup encryption (§48.4) ships opt-in only, with a printed recovery key at enablement — a passphrase-derived key with no escrow converts a forgotten passphrase into total loss.

### 2.13 P2 — Compaction protocol

**Proposal as written:** §11 ("the app can later compact thousands of tiny historical segments into larger archive blocks"), §59 (an admin button).

**Why it must change:** compacting *other writers'* immutable segments on a shared folder with no server is a real distributed problem the study waves at. Moving a segment breaks "immutable": a client that enumerated the directory a second earlier gets `NotFound`, which this codebase has correctly learned to treat as transient and retry — producing a retry storm on every compaction. XQAP avoids the problem today only by never compacting, at the cost of unbounded segment accumulation.

**Change:** compaction is an **elected single-writer** admin job: write the archive block → write **and verify** the new snapshot → leave a tombstone marker in place of each archived segment for one release cycle → only then delete. Readers treat "segment missing but its sequence ≤ the snapshot cut" as covered, not as an error. Directory enumeration at 10k and 100k files on the real share must be benchmarked before flush windows and rotation sizes are finalized.

### 2.14 P2 — Three-outcome decode, for old clients on the share

**Proposal as written:** §32 (Zod at trust boundaries) + §47 ("invalid data goes to a quarantine workflow").

**Why it must change:** old copies of the single HTML persist on the share and keep being opened — a documented hard constraint, and the reason `workspacePaths.ts` (695 lines) carries permanent legacy fallbacks. Under §47 as written, an older client encountering a valid *newer* event would fail Zod validation and **quarantine it**, which is worse than skipping it. XQAP's fold already handles this with a per-event `eventSchemaVersion` "preserve existing, drop newer" rule.

**Change:** decode has three outcomes — **accept**; **skip-as-newer** (state marked partial, UI warns the user to update, nothing quarantined); **quarantine-as-invalid**. A client refuses to write when `format.meta.major` exceeds its own.

### 2.15 P2 — Governance, budgets and provenance

**Proposal as written:** §53 names ESLint/Vitest/Playwright; §52/§56/§67 discuss bundle size without a number; §34/§69 say dependencies are "pinned in lockfile". There is no section on versioning, changelog, release process, or risk acceptance anywhere in the study.

**Why it must change:** each of the missing pieces exists in XQAP because of a named incident.

- `npm run typecheck` was `tsc --noEmit` against a solution `tsconfig` with `files: []` — it listed **0** files where `tsc -b` lists 1,029, and silently checked nothing for days, shipping 6 real type errors through already-reviewed commits (v59.68). This is why CLAUDE.md now mandates `npm run build` before every push at every tier.
- SheetJS CE is distributed from the SheetJS CDN, not the npm registry; "pinned in lockfile" either drags in the stale registry package or makes `npm ci` depend on CDN reachability. XQAP vendors `vendor/xlsx-0.20.3.tgz` with a SHA-256 gate (`scripts/check-vendor-integrity.mjs`).
- The proposed stack (ECharts ~368 KB gzip, Tabulator, Web Awesome, PptxGenJS bundling JSZip, Lit, msgpack/fflate/idb, optionally a multi-MB Parquet WASM binary that Base64 inflates by 33%) plausibly takes the artifact from 4,507,893 bytes raw to 8–12 MB — every raw byte read off the share on every open, because `file://` has no content-encoding negotiation. The study has no number to check that against.
- Nine reader agents were able to reconstruct *why* every safeguard in this codebase exists solely because of 53 dated edit logs and ~960 entries.

**Change:** a governance section is added (§3.14) porting the edit-log tier ladder, `scripts/editlog.mjs`, `check:release`, `RELEASE_CHECKLIST.md`, the per-PR bundle/complexity/test-count delta report, a numeric bundle budget seeded from a measured shell, the `SECURITY_MODEL.md` dated-acceptance format, the storage-key registry, the vendored SheetJS gate, `typecheck` as `tsc -b`, `build` mandatory before push, and the `?sim=1` simulated-workspace mechanism that lets Playwright drive the app without a picker gesture.

### 2.16 P2 — Reporting corrections

**Proposal as written:** §38's HTML renderer feeds "Browser UI"; §30/§42 assume ECharts for HTML charts; §39's coordinate space is 16:9-only; §40's `typography.title.size: 32` has no stated unit; §62 Phase 7 builds `ReportModel` + `ReportLayoutModel` + two renderers before any business module exists.

**Why it must change:**

- **The exported artifact is never mentioned.** Every XQAP report today is a self-contained HTML file with fonts, CSS and icons base64-inlined, zero network calls, opened offline from the share or a USB stick and printed to PDF. If the HTML renderer becomes an in-app view with live ECharts, that artifact either disappears or every report file carries ~1 MB of ECharts runtime.
- **Chart mapping.** Of the nine chart kinds currently built (`ui/charts.ts`: ranked bar, donut, gauge, grouped bars, stacked bars, quadrant scatter, heatmap, funnel, sparkline, plus the SPC p-chart with UCL/LCL in `model/reviewerKpis.ts`), only bar, stacked bar, donut/pie and scatter map to native PowerPoint charts. §42's "exception policy" is therefore the *common* path, not the edge.
- **Units.** A/4 portrait documents exist alongside 16:9 decks. If font sizes are in normalized units they scale with the page; if in points they do not; the two renderers will disagree on wrapping until this is pinned.
- **Build-ahead.** Phase 7 as written is the exact shape that produced the Report Designer query engine (`dataModel.ts` / `filters.ts` / `runQuery.ts`, built 2026-06-28 as "Phase 0, Task 0.4", deleted 2026-08-07 with zero non-test callers) and the `table`/`chart` element types in `reportTypes.ts` that still exist and still never render.

**Change:** the standalone-HTML artifact contract is stated explicitly; HTML charts render from the `ChartModel` using the existing SVG-string primitives (deterministic, RTL-proven, zero runtime weight in the exported file); ECharts is confined to the live in-app dashboard if it is adopted at all; page size is parameterized per document kind and font-size units are pinned to the normalized space; the A4 document and the XLSX/CSV exports stay on their current models; and the scene model is anchored to **one** concrete consumer (the executive 16:9 deck, whose content is already fixed by `ReportModel`), growing block kinds only as that deck needs them, with a caller-count gate at phase exit.

---

## 3. Practices ported from the current app

The submitted study ignores almost all of these. They are not style preferences; each one is the residue of a bug that reached production. This section is the part of the document most likely to save the next team six months.

**Index.**

| # | Practice | Origin (evidence) | Lands as |
|---|---|---|---|
| 3.1 | Tri-state reads: absent ≠ unreadable ≠ corrupt | 8 recurrences in 9 days; one rewrote 20 answers as 1 | File Adapter return type |
| 3.2 | Two-outcome write verification | v97.1 / XQ-DIST-007 vs -008 | §16.1 verify step |
| 3.3 | Error classification by `DOMException.name` only | casLoop; Chromium message text unstable | `classifyFsError()` |
| 3.4 | `safeWrite` tmp / bak / commit / re-verify ladder | the whole write path | File Adapter core |
| 3.5 | Per-writer files for many-writer streams; readers never write | XQ-IO-032 (2026-08-25) | SyncEngine invariant |
| 3.6 | Re-read authoritative state before an ownership write | 5 independent rediscoveries | CommandBus policy |
| 3.7 | Refresh never clobbers an unsaved draft | v59.115 + v59.120, same day | Store draft ownership |
| 3.8 | Segment rotation constants and the 48-char path budget | XQ-IO-031/032, v61.0 | SegmentWriter constants |
| 3.9 | Chunked worker transfer with source release | XQ-POP-003 `DataCloneError` OOM | `streamRows()` platform helper |
| 3.10 | Row-count-independent aggregate sidecar | `populationAggregate.ts` | Snapshot summary contract |
| 3.11 | Per-file storage policy + plain head line | `storagePolicy.ts` / `compressedEnvelope.ts` | Format envelope |
| 3.12 | Archive-not-delete migrations, admin-triggered | CLAUDE.md binding policy | `system/migrations/` contract |
| 3.13 | Backup safety sequence | STO-5 torn copy certified complete | Restore validator steps |
| 3.14 | Governance: edit-log ladder, `check:*` gates, bundle budget | v59.68 silent typecheck no-op | Repo scripts + CI, day one |
| 3.15 | Vendored dependency provenance | SheetJS CE is not on the npm registry | `vendor/` + SHA-256 gate |
| 3.16 | Labels store + RTL discipline | 23 RTL fix rounds; 1,484 keys | Platform API + lint rule |
| 3.17 | Metric traceability: no invented figures | grain-mixing bug | Block-level data-source ref |
| 3.18 | Deterministic-by-contract subsystems | sampling / fold / builders | Snapshot-before-change gate |
| 3.19 | Storage registry as single source of truth | `file://` shares one storage bucket | Registry extended to IndexedDB |
| 3.20 | No duplicate state: one place, one name | CLAUDE.md rule; `tokens.ts` drift | Lint + token generation |
| 3.21 | Advisory-only security model, risk-accepted and dated | `SECURITY_MODEL.md` | Acceptance register |
| 3.22 | `file://` compatibility as a first-class constraint | `originDetection.ts`, `storageRegistry.ts` | Phase 0 gate |
| 3.23 | Test doubles + revert-then-fail-then-restore | boot-progress: 5 rounds, none self-caught | Test harness contract |
| 3.24 | Durable per-user fleet error log | 560 firings in 5 days, found by export | Platform service |
| 3.25 | Coded errors with mandatory call-site context | unattributable exhaustion log line | `RetryPolicy` signature |

---

### 3.1 Tri-state reads — "I could not read it" is never "it does not exist"

**What it is.** `safeReadJson` returns a tagged result distinguishing `ok` / `missing` / `corrupt`. `readOptionalJson`'s contract is that **only** a genuine `NotFoundError` maps to the empty default; everything else propagates as a thrown error. `workspaceSync.ts` carries the same distinction into change detection via an `UNPROBED` sentinel, so a failed probe carries the previous baseline forward instead of manufacturing a spurious "changed" on the next healthy tick.

**Why it was learned the hard way.** `docs/architecture/DATA_ARCHITECTURE_AND_LESSONS_LEARNED_2026-08-25.md` §3.1/§10 records this conflation recurring "at least eight separate times across nine days". `safeWrite.ts`'s own header states the consequence: "One transient `NotReadableError` has, in this codebase's history, been enough to rewrite an employee's twenty answers as one, to make a month's distribution log read as zero events, and to truncate the audit trail, every one of them reporting success." On a shared multi-writer folder, an empty default fed into a read-modify-write **becomes the entire file**.

**How it lands.** The File Adapter's read API returns a discriminated union and never `null`. `HeadScanner` returns a tri-state per writer (`changed` / `unchanged` / `unprobed-carry-forward`). The Zod decode step (§2.14) inherits the same discipline with its third outcome. Ported tests: `readFailureNotAbsence.test.ts`, `safeWrite.notFound.test.ts`, `notFoundCauseSurfaced.test.ts`.

### 3.2 Two-outcome write verification

**What it is.** After a write, a read-back that *fails to read* is **inconclusive** — commit and log a warning. A read-back that *succeeds and shows the wrong size or hash* is a genuine bad write — throw.

**Why it was learned the hard way.** v97.1 (2026-08-16): SMB directory-entry propagation lag makes a just-written file transiently unreadable. Treating that as a failed write orphaned real distribution assignments — "the assignee did not see the assignment even after a full page reload." The fix split the outcome into `XQ-DIST-007` (could not confirm) and `XQ-DIST-008` (confirmed wrong), preserving the genuine-failure guard, verified by the existing regression test for exactly that case.

**How it lands.** §16.1's single "verify persisted bytes/hash" step becomes two branches with the ported retry ladder (`VERIFY_READBACK_RETRY_DELAYS_MS`). The `RetryPolicy` component gets an error taxonomy rather than a retry count.

### 3.3 Classify errors by name, never by message text

**What it is.** `casLoop.ts` classifies a lost folder grant strictly from `DOMException.name`, explicitly rejecting message-text matching, and treats `NoModificationAllowedError` as **contention** (retry) rather than permission loss (abort).

**Why it was learned the hard way.** Chromium's transient error message wording is unstable across versions, and a transient `NotReadableError` message can mention permission problems even though a retry succeeds. An earlier misclassification told users they had lost workspace access when a peer merely held a handle open.

**How it lands.** One `classifyFsError()` in the File Adapter, used by every retry policy in the SyncEngine. `src/data/storage/transientFileErrors.ts` ports verbatim.

### 3.4 The `safeWrite` commit ladder

**What it is.** Take a `.bak` snapshot → stage to `.tmp` → verify the staged bytes **byte-for-byte against the exact serialized string** → commit to live → re-verify → rollback-or-promote on failure. Large payloads stream through 4 MB `Blob.slice()` windows so no read, verify or copy path materializes a whole file as one JS string.

**Why it was learned the hard way.** The byte-exact comparison exists because an earlier "does it parse as JSON?" check accepted a **concurrent peer's valid envelope** as if it were the caller's own write. On a shared SMB folder, "parses as valid JSON" is a weak invariant a race can satisfy by accident. The streaming windows exist because real customer files are hundreds of megabytes (§2.7).

**How it lands.** This *is* the File Adapter's write path. `§16.1`'s one-line durability step is documentation of it. A lint rule bans `file.text()` outside the adapter.

### 3.5 Per-writer files, and readers never write

**What it is.** Every many-writer stream is partitioned by writer identity: audit actions per actor, error log per user, notification acknowledgements per employee, feedback per conversation thread, answers per writer-session. And a read/poll path never writes to a shared file.

**Why it was learned the hard way.** Incident **XQ-IO-032** (2026-08-25) is cited by name in at least four modules. The `feedback` `threads.index.json` read path used to repair-and-write-back the index on every call, polled every 60 seconds by every signed-in user; a failed repair left the index exactly as stale, so the next poll rediscovered the same drift with no exit condition — a self-sustaining write storm, one of four bugs converging in an 88-minute window affecting four users. Separately, the audit log's whole-file read-modify-write used the shortest retry ladder in the app (~0.4 s), which `actionLog.ts` observes "on a shared SMB folder is not a ladder at all". The general lesson, quoted from the lessons doc: *"On a shared multi-writer folder, the fix for contention is architectural, not tunable."*

**How it lands.** It is the study's §5 rule, which is kept. Additionally: the SyncEngine asserts that receive-flow code holds **no writable handle** to any shared file; index and cache repair are user-initiated, rate-limited admin actions only (the shape `feedbackStorage.ts`'s opt-in `repairIndex` already has since v122.1).

### 3.6 Re-read authoritative state immediately before an ownership-dependent write

**What it is.** Any decision that depends on *current* ownership re-folds or re-reads the authoritative source immediately before committing. Never from a snapshot the tab loaded earlier.

**Why it was learned the hard way.** Lessons-learned §6.1: *"Ownership-conflict bug class — the same shape, independently rediscovered at least five times"* (v43.6/43.7 cross-supervisor approval race; v59.9/57.9 stale reassignment-approval check; v88.0/89.1 quota corruption from counting raw events instead of live ownership; **v90.0**, "the most serious instance", which transferred another employee's already-assigned row with no event trail and no notification; v98.4/98.5 a replacement approval letting two pending requests claim the same row). An open browser tab's loaded state can be hours stale.

**How it lands.** The command classification in §2.5, enforced at the CommandBus rather than remembered per feature. This is the single most important behavioural rule to carry across.

### 3.7 A refresh must never clobber unsaved local draft state

**What it is.** Background refresh runs in a *silent* mode that swaps data in place without flipping load state or resetting selection/expanded-row state; a dirty-work registry pins tabs with unsaved content against LRU eviction and guards navigation and unload.

**Why it was learned the hard way.** v59.115 (`XrayReferrals.tsx`) and v59.120 (`XrayInspectionResults.tsx`) — the identical bug, two unrelated views, **fixed on the same day**: "every 5-minute tick, or one click of the refresh button by anyone, silently threw away whatever an employee had typed into an open inspection form but not yet saved — no warning, no recovery." Separately, `src/data/workspace/unsavedWorkRegistry.ts` exists solely because the 3-tab mount LRU could destroy a typed answer, and its header notes that none of the affected components "can see an LRU eviction coming."

**How it lands.** The study's store-first model (§14) removes the trigger, but only if draft ownership is stated: **a draft is store state keyed by record id, and the Inbox's "patch in-memory state" step explicitly excludes any entity with an uncommitted local draft.** That exclusion is a required scenario in the §60.3 concurrency simulation, not a code review item.

### 3.8 Segment rotation constants and the path budget

**What it is.** In-place append with rotation at 128 KiB (≈500 events, so a 9,000-event month adds ~18 files), `MAX_SEGMENT_SEQ = 999_999`, and `MAX_SEGMENT_PATH_COMPONENT_CHARS = 48` — a budget that explicitly accounts for the `.crswap` sibling name the File System Access API creates.

**Why it was learned the hard way.** v61.0: the original one-file-per-event model needed 192,063 filesystem operations and 3–6 hours for 8,000 events on the target UNC share. The path budget exists because Windows' 260-character limit on deep UNC paths caused XQ-IO-031 and contributed to XQ-IO-032.

**How it lands.** `SegmentWriter` starts from these constants and re-derives them from the Phase 0 share benchmark. `assertSegmentBaseNameFits` and a **total-path** budget move into the File Adapter so an over-long path fails at write time, not at SMB. §10's directory layout is flattened to fit (§4.2).

### 3.9 Chunked worker transfer with source release

**What it is.** `src/workers/workbookResultStream.ts` streams rows out of the import worker in 5,000-row chunks, releasing each emitted span from the source array (`fill(undefined, …)`) and yielding to the event loop so GC can run, instead of one `postMessage` of the whole dataset.

**Why it was learned the hard way.** **XQ-POP-003**: `structuredClone` (which `postMessage` uses) must serialize its whole argument graph in one contiguous allocation, producing a `DataCloneError: out of memory` on ~500k-row imports. Batching alone would still leave the worker holding the full dataset while the window builds its own copy.

**How it lands.** A shared `streamRows()` helper is a platform API used by the Data, Import and Report workers; posting a whole dataset in one message is forbidden. Note that the v117.8 edit log flags the specific claim "no XQ-POP-003 on a large real import" as **never verified against a real large workbook** — so this remains an item for the Phase 0 benchmark with real data.

### 3.10 Row-count-independent aggregate sidecar

**What it is.** `src/data/population/populationAggregate.ts` persists exactly the summary fields the Population tab needs, so an already-processed (especially LOCKED) month renders **without reading** `population.final.json` / `risk.raw.json` / `bi.raw.json` again, regardless of size.

**Why it was learned the hard way.** It bounds read cost for the common "view a past month" case at near-zero complexity, without waiting for the full partitioning redesign — a partial mitigation that shipped well ahead of the structural fix.

**How it lands.** It is the concrete form of the study's §58 "report index / snapshot". Contract: **every snapshot write also writes a small summary document**; the UI reads the summary first and detail on demand.

### 3.11 Per-file storage policy, and a plain head line on compressed files

**What it is.** `resolveStoragePolicy()` in `src/data/storage/storagePolicy.ts` maps only six known-large file names to compress/columnar policies, gated by `COMPRESS_MIN_ROWS = 2000` checked on array length (O(1), structural). Compressed files are framed as one **plain UTF-8 head line** carrying `{"format":"xqapz-gzip-1", schemaVersion, revision, contentHash, …}` followed by the gzip body, so CAS and change probes read revision/hash from an 8 KB head read regardless of file size, and gzip's CRC32/ISIZE make truncation a hard read error. Reading is fully format-agnostic.

**Why it was learned the hard way.** The 2026-08-04 optimization audit rated gzip **2/10** ("solves bandwidth, not round-trip latency… loses human-readable workspace files and silently breaks backups unless the backup path is rewritten") — and was overturned 11 days later when real customer data forced the issue. The design that shipped is the one that keeps the audit's objections true: small files stay plain and inspectable, ~250 existing test fixtures keep writing plain JSON unchanged, and removing a file from the table only changes future writes.

**How it lands.** Every snapshot and segment write consults a policy function; policy is data, not scattered flags. Any adopted binary codec keeps the plain head line and the self-describing per-file format id — which is also the mechanism that makes mixed-codec workspaces survivable (§2.8).

### 3.12 Archive-not-delete, admin-triggered migrations

**What it is.** CLAUDE.md's binding post-launch policy: any change to a workspace file's on-disk shape ships **its own migration**, offered to an admin (never silent, never for a non-admin role), migrating every affected file, with pre-migration originals **archived, never hard-deleted** — the precedent `feedbackStorage.ts`'s `finalizeLegacyMigration` set (`messages.json` → `messages.json.migrated`). Superseded raw imports follow the same rule (`archiveExistingRaw` → `.superseded.json`).

**Why it was learned the hard way.** The alternative — permanent legacy fallback read paths — is what `workspacePaths.ts` (695 lines) is, and it has its own documented catastrophe: the create branch used to create the numbered root unconditionally, so "one ordinary autosave next to an existing legacy folder made every legacy month permanently invisible, and there is no migration that moves the content across." Also on record: *"a rewrite that runs before the user has done anything turns every read into a write, and a bad read into durable data loss."*

**How it lands.** This is the contract for §10's `system/migrations/` and `archive/`. Every migration is an explicit, tested module with a dry-run verify step, never an inline branch inside a read function. §59's "never delete until verified" extends to migrations.

### 3.13 The backup safety sequence

**What it is.** Byte-verified copy with one retry; event-segment files fail **loudly** while last-writer-wins files that vanish mid-walk are skipped as expected churn; `backup.complete.json` written **last**; `assertBackupComplete`'s hard refusal of an incomplete backup; a pre-restore rollback backup; a `RESTORE_INPROGRESS` sentinel; `restoreVisibility` so other machines see a completed restore; derived caches explicitly dropped rather than restored; `AUTO_BACKUP_RETENTION_COUNT` = 30 automatic, manual and pre-restore kept forever.

**Why it was learned the hard way.** **STO-5**: "A share that dropped mid-flush left a truncated file inside a folder the manifest then certified as a complete backup — discovered only by a restore that needed it."

**How it lands.** These become the mandatory pre- and post-steps of the study's §46 restore validator. The cut vector (§45) replaces the *consistency* half of the problem; it does not replace any of these operational steps.

### 3.14 Governance: the edit-log ladder, the `check:*` gates, the bundle budget

**What it is.**

| Gate | Command | What it protects |
|---|---|---|
| Edit-log entry | `npm run editlog -- --tier=N "…"` | Every change is recorded with version, date, changed files, line counts, and the gate list for its tier |
| Release consistency | `npm run check:release` | `package.json` version ↔ latest dated edit-log entry agree |
| Vendor integrity | `npm run check:vendor` | Vendored SheetJS tarball SHA-256 matches `vendor/README.md` |
| Complexity budget | `npm run check:complexity` | Regression budget on complexity / max function length |
| Hex-literal guard | `npm run check:hex-literals` | Raw colour literals cannot creep back into swept CSS |
| Bundle size | `npm run check:bundle-size` | Hard ceiling 30 MB raw / 10 MB gzip, every raise recorded in-file with feature and measured overage |
| Type check | `npm run typecheck` (**`tsc -b`**) | See below |
| Build | `npm run build` | Mandatory before push at **every** tier |

**Why it was learned the hard way.** v59.68: `typecheck` was a bare `tsc --noEmit` against a solution `tsconfig` with `files: []` — `npx tsc --noEmit --listFiles` returned **0** lines where `tsc -b --listFiles` returned **1,029**. CI gated on the same no-op. Six real type errors shipped across several already-reviewed commits through an entire multi-day feature effort, and `dist/index.html` had been stale for five days before anyone noticed. That is why CLAUDE.md now states: *"a green `test:run` has hidden real type errors in this repo."* The bundle ceiling carries its own written reasoning: the app is opened as `file://` from a Windows share, so there is no content-encoding negotiation and **every raw byte is read off the share on every open** — which is why the per-PR `Measure` job reporting raw/gzip delta against `main` matters more than the headroom.

**How it lands.** Copied into the tree on day one of Phase 1 — `CLAUDE.md`'s ladder section, `scripts/editlog.mjs`, `scripts/check-release-consistency.mjs`, `scripts/check-bundle-size.mjs`, `scripts/check-vendor-integrity.mjs`, `scripts/check-hex-literals.mjs`, `ci.yml`, `codeql.yml`, `e2e.yml`, `RELEASE_CHECKLIST.md`. The bundle budget is re-seeded from a measured shell rather than a round number, and the hex-literal guard is pointed additionally at the report theme/renderer directories (§3.20).

### 3.15 Vendored dependency provenance

**What it is.** `xlsx` is `file:vendor/xlsx-0.20.3.tgz` in `package.json`, sourced from the SheetJS CDN tarball, with `scripts/check-vendor-integrity.mjs` pinning its SHA-256 and `vendor/README.md` documenting the upgrade procedure.

**Why it was learned the hard way.** Current SheetJS CE is not published to the npm registry; the registry `xlsx` package is stale. Vendoring is what makes `npm ci` work without network access to that CDN, which CI requires.

**How it lands.** `vendor/` and `check:vendor` are carried over unchanged. The study's §34/§69 "pinned in lockfile" is corrected to "vendored with a checksum gate" for SheetJS specifically. The same rule applies to any future CDN-distributed dependency.

### 3.16 The labels store and the RTL discipline

**What it is.** `src/data/labels/labelsStore.ts` (1,966 lines, 1,484 `DEFAULT_LABELS` keys) with `getLabels()` for reads and `useLabels()` for components that must re-render on override; admin overrides persisted under a **registered** browser-storage key. Plus the layout discipline: `dir="rtl"` on container roots (76 roots in TSX today), logical CSS properties strongly preferred over physical (161 uses vs 30), numeric columns end-aligned with tabular figures, Western digits in reports, directional icons explicitly mirrored.

**Why it was learned the hard way.** 23 RTL/bidi/Western-digit fix entries, the same number-range-reversal shape rediscovered across the executive deck, the changelog tab, the Report Designer ribbon and the sidebar (v34.7, v40.7, v59.8 …), plus one shipped back-icon-pointing-the-wrong-way bug (v59.85). And the discipline is *only partially enforced today*: 1,177 hard-coded Arabic lines remain across 61 non-test `.tsx` files despite the rule.

**How it lands.** `labelsStore.ts` moves unchanged into the platform UI layer; an ESLint rule fails the build on Arabic literals outside the labels modules so the existing backlog cannot grow; the bidi rule set is written down before any UI phase; every candidate library gets an RTL screenshot harness pass as an adoption gate.

### 3.17 Metric traceability — never invent a figure to make a report look complete

**What it is.** CLAUDE.md's project-wide hard rule: every matrix, KPI or measure shown in any report must already exist in the app and be mapped from the app's own data (population / sample / distribution / answers). If the underlying data does not exist, add it to the data layer first or leave the metric out. Reinforced by one computed `ReportModel` per generation — *"renderers display; they never recompute"* — and by `sourceRevisions.ts` provenance printed in every report footer and Excel metadata sheet.

**Why it was learned the hard way.** `docs/product/EXECUTIVE_REPORT_CONTENT_MAP.md`'s grain warning: mixing grains "is how the report previously called a port *excellent* on one page and *below target* on another in the same run."

**How it lands.** The study's undescribed "Report Data Model" box (§38) *is* `ReportModel`, ported with its doctrine. Scene builders are pure functions of it; a lint boundary forbids renderer modules importing from the data layer outside the model; and `TextBlock`/`KpiBlock` carry a **required data-source reference** (a field path or `ReportModel` key) so a free-form text block cannot hardcode a number. Scene metadata carries `sourceRevisions` so both the HTML footer and the PPTX footer/notes print it.

### 3.18 Deterministic-by-contract subsystems

**What it is.** Sampling, distribution event folding, and every report/export builder are deterministic by contract. Snapshot the output **first**, then change, then diff. `SamplingPlan` persists both `rngSeed` (Mulberry32 via `hashSeedString`) and `samplingAlgorithmVersion`; `SAMPLING_ALGORITHM_VERSION` is bumped only on a deliberate, approved semantic change to `drawSample`.

**Why it was learned the hard way.** The version stamp is how a historical draw is recognised as **non-replayable** under current code rather than silently reproducing a different result. The fold has a commutative `eventSetDigest` over folded event IDs so a derived cache is trusted or discarded, never patched. There is even a golden test proving that `yieldToMain()` chunking in the deck builder changed timing and never output.

**How it lands.** Three ways. (1) Snapshot fixtures exported from real workspaces become the **acceptance oracle** for every platform change (§8 Phase 1). (2) Snapshot metadata carries the event-set digest and the algorithm versions it covers; a snapshot whose digest disagrees with the segments is discarded, never repaired. (3) The determinism contract extends to the new renderers: snapshot the scene JSON and the HTML string; compare PPTX by unzipping and normalizing timestamps (PptxGenJS output is **not** byte-deterministic — `docProps` created/modified stamps and zip entry dates vary), with the clock injected at the scene-builder boundary as `buildExecutiveDeckV2` already does at its call site.

### 3.19 The storage registry as the single source of truth for browser storage

**What it is.** `src/data/storage/storageRegistry.ts` (233 lines) is a tested table of every `localStorage` / `sessionStorage` / IndexedDB key the app owns, each with a documented purpose and loss consequence. The reset function removes **only registered keys** and never calls a blanket clear. `storageKeyCoverage.test.ts` fails the suite on an unregistered key.

**Why it was learned the hard way.** Its header explains it: the app often runs from a `file://` origin **shared with other local HTML apps on the same machine**, so a blanket `clear()` would destroy unrelated data.

**How it lands.** Extended to cover every IndexedDB database and object store the new local cache creates, the outbox, and the `deviceId`. Databases are namespaced by a hash of the workspace root so one workspace's cache cannot serve another; cache entries are keyed by `(workspace, app user, month)` so a shared Windows PC does not serve one user's cache to the next. The §59 "Repair Local Cache" action iterates the registry — it does not blanket-clear.

### 3.20 No duplicate state — one place, one name, called everywhere

**What it is.** CLAUDE.md's rule: a shared value (a logo, a colour, a constant, a threshold, a piece of derived data) is defined in exactly one module and imported by every consumer. Before adding a constant, grep for one that already means the same thing.

**Why it was learned the hard way.** The counter-example is in the tree right now. `src/data/reporting/executive/ui/tokens.ts` declares itself "Centralized design tokens for the executive-report visual system. Single source of truth for spacing, type scale, and the color-role map" — and `grep -rln "ui/tokens" src/data/reporting/executive` returns only `ui/charts.ts` and `ui/analyticsCharts.ts`. `deck2/theme.ts` (2,289 lines), `deck3/theme.ts` (480 lines) and the document themes each hardcode their own values as standalone CSS template literals. Three parallel deck editions drifted apart under a document that said they should not. Separately, the identical casLoop retry configuration is duplicated inline at two call sites instead of being a shared named constant.

**How it lands.** Two mechanisms, because a rule without enforcement is what produced `tokens.ts`. (1) **One generated tokens module** emits the app's CSS custom properties, any third-party control overrides, and `reportTheme` — three consumers, one definition. (2) The hex-literal regression guard is pointed at the report theme and renderer directories with a zero baseline, and a test asserts the renderers import colours and sizes only from the token module. (The guard's value is measured: literal counts grew 287 → 310 in the window where no guard covered them.)

### 3.21 The advisory-only security model, already risk-accepted

**What it is.** `docs/architecture/SECURITY_MODEL.md` states it plainly: with no backend, all role/permission checks run in the browser and all business data is plain JSON on disk; a determined user can edit `localStorage` or the JSON files directly to self-elevate or tamper. The auth layer is a UX/role-routing guard, **not a trust boundary**. The bootstrap admin hash ships in the client bundle, so the passcode must be strong because it is offline-crackable. Each exposure — trust boundary, bootstrap-hash exposure, demo credential, `localStorage` tamperability, hash-chain tamper-*evidence* only, the 7-day `localStorage` session relaxation (SEC-02), NCA ECC-2:2024 out of scope — is a **dated, owner-signed acceptance**. Password hashing is Argon2id via `hash-wasm` (m = 19 MiB, t = 2, p = 1, the OWASP 2026 baseline) with legacy PBKDF2-SHA256 hashes transparently upgraded on successful login.

**Why it matters here.** The study's §49 restates this posture almost verbatim but records no acceptances and no owner. Its one substantive addition — NTFS ACLs as the real boundary — is under-specified: a browser has **no API to learn the Windows username**, so an app-assigned `writerId` (§9) cannot be bound to the ACL identity. A user logged into the app as a supervisor still emits supervisor-role events from whatever directory Windows lets them write, and app-created per-writer directories inherit the parent's permissive ACL, which dissolves the boundary entirely. §48.4 also proposes passphrase-derived backup keys with no escrow.

**How it lands.** `SECURITY_MODEL.md` is carried over as the acceptance register and extended with two new sections: the ACL deployment model and backup encryption. The ACL model gains an identity-binding mechanism — **probe-based discovery**: on connect the app writes a probe file into each candidate employee writer directory; the one that succeeds is the Windows-enforced identity, and app login then only selects a *role* within that identity, with role snapshots themselves admin-ACL'd. The residual (an admin's Windows account can forge anything) is recorded as a dated acceptance rather than papered over. `passwordCrypto.ts` ports unchanged and is reused for the §48.4 backup KDF instead of "an embedded Argon2id WASM library can be considered".

### 3.22 `file://` compatibility as a first-class constraint

**What it is.** The primary deployment is a double-clicked `dist/index.html` (`src/data/storage/originDetection.ts` detects it). Consequences already encoded in the codebase: all local HTML apps share one storage bucket; `navigator.storage.persist` is unavailable; and — established by the earlier browser-technologies audit — `BroadcastChannel` does not cross tabs at `file://` because each page gets an opaque origin.

**Why it matters here.** The word `file://` does not appear in the 72-section study. Yet §14 puts the entire materialized state in IndexedDB and §17.2 uses `BroadcastChannel` for same-PC coordination — both load-bearing, both behaving differently in the deployment the app actually ships in. §3.1's capability gate would also **block the app entirely** if any listed capability is absent at `file://`.

**How it lands.** `file://` becomes an explicit column in the Phase 0 capability harness, tested on the department's managed Edge build opened from a UNC path. Every required capability is verified there before the gate list is finalized. If cross-tab coordination proves unavailable, the design falls back to a per-tab sync leader with a longer interval rather than assuming `BroadcastChannel`; the option of serving the artifact over a static HTTP path is recorded as the alternative but not assumed.

### 3.23 The test harness: an in-memory directory double, and revert-then-fail-then-restore

**What it is.** `src/data/storage/memoryDirectory.ts` is an in-memory `FileSystemDirectoryHandle` double with simulated permission states, used by roughly 160 test files; it models the API's lazy `getFile()` / content-read cost split, which is what makes storage-layer contention, permission-loss and read-failure paths unit-testable at all. And the verification discipline: temporarily **revert** the fix, confirm the new regression test actually **fails**, then restore and confirm green.

**Why it was learned the hard way.** The boot-progress checklist regressed **five consecutive times in one evening** (v59.190–v59.197): subscribed too late for React's child-before-parent effect order; the fix reintroduced the same shape in a dismissal latch; the third fix's state machine was correct but loaded faster than a human could read; the fourth regressed a genuine remount to a permanently-stuck empty checklist. **Every round was caught by adversarial review, not by the implementer's own tests** — including after real-browser confirmation. CLAUDE.md still flags the area. The stated reason: *"A test suite that always constructs the 'safe' ordering will never catch a timing bug that depends on the 'unsafe' one."* And a test that passes with the fix present but was never confirmed to fail without it is not evidence of anything.

**How it lands.** `memoryDirectory.ts` is adapted to the File Adapter interface **before** any event-store code is written, and becomes the substrate for the study's §60.3 concurrency simulation — with fault injection as first-class scenarios: transient `NotReadableError`, `NotFound`-after-write, permission revocation mid-write, backup during append, compaction during fold. Revert-then-fail-then-restore is a required line in the edit-log entry for any bug fix. The Node-based bench harness in `scripts/bench/` is kept **with its honesty notes** ("Node's `fs` does NOT reproduce Chromium's File System Access per-file overhead") so nobody mistakes a local number for a share number.

### 3.24 The durable per-user fleet error log

**What it is.** A two-tier log. `src/data/storage/errorLogger.ts` is an in-memory 50-entry ring buffer for silent-catch observability; `src/data/errorLog/` is the durable half, writing **per-user** files under `5-system/system-errors/` with per-user yearly archives and an admin XLSX export. `registerErrorSink` lets the durable half install itself without `errorLogger.ts` importing the workspace layer (which would cycle through `safeWrite.ts`).

**Why it was learned the hard way.** v130.11: a real admin-exported error log covering 2026-08-25 to 2026-08-30 (1,181 rows) showed `distribution:checkpoint-mismatch` firing **560 times across ~4 users in 5 days** — by far the largest single action in the log, dwarfing every classified error code. It turned out to be a benign same-write-cycle race (two non-atomic writes of `distribution.current.json` and `distribution.checkpoint.json`, with readers landing between them), but nothing except the export would have surfaced it, and the first proposed fix was correctly *rejected* because it could have silently dropped events.

**How it lands.** Ported as a platform service. The study's §16 `Metrics` component is the in-engine half only; the durable, exportable, per-user half is what makes fleet behaviour visible. Extended with the §71 metrics that actually matter here: files opened per minute and bytes read per client.

### 3.25 Coded errors with mandatory call-site context

**What it is.** 36 distinct `XQ-IO-*` codes (`XQ-IO-001` … `XQ-IO-036` in `src/data/storage/errorCodes.ts`), plus `XQ-DIST-*` and `XQ-POP-*` families, and an optional context string on `casLoop`.

**Why it was learned the hard way.** `casLoop.ts`'s own documentation records that most of its ~25 call sites log an identical, unattributable exhaustion message unless the caller remembers to pass the context — which is exactly why an admin log entry from the XQ-IO-032 incident date could not be attributed to any specific writer. Per-call-site observability was added *after* the incident rather than being mandatory from the start.

**How it lands.** `RetryPolicy` and `Metrics` take a **mandatory** context parameter. No anonymous retry loops. Every new failure mode gets a code before it gets a fix.

---

## 4. The enhanced architecture

### 4.0 Non-negotiables

These sit above every design decision below. The study's §1/§2 list is kept and four items are added (marked ★).

1. The runtime artifact is exactly one `.html` file with no external script, stylesheet, font, image or WASM fetch.
2. A mutable physical file has exactly one logical writer. Shared state is reconstructed from immutable per-writer changes.
3. No silent data loss and no silent overwrite. A success toast means the stated persistence level actually succeeded.
4. Business conflict decisions use versions and causality, never wall-clock timestamps.
5. Feature code never touches File System APIs directly.
6. ★ **No read path may require a single JS string, or a single object graph, over an entire monthly dataset.** V8's `JSON.parse` ceiling is 536,870,888 UTF-16 code units and real customer data is already at 84.9% of it.
7. ★ **Per-file round-trip count on the share is a budgeted resource**, measured per client per minute, not an emergent property.
8. ★ **Ownership-changing commands are never optimistic.** They re-read authoritative state immediately before deciding.
9. ★ **An older copy of the HTML, still on the share, must never corrupt or quarantine a newer workspace's data**, and must never be able to write a shape it cannot read.

### 4.1 Layer map

```text
                 UI  (React 19 + co-located CSS + labels + RTL rules)
                     reads only from the local store; owns drafts
                                    │
                 Domain / Application Layer
                     Services → CommandBus → command classification
                     (append-only | ownership-changing) → permissions → validation
                                    │
                 Local Data Engine
                     in-memory state + IndexedDB cache (disposable)
                     + outbox (append-only commands only)
                     + draft registry (never merged over)
                                    │
                 Sync Engine   [SyncWorker]
                     WriterManager · HeadScanner · SegmentReader · SegmentWriter
                     EventDeduplicator · VersionTracker · ConflictResolver
                     Outbox · Inbox · RetryPolicy · ConnectivityState · Metrics
                                    │
                 File Adapter   ← ported verbatim from safeWrite.ts /
                     appendOnlyEventLog.ts / casLoop.ts / transientFileErrors.ts
                     tri-state reads · two-outcome verify · classifyFsError
                     · streaming windows · path budget · storage policy
                                    │
                 Windows SMB / UNC share
        ┌───────────────┬────────────────┬───────────────┬──────────────┐
     heads/         events/          snapshots/      attachments/    backups/
   (flat, tiny)  (per-writer,       (immutable,      (original       (cut-vector,
                  in-place append,   versioned,       binaries)       hashed manifest)
                  128 KiB rotation)  partitioned)
```

Two rules bind the layers. **Downward:** a layer may only call the layer directly below it. **Upward:** the Sync Engine notifies the Local Data Engine with a *change set*; it never reaches into the UI. The current app already enforces the second rule through `dataRefreshSignal.ts`, and enforcing the first is what §55 asks for.

### 4.2 Corrected shared-folder layout

The study's §10 layout is corrected for four things: path depth (Windows 260-char limit, `XQ-IO-031`), head-scan cost (flat enumeration), snapshot versioning (the LWW gap of §2.10), and human inspectability during incidents.

```text
\\SERVER\XQAP\Data\
│
├── system/
│   ├── format.meta                 ← JSON, plain. major/minor, epoch, minimum-reader-version
│   ├── workspace.schema.json       ← layout detection stamp (existing concept, kept)
│   ├── migrations/                 ← one record per applied migration; admin-triggered only
│   └── locks/                      ← advisory markers (month lock, restore-in-progress)
│
├── heads/                          ← FLAT. one enumeration = full head scan
│   ├── EMP001~9F3A~01.head         ← JSON, plain, tiny: {writerId, sequence, segment,
│   ├── EMP001~9F3A~02.head            lastEventId, updatedAt, epoch}
│   └── EMP014~112B~01.head
│
├── events/                         ← per-writer streams; one logical writer per file
│   └── {period}/                   ← e.g. 2026-09  (ONE level, not three)
│       ├── EMP001~9F3A~01~000001.seg
│       ├── EMP001~9F3A~01~000002.seg
│       └── EMP002~C821~01~000001.seg
│                                   ← name budget: ≤48 chars incl. the .crswap sibling
│
├── snapshots/
│   ├── population/{month}/
│   │   ├── current.json            ← TINY, CAS-protected pointer → active version
│   │   ├── v3/index.json           ← partition index: parts, row ranges, digests
│   │   ├── v3/part-000.dat …       ← ~10k rows each; bounded-LRU readable
│   │   ├── v3/summary.json         ← row-count-independent aggregate (§3.10)
│   │   └── v2/…                    ← superseded, retained, never overwritten
│   ├── distribution/{month}/       ← folded state + checkpoint (derived, rebuildable)
│   ├── answers/{month}/
│   ├── users/                      ← permission snapshot (admin-ACL'd; see §4.10)
│   └── reports/
│
├── attachments/{domain}/{period}/  ← original binaries; metadata lives in events
│
├── backups/                        ← .deptbackup containers + manifests
├── quarantine/                     ← segments/records that failed verification
└── archive/                        ← compacted event blocks; pre-migration originals
```

Notes that matter:

- **`heads/` is flat and that is the point.** A head scan is one `values()` enumeration plus N `getFile()` calls, not three levels of `getDirectoryHandle` first. The `~` separator keeps the writer triple parseable from the filename without a directory per component.
- **`events/` is one period level deep.** The study's `writers/{month}/{employee}/{device-instance}/segments/` is four levels; combined with a UNC root of realistic length that is exactly the shape that caused XQ-IO-031. The File Adapter asserts the total path budget at write time.
- **`snapshots/…/current.json` is the only mutable file in the snapshot tree**, it is tiny, and it is CAS-protected. Everything it points at is immutable. That is what closes the last-writer-wins gap without paying CAS's cost on a multi-hundred-megabyte file.
- **`format.meta`, `heads/*.head`, `*/index.json`, `summary.json` and every manifest stay plain JSON**, whatever codec the bulk data uses. An operator must be able to open them in Notepad during an incident, because that is how every `XQ-IO-*` incident in this repo was actually diagnosed.
- Legacy roots (`1-population/` … `6-templates/`) are not deleted. See §7.

### 4.3 Events, segments and heads

**Event envelope** (fields marked ★ are additions over the current app):

| Field | Purpose |
|---|---|
| `eventId` | Globally unique; the dedup key. Already present. |
| `writerId` | `employeeId~deviceId~instanceId`. Already hashed into segment names; now explicit. |
| ★ `sequence` | Per-writer monotonic. Drives ordering and head beacons. |
| `entityType`, `entityId` | e.g. `distribution` / `xrayImageId`. |
| `operation` | The domain event type (§7). |
| ★ `baseVersion` | The entity version the actor observed. Drives causal conflict detection. |
| `eventAt` | **Display only.** No longer participates in ordering. |
| `eventSchemaVersion` | Kept. Drives the skip-as-newer rule (§2.14). |
| `sourceRequestId` | Kept. Command-level idempotency, which the study has no equivalent for. |
| `actor`, `payload` | As today. |

**Ordering rule.** Fold order is `(writerId, sequence)` per writer, merged deterministically across writers; cross-writer causality is enforced by `baseVersion` against the entity's current version, not by comparing clocks. The existing legality table (`distributionDerivation.ts`) remains the **resolution** rule — a `baseVersion` mismatch becomes an explicit *dropped-with-reason* outcome surfaced to the actor, rather than a clock-dependent silent drop.

**Segments.** In-place append; rotate at ~128 KiB (start from the current constant, re-derive from Phase 0); one open segment per writer session; post-close size verification; three-tier degrading durability retained (append → retry on a freshly-resolved directory handle → fallback path) so a save never silently fails outright. **No micro-batched closed segments.** A segment is closed on rotation or session end, not on a timer.

**Heads.** One tiny plain-JSON file per writer instance, written by that writer only, carrying `sequence`, current `segment`, `lastEventId`, `updatedAt`, and the workspace `epoch`. A reader that sees an unchanged `sequence` does zero work. A reader that sees `1938 → 1944` fetches exactly the missing range. The head is the *only* thing polled on the steady-state path.

**Budget.** Per-client per-tick file operations are budgeted, and the budget is a number set from Phase 0 measurement, not a target. Today's baseline is ~29 metadata round trips per unchanged 45-second tick for a 20-employee/3-supervisor month, against a design ceiling of ~40. Whatever the new design costs, it must be **measured against that** and must not regress it.

### 4.4 Snapshots, partitions and the local cache

Three tiers, each with a different durability claim:

| Tier | Where | Authority | Rebuild cost |
|---|---|---|---|
| Immutable versioned snapshot (`v{n}/`) | share | **authoritative** for bulk data | n/a |
| Derived fold + checkpoint | share | rebuildable from segments | seconds–minutes |
| IndexedDB local cache | browser profile | **never authoritative** | full re-read (budgeted, not free) |

**Partitioned snapshot format.** `index.json` lists parts with row ranges and per-part digests; parts hold ~10k rows each in the winning codec; a bounded LRU holds decoded parts in the worker. This is the design already scoped as Phase C in `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` (estimated 10–18 engineering days, and stated there as blocked on backup/restore/audit being able to copy `index.json` **plus every referenced part** and reject incomplete sets). That sequencing dependency is honoured in §8 — backup v2 ships before partitioning.

**Local cache rules.**

- Database namespaced by a hash of the workspace root; entries keyed by `(workspace, app user, month)` — a shared Windows PC must not serve one user's cache to the next.
- Every store registered in the storage registry with a documented loss consequence (§3.19).
- Invalidated by `(snapshot version, per-writer head sequences)`. Nothing else.
- **Never consulted for an ownership decision** (§4.7).
- Cold-rebuild cost is a budgeted, benchmarked path — not an assumption. A managed Windows profile may clear it by policy.

**Compaction** (the protocol §11/§59 omit): an elected single writer, per period. Write archive block → write **and verify** the new snapshot → write a tombstone marker in place of each archived segment → wait one release cycle → delete. Readers treat "segment missing, sequence ≤ snapshot cut" as covered, never as an error, which is what prevents a `NotFound`-retry storm on every compaction.

### 4.5 Conflict policy — this domain's entities

This replaces §8's table wholesale. `Base` = `baseVersion` check; `LegalityTable` = the existing fold's terminal-state rules; `CAS` = compare-and-swap on a small shared file; `Append` = commutative, no conflict possible.

| Entity / operation | Storage shape | Concurrency rule | On conflict | Who resolves | Command class |
|---|---|---|---|---|---|
| Population month — raw import (`risk`, `bi`) | immutable versioned snapshot + CAS pointer | versioned write; pointer CAS | both retained; loser surfaced with its version and importer | admin (chooses live version) | ownership |
| Population month — processed output | immutable versioned snapshot + CAS pointer | as above | both retained | admin | ownership |
| Population month — corrections | event | Append + `Base` per row | reject with reason | acting user | ownership |
| Month lock / close / reopen | small CAS'd state file + event | `CAS` + `LegalityTable` | reject; show current state | admin | ownership |
| Sample draw (`sample.master`) | immutable versioned snapshot + CAS pointer | pointer CAS under lock; `samplingAlgorithmVersion` + `rngSeed` stamped | second draw refused while a live draw exists; explicit supersede is an event | admin | ownership |
| Sample approval (four-eyes) | event | `Base` + workflow validation | reject; approver sees current approval state | approver | ownership |
| Distribution assignment / reassignment | per-writer segments | `LegalityTable` + `Base` on `xrayImageId` | loser dropped **with reason**, surfaced in the actor's rejected-actions feed | acting supervisor | ownership |
| Distribution completion | per-writer segments | `LegalityTable` (completed blocks assigned/reassigned) | reject | acting user | ownership |
| Replacement request / approval | event + index | `Base` on the row; only one pending request may claim a row | second request rejected with the winning requester named | approver | ownership |
| Reopen request / transition | event | `LegalityTable` | reject | supervisor | ownership |
| Employee answers | per-writer segments (per employee) | `Append`; last-per-field within one writer | none possible across writers | — | append-only |
| Answer against a replaced row | per-writer segments | `Base` mismatch → `absentRowEvent` | surfaced to the employee: "this row was replaced; your answer was not applied" | employee + supervisor | append-only write, ownership-checked read |
| Referral request | event | `Append` | none | — | append-only |
| Referral approval / rejection | event | `Base` + workflow validation | reject; show current decision | approver | ownership |
| Templates (definition) | small CAS'd file per template | `CAS` | reject; editor reloads and retries | template author | ownership |
| Templates index | small CAS'd file | `CAS` | retry loop | — | ownership |
| Notifications (broadcast) | small CAS'd file | `CAS` | retry loop | admin | ownership |
| Notification acknowledgements | per-employee file | `Append` / set-union | none possible | — | append-only |
| Feedback threads | one file per conversation | single logical writer per thread | none | — | append-only |
| Feedback index | rebuildable cache | opt-in, rate-limited, **admin-initiated** repair only | rebuild | admin | ownership |
| Users / roles / permissions | events (★ new) + admin-ACL'd snapshot | per-change events; `Base` per user | two admins editing **different** users no longer collide; same user → reject with a diff | admin | ownership |
| Labels / UI overrides | browser storage (registered) | local only | n/a | — | local |
| Browse presets | small CAS'd file | `CAS` | retry loop | owner | append-only |
| Report designs | per-design file + CAS'd index | `CAS` | reject; designer reloads | designer | ownership |
| Ad-hoc import records | synthetic month snapshot, immutable | versioned | both retained | admin | ownership |
| Audit action log | per-actor files | `Append` | none possible | — | append-only |
| Error log | per-user files | `Append` | none possible | — | append-only |

Two things this table makes explicit that neither the current app nor the study does. First, **most rows have no conflict at all** once per-writer partitioning is applied — the genuine conflict surface is small and it is exactly the ownership rows. Second, **every conflict has a named resolver and a named surface**, which is the gap §2.9 closes.

### 4.6 The sync engine

**Steady state (unchanged tick).** Enumerate `heads/` once → compare each writer's `sequence` against the last-seen map → if nothing moved, broadcast nothing, invalidate nothing, re-render nothing. This is the current app's proven behaviour (`workspaceSync.ts`: an empty change set broadcasts nothing) expressed on a cheaper probe.

**Changed tick.** For each advanced writer, read only the missing byte range of the named segment(s) → verify envelope → verify hash → decompress → decode → **Zod validate with three outcomes** → dedup by `eventId` → fold with `(sequence, baseVersion)` and the legality table → update the cache → patch in-memory state, **excluding any entity holding an uncommitted local draft** → render only the affected components.

**Triggers.** Exactly two, as today: the interval timer (30–45 s baseline, admin-configurable) and an explicit manual refresh (which always broadcasts, preserving the full cache purge). Plus a focus/visibility probe coalesced to ~10 s. One module-level in-flight guard shared by all of them. **Do not add a third refresh path or a second timer** — the current codebase says this in CLAUDE.md for a reason.

**Per-PC leader.** Web Locks elect one sync leader per PC per origin (§17.2, adopted), so two tabs do not double the share load. Lock keys are derived from a **canonical logical path**, and a single acquisition helper refuses nested acquisition of the same key — closing the two lock defects the current app carries: `C-12` (keys derived from leaf `dir.name`, so two months' `sample.master.json` under identically-named parents falsely serialize; accepted-not-fixed) and v41.36 (an outer read-modify-write lock key byte-identical to `safeWriteJson`'s internal key, and `withResourceLock` is not reentrant, so **every browse-preset save hung forever**).

**`FileSystemObserver`** is an accelerator only, feature-detected, never a correctness dependency (§17.1, adopted unchanged).

**Metrics.** `filesOpenedPerMinute`, `bytesRead`, `tickDurationMs`, `conflictsDetected`, `retryExhaustions` — each carrying a **mandatory** call-site context (§3.25), surfaced in the admin error-log export.

### 4.7 Command classification (the CommandBus policy)

```text
Service call
   │
CommandBus
   ├── class = append-only ──► permission check ─► validate ─► apply optimistically
   │                            ─► outbox ─► SegmentWriter ─► verify ─► head++
   │                            statuses: Saved locally → Synced
   │
   └── class = ownership ────► permission check
                               ─► HeadScanner (sync now)
                               ─► SegmentReader + fold (authoritative state)
                               ─► validate against CURRENT state + baseVersion
                               ─► SegmentWriter ─► verify ─► head++
                               ─► then render
                               statuses: Saving → Saved  |  Rejected (reason)
                               never optimistic, never queued in the outbox
```

Sign-out is blocked while the outbox is non-empty. The unsynced count is permanently visible in the shell. An outbox whose `epoch` is older than `format.meta`'s is **quarantined and surfaced, never replayed** (§4.9).

### 4.8 The report scene model

```text
ReportModel  (= today's src/data/reporting/executive/model/reportModel.ts, ported with its doctrine)
   │  computed ONCE per generation, in the ReportWorker
   │  "renderers display; they never recompute"
   ▼
ReportLayout  (scene: positioned typed blocks; page size parameterized per document kind)
   │  Text | Shape | Table | Chart | Image        every KPI/Text block carries a data-source ref
   │  explicit builder-side pagination (planPortPages-style row budgets)
   ▼
reportTheme  (generated from the ONE tokens module; hex-literal guard enforces it)
   ├──► HTML renderer  ──► ONE standalone .html string: fonts/CSS/SVG inlined,
   │                        zero network at open, print CSS verified,
   │                        charts from the existing SVG-string primitives
   └──► PPTX renderer  ──► PptxGenJS: native text boxes, shapes, tables;
                            native charts for bar / stacked bar / pie-donut / scatter;
                            declared image exceptions for gauge, funnel, heatmap,
                            sparkline, SPC p-chart (UCL/LCL has no native equivalent)
```

Hard contracts: the HTML output is a **standalone artifact** (opened from the share or a USB stick, offline, printable) — this is stated because the study omits it entirely; fixed-size slide boxes clip silently, so pagination is a layout-model responsibility with a test that no block exceeds page bounds; text boxes are budgeted against the **PowerPoint fallback-font** metrics, not Chrome's, because PptxGenJS cannot embed fonts; snapshot the scene JSON and the HTML string, and compare PPTX by unzipping and normalizing timestamps.

### 4.9 Backup and restore

**Backup (adopted from §45–47, plus the ported safety sequence).**

1. Capture a **cut vector**: read `heads/` once, record `writerId → sequence` and the workspace `epoch`.
2. Copy the latest **verified** snapshot version per dataset (its `index.json` **and every referenced part**, rejecting incomplete sets), plus every segment up to each captured sequence, plus referenced attachments.
3. Emit an integrity manifest: per-file SHA-256, format version, cut vector, epoch. This makes a backup **verifiable at rest** — today's manifest carries no digests, so a copy that rots later still passes `assertBackupComplete`.
4. Byte-verified copy with one retry; segment files fail loudly; last-writer-wins files that vanish mid-walk are skipped as expected churn.
5. `backup.complete.json` written **last**.
6. Retention: manual and pre-restore kept forever; automatic pruned to 30.
7. Offer, as a first-class audited action, saving the container to a **second location** (the File System Access API allows picking a second directory). Backups under the same share share its failure domain.

Because segments are immutable and the backup never interprets event *contents*, the distribution-only comparator that would silently drop a differing answer event sharing an `eventId` disappears with the code that contained it.

**Restore.**

1. Validate the archive: manifest hashes, snapshot part completeness, format version.
2. Write the pre-restore rollback backup.
3. Write the `RESTORE_INPROGRESS` sentinel at the workspace root.
4. Restore. Merge-events semantics for segments; derived caches dropped, never restored.
5. **Bump the workspace `epoch` in `format.meta`.**
6. Clear the sentinel and publish restore visibility so other machines observe it.
7. Every client, on its next tick, compares `epoch`. A mismatch → discard the local cache, **quarantine the outbox and surface it**, re-sync from the share.

Step 5–7 is the piece the study is missing and that its own local-first model makes necessary.

### 4.10 Security

The posture is unchanged and already accepted: application login is a **UX/role-routing guard, not a trust boundary**; hashes are tamper-*evident*, not tamper-*proof*; all business data is readable and writable by anyone with folder access. `docs/architecture/SECURITY_MODEL.md` is the register and every exposure in it is dated and owner-signed.

What the enhanced architecture adds:

| Control | Mechanism | Residual risk (must be accepted, dated) |
|---|---|---|
| Writer isolation | NTFS ACLs per employee writer directory in `events/` and per-writer head file | An admin's Windows account can write anything |
| **Identity binding** ★ | Probe-based discovery: on connect, write a probe into candidate writer directories; the one that succeeds is the Windows-enforced identity. App login selects a *role within* that identity | The browser still cannot read the Windows username; the binding is inferential |
| Role authority | Permission snapshot under `snapshots/users/`, ACL'd write-admin-only; permission changes are audited events | A user with write access to that ACL can self-elevate |
| Tamper evidence | SHA-256 per segment + optional `previousSegmentHash` chain; existing `previousArchiveHash` / `previousDecisionHash` chains retained | Detects, does not prevent |
| Passwords | Argon2id via `hash-wasm` (m = 19 MiB, t = 2, p = 1), legacy PBKDF2 upgraded on login | Bootstrap hash ships in the bundle; passcode must be strong |
| Data at rest | **Not encrypted** (accepted). Live-data encryption only with a session-passphrase model the organization explicitly adopts | Plain data on the share |
| Backups | Opt-in AES-GCM with a passphrase-derived key **and a printed recovery key at enablement** | Lost passphrase + lost recovery key = unrecoverable |

Two deployment notes for the ACL model that §48.3 does not state. The ACL'd path must be **`events/{writerDirectory}` without a period level**, or IT has to provision new ACLs every month. And directories the *app* creates inherit the parent's permissive ACL, so IT must own creation of the per-employee directories — otherwise the boundary exists only on paper. Phase 8 must name exactly which directories IT owns and which the app may create.

Hashing note: `crypto.subtle.digest` is **not streaming** and needs the whole payload in one `ArrayBuffer`. Use it for segments (small). Use streaming SHA-256 from `hash-wasm` — already a dependency — for snapshot parts, or it reintroduces the whole-buffer memory constraint v86.0 removed.

---

## 5. Corrected source-tree structure

The study's §54 tree is generically correct and domain-blind: `modules/{tasks,chat,users,permissions}` is not this product. The correction keeps its layering discipline — `app` → `core` → `data` → adapters, with feature code never touching the File System API directly (§55, kept verbatim) — and substitutes the domain this app actually has.

```text
src/
├── app/                        bootstrap, shell, routing, tab manifest, mount policy
│   ├── bootstrap.ts
│   ├── moduleManifest.ts       ← SINGLE source of tab id + Arabic label + role ceiling
│   │                             (collapses today's tabRegistry/tabCatalog pair; §6.8)
│   ├── bootProgress.ts         ← post-login data-source checklist (effect-timing sensitive)
│   └── mountPolicy.ts          ← LRU + unsaved-work pinning (§3.7)
│
├── core/
│   ├── commands/               CommandBus + the ownership vs append-only classification (§4.7)
│   ├── events/                 envelope, writerId, sequence, baseVersion, eventId
│   ├── permissions/            role matrix, canMutate capability
│   ├── validation/             Zod schemas at every trust boundary
│   └── migrations/             one tested module per on-disk change; archive-not-delete (§3.12)
│
├── data/
│   ├── file-adapter/           ← safeWrite ladder, tri-state read, transientFileErrors,
│   │                             path-length assertion. PORTED, not rewritten (§2.4)
│   ├── event-store/            segment append + rotation, head read/write, fold
│   ├── cache/                  IndexedDB stores; every key in the storage registry (§3.19)
│   ├── sync/                   HeadScanner, SegmentReader, VersionTracker, RetryPolicy
│   ├── conflicts/              per-entity policy table (§4.5) + conflict records
│   ├── codec/                  columnar + compression + plain head line (§3.11)
│   ├── backup/                 cut vectors, manifest, restore validator (§4.9)
│   └── storageRegistry.ts      ← allowlist of every browser-storage location
│
├── workers/                    sync, import, report, backup  (inline-bundled)
│
├── domain/                     ← the part §54 omits entirely
│   ├── population/             month lifecycle, import, processing, partitioned snapshots
│   ├── sampling/               Hamilton apportionment, Mulberry32, Fisher-Yates, spillover
│   ├── distribution/           assignment/replacement/reopen events + legality fold
│   ├── answers/                per-employee answer events
│   ├── templates/              inspection-form schema + runtime evaluation
│   ├── referral/               referral requests
│   ├── approvals/              four-eyes approval records + decision hash chain
│   ├── adhocImport/            admin one-off imports; owns its parsing end to end
│   ├── month/                  app-wide month selection
│   ├── notifications/          broadcast + per-recipient acknowledgement
│   ├── feedback/               per-thread files + rebuildable index
│   ├── audit/                  per-actor action log
│   ├── errorLog/               durable per-user fleet error records (§3.24)
│   └── integrity/              orphan scan across the xrayImageId chain
│
├── reports/
│   ├── model/                  ReportModel — figures computed ONCE, renderers never recompute
│   ├── layout/                 ReportLayout — absolute blocks, page size per document kind
│   ├── theme/                  the one token module, enforced by check-hex-literals
│   ├── html-renderer/          standalone offline HTML string (no runtime chart library)
│   ├── pptx-renderer/          PptxGenJS scene renderer
│   └── workbook/               XLSX via SheetJS
│
├── ui/
│   ├── primitives/             DataTable, PageHeader, dialogs, StateViews
│   ├── tokens/                 design tokens
│   └── labels/                 labelsStore — PORTED unchanged (§3.16)
│
└── exports/                    excel, powerpoint, powerbi CSV, backup container
```

Four rules govern this tree, and each one is a repair of a defect the current app or the study has:

1. **`domain/` is a peer of `data/`, not a leaf of it.** Today `src/data/` holds both storage primitives and business modules, which is why `backupStorage.ts` grew its own private NDJSON parser and a distribution-only comparator. One codec, one read pipeline, in `data/`; the domain consumes it.
2. **`file-adapter/` is ported, not authored.** Its contents are `safeWrite.ts`'s commit ladder, the tri-state read, `transientFileErrors.ts`'s name-based classification and the path-length assertion. Every one encodes a production incident (§3.1–3.4, §3.8).
3. **`reports/model/` computes, renderers display.** The lint rule is that nothing under `html-renderer/`, `pptx-renderer/` or `workbook/` may import from `domain/` — they receive a `ReportModel`. This is what stops the "excellent on one page, below target on another" class.
4. **`app/moduleManifest.ts` is singular.** Today `tabRegistry.ts` (glob-discovered) and `tabCatalog.ts` (hand-written) must agree, enforced only by a test; a sub-tab that re-exports `tabConfig` silently resurrects as a top-level tab resolving to `none` for every non-admin. One manifest consumed by router, sidebar and permission matrix removes the failure mode instead of testing for it.

---

## 6. Domain additions the study does not model

The study's §71 validation prototype is *one task with ten assignees and one department chat*. Nothing in this product looks like that. These are the domain facts any architecture here must satisfy, and how each maps onto the enhanced design.

### 6.1 The monthly population pipeline

The unit of work is a **month**, not a record. Import (BI + risk workbooks) → process → draw sample → distribute → collect answers → report. A month has a lifecycle with a meaningful *closed* state, and the heavy data is written **once and then read many times**, which is the opposite of the study's mutable-collaborative assumption.

**Mapping.** Months become immutable versioned snapshots under `snapshots/population/{month}/v{n}/` with a CAS'd `current.json` pointer (§4.2). This is what closes the documented last-writer-wins gap (§2.10) without paying CAS costs on a 139 MB file. Import runs in a worker that writes the snapshot directly and returns only a summary plus progress — never the rows (§3.9).

### 6.2 Deterministic sampling — the hardest constraint in the product

`drawSample` is deterministic by contract: Hamilton apportionment per port, a second Hamilton for the CertScan/NonCertScan split, Mulberry32 seeded from a stamped `rngSeed`, Fisher-Yates draw, then capacity-weighted spillover. Every draw records its seed **and** `samplingAlgorithmVersion`, which exists precisely so a historical draw can be recognised as non-replayable under newer code.

**Mapping.** This is a **non-negotiable acceptance oracle**, not a feature. Snapshot fixtures exported from real workspaces must reproduce byte-for-byte under their stamped seed and version at every phase gate (§8 kill criterion 4). `SAMPLING_ALGORITHM_VERSION` is bumped only on a deliberate, approved semantic change — never as a side effect of a platform migration. **If a platform change cannot reproduce a historical draw, the platform change is wrong.**

### 6.3 Row ownership, not shared-record collaboration

The conflict that actually happens here is **exclusive ownership of an `xrayImageId`** — assign, reassign, replace, approve — resolved by a legality table over terminal states. It is not two people typing into one field. The study's §8 table (chat messages, counters, due dates, collaborative documents) does not contain a single row that describes this.

**Mapping.** §4.5's per-entity policy table replaces §8 wholesale, and §4.7's CommandBus classification is what keeps it safe: ownership commands are synchronous, never optimistic, never in an outbox.

### 6.4 Four-eyes approval and hash-chained decisions

Referral → approval is a two-actor workflow with a `previousDecisionHash` chain, and approvals carry audit weight. Two supervisors deciding the same request concurrently is a real, recurring case.

**Mapping.** Strict `baseVersion` validation plus the legality table; a losing decision becomes a surfaced conflict record with both branches retained, never a silent drop. The existing decision-hash chain is kept — it is cheap tamper evidence that already works.

### 6.5 Per-employee answer files

Answers are personal, append-only, and high-frequency during a review session. This is the **one** place where the study's optimistic-outbox model is exactly right.

**Mapping.** Answers and notes are the canonical append-only optimistic class (§4.7). They get local echo, an outbox, and 1–2 s flush. Nothing else does.

### 6.6 Report editions and the offline artifact requirement

Five executive renderings (`deck2` live, `deck` legacy, `document`, `workbook`, `viewer`), a Report Designer, a KPI tab and PowerBI CSV export. Crucially, HTML reports are **self-contained artifacts** that must open from `file://` with no network and no runtime library — a requirement the study never states.

**Mapping.** §4.8's scene model, anchored to the executive 16:9 deck only. The HTML renderer keeps emitting SVG strings from the existing chart primitives; **no runtime chart library ships inside an exported report**. This is also why ECharts is dropped from the report path — beyond its SKIP verdict, it cannot satisfy the offline-artifact rule without embedding itself in every export.

### 6.7 Ad-hoc import and the global month

Admin one-off imports own their parsing end to end and synthesise a `sample.master.json` for a synthetic month folder, reaching the rest of the app only through a bridge. A global month selector scopes nearly every view.

**Mapping.** Both are preserved as-is. The ad-hoc bridge is a good boundary and is the model for how any future non-standard ingest attaches without contaminating the main pipeline.

### 6.8 Arabic RTL as a first-class architectural constraint

1,484 label keys, `getLabels`/`useLabels` at 395 call sites across 129 files, admin overrides persisted per browser, and 23 recorded RTL fix rounds. Every KPI string is an Arabic + Latin-digit mixed run (`ar-SA-u-nu-latn`) — the exact case that reverses.

**Mapping.** `labelsStore.ts` is ported unchanged, an ESLint rule fails on Arabic literals outside label modules, and the written RTL/bidi rule set (§2.11) plus a per-library RTL screenshot harness gate **every** UI library adoption (§8 Phase 8).

---

## 7. Migration and coexistence

This is the single largest omission in the submitted study: `system/migrations/` is a folder name with nothing behind it. Live workspaces today hold processed months in columnar+gzip, NDJSON event segments, per-actor audit hash chains, `users.permissions.json`, `sample.master.json` files carrying `rngSeed` and `samplingAlgorithmVersion`, and approvals with `previousDecisionHash`. None of that can be abandoned and none of it can be silently rewritten.

### 7.1 The governing policy

`CLAUDE.md` already binds this, and it is the right rule: any change to a workspace file's on-disk shape must ship **its own migration**, not another permanent legacy-fallback read path. The migration is offered to an **admin** when they sign into a workspace carrying the old shape — never triggered silently, never for a non-admin role — it migrates every affected file, and the pre-migration originals are **ARCHIVED, never hard-deleted**, following the precedent `feedbackStorage.ts` already set (`messages.json` → `messages.json.migrated`). Each migration is its own explicit, tested module, not an inline branch in a read function.

### 7.2 Why the incremental path needs almost no migration

This is the decisive practical argument for incremental adoption over rebuild:

| Change | Migration required? |
|---|---|
| `writerSequence` + `baseVersion` on event envelopes | **None** — additive fields; old clients ignore unknown fields under the existing `eventSchemaVersion` rule |
| Per-writer head files | **None** — new files alongside; absence means "fall back to the directory-signature probe" |
| IndexedDB local cache | **None** — browser-local, disposable, rebuilt from the share |
| Sync/report workers | **None** — placement change only |
| Backup v2 | **None for reading existing data**; new backups use the new container, old ones stay restorable |
| Segment quarantine | **None** — a new directory |
| Permission events | **One migration module** — `users.permissions.json` → per-actor events, archive-not-delete |
| Versioned import snapshots | **One migration module** — existing month files become `v1/` with a `current.json` pointer |

**Six of eight need no migration at all.** That is not luck; it is what "additive, per-writer, immutable" buys.

### 7.3 The two-live-apps problem

The hard constraint the study never mentions: **older copies of the HTML keep circulating.** Someone has the file on a desktop, in a downloads folder, on a second machine. The documented `workspacePaths.ts` failure mode is a stale client creating numbered roots beside a migrated tree and autosaving into them.

Three defences, all required:

1. **Three-outcome decode** (§2.14): `accept` / `skip-as-newer` (state marked partial, UI warns the user to update) / `quarantine-as-invalid`. An old client must never quarantine valid new events.
2. **`format.meta.major` write guard:** a client refuses to *write* when the workspace's major format version exceeds its own, and says so in Arabic rather than failing silently.
3. **Minimum-reader-version stamp:** `format.meta` records the oldest build that may safely read the workspace; the boot splash surfaces a mismatch.

### 7.4 If a rebuild is chosen anyway

Should Phase 0 lead the owner to a from-scratch build, the migration phase is mandatory and looks like this — none of it is optional:

1. The **last release of the current app** ships a tombstone-keyed read-only guard, deployed to every machine before conversion begins.
2. A **month-by-month converter** proves equivalence against the Phase 1 oracle: fold output identical, sample draws reproduced byte-for-byte under their stamped seed and algorithm version. A month that fails does not convert.
3. Originals are **archived, never deleted**; a migration event is written to the audit log.
4. A **parallel-run period** where both apps read the same workspace and only the old one writes, until fold equivalence holds for a full monthly cycle.
5. **Cutover is blocked** until the pre-cutover test proves no stale HTML copy can write into a migrated workspace (§8 kill criterion 13).

---

## 8. Revised phase plan

The study's plan has eleven phases with business modules compressed into one paragraph at Phase 9, proves its architecture on task+chat, and contains **no estimate anywhere**. This replaces it. Every phase is a normal versioned release of the shipped app.

| # | Phase | Est. | Goal | Exit criteria |
|:--:|---|:--:|---|---|
| **0** | **Measure and decide** | 2–3 wk | Decision-grade benchmark on the real share and managed Edge build, at XQAP's volumes: cost per head read and segment open; enumeration at 10k/100k files; the §24.2 format matrix with columnar+gzip as the **baseline column** on the real 117,336-row month plus a 400k projection; IndexedDB/Web Locks/BroadcastChannel/zstd under `file://`; PptxGenJS Arabic fidelity on the department's Office build | Written numbers for every item; a `file://` capability table; Arabic PPTX pass/fail **with screenshots**; and a **signed incremental-vs-rebuild decision** |
| **1** | **Test rigor and oracle capture** | 1–2 wk | `fast-check` properties over `foldDistributionEvents` and the answer fold (reorder, duplicate, drop, corrupt, clock skew); multi-writer `memoryDirectory` simulation with fault injection; export deterministic oracle fixtures from real workspaces | Suite green; any fold/draw discrepancy found is **fixed in the current app first**; fixtures committed; the five ownership-bug shapes encoded as scenarios |
| **2** | **Causal ordering and heads** | 2–3 wk | `writerSequence` + per-`xrayImageId` `baseVersion` on envelopes (additive); fold resolves by sequence + baseVersion with the legality table; flat `heads/` replaces per-family directory signatures; per-PC sync leader via Web Locks with canonical-path keys | Fold output **byte-identical to the Phase 1 oracle on every real month**; clock-skew fuzz yields deterministic state or explicit conflict; unchanged-tick round trips ≤ current (~29); no shared file written from any read path; path-length assertion in place |
| **3** | **Local cache and sync worker** | 3–4 wk | IndexedDB cache keyed by (workspace root hash, app user, month), invalidated by head sequences, registered in the storage registry, rebuilt on loss; sync moved into a SyncWorker with chunked transfer; **ownership commands stay synchronous**; optimistic echo only for append-only personal events; hidden views defer refresh | Warm open and month switch measured on the real UNC; `FINDINGS.md` Issue 1 closed; "refresh never clobbers a draft" and "ownership decision never reads from cache" are simulation scenarios; cold rebuild benchmarked |
| **4** | **Backup v2** | 2–3 wk | Cut vectors from heads; hashed manifest verifiable at rest; restore validator; **one shared segment codec** (removing `backupStorage.ts`'s private parser and distribution-only comparator); workspace epoch bumped on restore with stale-echo quarantine | Backup-during-write and restore-with-stale-client pass in simulation; a backup written on the share re-verifies a day later; the `ANSWER_SAVE_DELTA` §8a comparator gap closed by test |
| **5** | **Quarantine, decode outcomes, permission events** | 2 wk | Segment quarantine; three decode outcomes; permission/user changes as per-actor immutable events (audit = state), with an admin-triggered archive-not-delete migration | Corrupt-segment scenario folds the rest and surfaces the quarantine; an older build against newer events marks state **partial**, not quarantined; two admins editing different users both succeed; migration verified on a **copy** of a real workspace |
| **6** | **Versioned snapshots and the read ceiling** | 4–6 wk | Immutable versioned import snapshots + CAS'd `current.json` (closes the LWW gap; loser retained and surfaced); partitioned layout (index + ~10k-row parts + bounded LRU) so no read needs a single string; import worker writes the snapshot directly | **A 600k-row BI import round-trips without materialising one string**; two admins importing the same month both retained with the correct one live; backup v2 validates complete part sets and rejects incomplete ones |
| **7** | **Report scene model and editable PPTX** | 4–6 wk | ReportModel → ReportLayout → two renderers (standalone HTML, PptxGenJS), anchored to the **executive 16:9 deck only**; retire deck v1; tokens enforced by the hex-literal guard; per-chart-kind policy declared up front | HTML snapshot-equivalent to deck2 on real months; **PPTX opens on stock Windows PowerPoint with correct Arabic run order, declared fallback font, no repair prompt**; bundle delta measured and lazily instantiated |
| **8** | **UI library trials** (gated, optional) | — | Trial Tabulator (fed from the query worker), Web Awesome controls, and ECharts only if its SKIP verdict is overturned by measurement — each as a custom element **inside the React shell**, behind the RTL harness and bundle-delta gate; adopt or reject individually | Each library has a research-doc row with measured gzip delta and RTL verdict; component-test harness proven **before** adoption; DataTable column contract preserved as the adapter |
| **9** | **Compaction and maintenance** | 2–3 wk | Elected single-writer compaction: archive block → verified snapshot → tombstones for one release cycle → deletion; readers treat "missing but ≤ snapshot cut" as covered; admin System Health / Verify Integrity / **Inspect Segment as JSON** / Repair Cache | Compaction during an active fold on an older build produces no NotFound retry storm in simulation; segment count per month bounded; admin tooling covered by e2e via the sim workspace |
| **10** | **Continuous hardening** | ongoing | Real-share load test at 40–60 clients with XQAP scenarios each release; fault injection, cache deletion, UNC interruption, large import, backup/restore, permission matrix and bundle budget as release gates | Each release passes `RELEASE_CHECKLIST.md` plus the new simulation suite; weekly `Fix:` rate does not exceed the pre-programme baseline |

**Honest total: 22–32 weeks (roughly 5–7½ months) for Phases 0–7 and 9**, at the AI-assisted cadence this repo has demonstrated, excluding the optional Phase 8. For comparison, a from-scratch rebuild to parity is **6–9 months** at the same cadence, or **12–18 months** for a conventional 2–3 person team — and unlike the incremental path, none of that time ships anything to users.

Three sequencing constraints are not negotiable. **Phase 1 precedes everything** — without the oracle there is no way to prove a platform change preserved behaviour. **Phase 4 precedes Phase 6**, because the partitioned layout is documented as blocked on backup being able to copy an index plus every referenced part and reject incomplete sets. **Phase 0's Arabic spike gates Phase 7**, because that is the assumption most likely to fail late and most expensive to discover late.

---

## 9. Decision register

Every technology choice, the alternative considered, the verdict, and — most importantly — **the condition that would reverse it**. A decision without a reversal condition is a preference.

| # | Decision | Alternative | Verdict | What would reverse it |
|:--:|---|---|---|---|
| 1 | Incremental adoption in the shipped app | From-scratch rebuild | **Incremental** | Owner wants a genuinely different, broader product (tasks/chat/attachments) — a product decision, costed as one |
| 2 | React 19 stays | Lit + Web Components | **Keep React** | A measured deficiency of React 19 for this app that Lit demonstrably fixes. None is stated in the study |
| 3 | Custom `DataTable` stays as the contract | Tabulator replaces it | **Keep, trial Tabulator behind it** | Tabulator passes the RTL harness *and* the component-test harness *and* the bundle delta, on one surface first |
| 4 | Hand-rolled SVG chart primitives | Apache ECharts | **Keep hand-rolled** | ECharts' SKIP verdict (`VISUAL_LIBRARIES_2026-07-14.md`: no bidi layout, 368 KB gzip) overturned by measurement — and never inside an exported offline report |
| 5 | columnar + gzip | MessagePack / ZSTD / Parquet | **Keep current** | A format beats it by **≥30%** on peak RAM or time-to-first-page with partial reads on the real month, without increasing file-op count |
| 6 | In-place append + size rotation | Micro-batched closed segments | **In-place** | Phase 0 shows per-file cost on the share is negligible — contradicting the v61.0 measurement of 192,063 → 78 ops |
| 7 | Flat `heads/` directory | Nested `writers/{period}/{emp}/{device}/` | **Flat** | Enumeration at 100k files proves worse than three-level traversal |
| 8 | 30–45 s sync baseline + focus probe | 1–4 s adaptive chat tiers | **30–45 s** | A real-time collaboration feature is actually added to the product, and the share sustains the op budget |
| 9 | Ownership commands synchronous | Optimistic outbox for everything | **Synchronous** | Never for ownership. This is the most-repeated bug shape in the codebase (five independent rediscoveries) |
| 10 | IndexedDB local cache | Keep re-reading the share | **Adopt** | IndexedDB unavailable or evicted-by-policy under `file://` on the managed build → in-memory + on-share checkpoint instead |
| 11 | Plain JSON for heads, indexes, manifests | MessagePack `head.bin` | **Plain JSON** | Only if an in-app "inspect segment as JSON" admin tool ships in the same release |
| 12 | SHA-256 segment hashes; streaming hash for snapshots | `crypto.subtle` everywhere | **Split** | `crypto.subtle.digest` gains a streaming API |
| 13 | PptxGenJS for editable PPTX | Print-to-PDF; HTML→PPTX conversion | **PptxGenJS, deck only** | Arabic spike fails → descope to text+tables with chart images, or drop |
| 14 | Scene model anchored to one consumer | Generic layout engine first | **One consumer** | Never generic-first. The deleted Report Designer query engine is the precedent — 40 days, zero callers |
| 15 | Vendored SheetJS tarball | npm-registry `xlsx` | **Keep vendored** | SheetJS publishes to a registry the CI can reach with a verifiable hash |
| 16 | Zod at trust boundaries | Hand-written guards | **Adopt Zod** | Bundle cost exceeds the budget for the validation surface actually needed |
| 17 | Edit-log ladder + `check:*` gates + registers | Lighter process | **Port all of it, day one** | Nothing. These are why the reasoning behind each safeguard is recoverable at all |
| 18 | NTFS ACLs as a weak, probe-discovered identity | ACLs as the security boundary | **Weak form, dated acceptance** | A browser API to read the Windows identity appears |
| 19 | Backups off-share, opt-in AES-GCM + recovery key | Backups beside the data | **Off-share** | Nothing — share loss or ransomware currently takes both copies |
| 20 | `file://` deployment | Serve over HTTP internally | **Keep `file://`** | Only if IT will own an internal static host — which would also relax the bundle-size pressure |
