# C — Viability Assessment and Mistakes Fixed

**Document:** C of 3 (see `A-ENHANCED-STRUCTURE-AND-PLAN.md` for the corrected architecture, `B-CURRENT-VS-PROPOSED-COMPARISON.md` for the side-by-side comparison)
**Date:** 2026-09-07
**Subject:** The proposed single-HTML shared-folder architecture (`0-PROPOSED-STRUCTURE-SOURCE.md`), assessed against the shipped XQAP app at v132.1.0
**Question answered:** How viable is the new structure, and which of the current app's mistakes does it actually fix?

## Bottom line

**The architecture is largely right. The rewrite is the wrong way to get it.** Scored as written — a from-scratch rebuild with the proposed phase plan, UI stack and storage formats — the proposal is **4/10**. The same ideas adopted incrementally into the existing app score about **7/10**. The gap is not in the thinking; it is the cost and risk of the rebuild, and three places where the design regresses behaviour XQAP already paid for in production incidents.

Roughly half of the proposal's platform recommendations are things XQAP **already shipped** after real incidents — per-writer immutable segments, a rebuildable derived cache, columnar+gzip compression, worker-side Excel parsing, idempotent event IDs, admin-triggered maintenance. The study does not know this, because it was written as a generic "department app" study without analysing XQAP. That is not a criticism of the author; it is a statement about what the document can and cannot be used for.

What is genuinely new and genuinely valuable is narrower than it looks, but it is real: causal ordering, head beacons, a durable local cache, backup cut vectors, segment quarantine, a shared report scene model that unlocks editable PPTX, and moving sync and report work into workers. **Every one of those can be adopted inside the existing React 19 app as ordinary versioned releases of the same single HTML.**

---

## 1. Viability by area

| Area | Score | Verdict |
|---|:--:|---|
| Concurrency / data model | **6/10** | Adopt ordering, heads, quarantine, permission-as-events; reject micro-batching, chat polling tiers, optimistic ownership writes |
| Performance / storage formats | **4/10** | Adopt local cache, sync worker, head beacons; keep columnar+gzip; benchmark-gate every format change |
| UI / frontend stack | **2/10** | Reject the framework swap; adopt store-first state and design tokens inside React 19 |
| Reporting / exports | **6/10** | Adopt the scene model + PptxGenJS for the executive deck only, after an Arabic fidelity spike |
| Build / test / ops / security | **5/10** | Adopt cut-vector backups, fuzz + N-client simulation, Phase 0 real-UNC proof; port all existing governance |
| Migration / phase plan / cost | **2/10** | Not credible as written — no migration path, no estimate, no parity decision |
| **Overall (as a rewrite)** | **4/10** | |
| **Overall (as incremental adoption)** | **~7/10** | |

The two lowest scores are the two the owner should read first. The UI dimension scores 2 because a framework swap is proposed in two sentences with no stated deficiency of React 19, discarding 260 `.tsx` files and re-opening the most expensive bug class in the project's history. The migration dimension scores 2 because **the proposal contains no calendar, effort or team estimate anywhere in its 72 sections**, and no path at all for the live workspaces that hold real data today.

---

## 2. What must be true for this to work

The architecture rests on assumptions of very different quality. Separating them matters more than the scores above, because the VERIFIED column is what makes the programme safe and the AT RISK column is what could stop it.

| # | Assumption | Status | Basis / required test |
|---|---|---|---|
| 1 | File System Access API works against a Windows UNC share from a managed Chromium browser | **VERIFIED** | XQAP has done exactly this in production for 132 versions |
| 2 | A single self-contained HTML can be built and deployed this way | **VERIFIED** | `vite-plugin-singlefile` ships `dist/index.html` at 4,507,893 bytes today |
| 3 | Per-writer append-only event segments beat whole-file rewrites on SMB | **VERIFIED** | v61.0 measured 192,063 file ops → 78 (2,462×), 3–6 hours → seconds for 8,000 events |
| 4 | Columnar + dictionary encoding + compression massively shrinks this data | **VERIFIED** | v87.0 measured a 117,336-row month: 139.07 MB → 1.05 MB (132×), byte-identical round trip |
| 5 | Arabic RTL can be done correctly in this stack | **VERIFIED for React 19** — **AT RISK for every proposed library** | 23 RTL-titled fix rounds already paid for in the current stack; Web Awesome, Tabulator, ECharts and PptxGenJS each open an untested surface |
| 6 | Directory enumeration stays cheap with thousands of segment files on SMB | **UNVERIFIED** | Must measure: head-scan time for 40 writer instances, enumeration at 10k and 100k files. Kill criterion: >5 s for a 40-instance flat head scan |
| 7 | Native ZSTD is available in the managed browser build | **UNVERIFIED** | Feature-test `CompressionStream('zstd')` on the actual deployed Edge/Chrome version; GZIP fallback is mandatory regardless |
| 8 | IndexedDB, Web Locks and BroadcastChannel behave correctly under `file://` | **UNVERIFIED — and this is the highest-leverage unknown** | The whole local-first model depends on it. The app is opened as `file://` off a share (`docs/architecture/FILE_URL_COMPATIBILITY.md`). If IndexedDB is evicted or unavailable, the cache degrades to in-memory + on-share checkpoint |
| 9 | `FileSystemObserver` works over UNC | **AT RISK** | Experimental and non-standard. Correctness must never depend on it — the proposal says this too, and is right |
| 10 | PptxGenJS renders Arabic mixed Arabic/Latin-digit runs faithfully | **AT RISK** | An open mixed-run bug, no font embedding, only `a:latin` typeface set. Every KPI string in this app is Arabic text with Latin digits (`ar-SA-u-nu-latn`). Must be spiked on the department's actual Office build **before** Phase 7 starts |
| 11 | The bundle stays acceptable after adding the new stack | **AT RISK** | 4.5 MB raw today. Lit + Web Awesome + Tabulator + ECharts + PptxGenJS + msgpack + fflate + idb (+ optional parquet-wasm, base64 +33%) plausibly reaches 8–12 MB — every byte read off the share on every open, with no content-encoding negotiation |
| 12 | Antivirus scanning of many small files does not dominate | **UNVERIFIED** | Managed Windows endpoints scan on open. Must be included in the Phase 0 benchmark or the file-count model is wrong |
| 13 | The V8 read ceiling can be lifted | **NOT ADDRESSED BY THE PROPOSAL** | See §5.2 — this is the app's only hard scale failure and neither MessagePack nor ZSTD helps |

Assumptions 6–8 and 10–12 are exactly what a Phase 0 benchmark exists to settle. **No application code should be written before those numbers exist.**

---

## 3. Mistakes fixed — summary

Thirteen evidenced current-app problems are genuinely addressed. Ranked by impact, then confidence:

| # | Mistake in XQAP today | Fixed by | Conf. | Impact |
|:--:|---|---|:--:|:--:|
| 1 | Backups have no consistency cut and cannot be verified after writing | Cut vectors + hashed manifest (§45–47) | High | **High** |
| 2 | Cross-machine ordering depends on wall-clock `eventAt` | Per-writer sequence + `baseVersion` (§13) | Med | **High** |
| 3 | No durable local cache; every load re-reads and re-folds from the share | Head beacons + IndexedDB cache (§12, 14, 16.2) | Med | **High** |
| 4 | No editable PowerPoint output at all | Scene model → PptxGenJS (§35–43, 68) | High | **High** |
| 5 | No property-based or multi-client simulation testing | Fuzz + 1–60 client scenarios (§60.2–60.3) | Med | **High** as practice |
| 6 | Sync, segment reads and report aggregation run on the main thread | SyncWorker / ReportWorker / BackupWorker (§26) | High | Med |
| 7 | One unparseable segment fails an entire month's fold | Quarantine + verified decode pipeline (§10, 47) | Med | Med |
| 8 | Three parallel deck implementations; `tokens.ts` imported by 2 files | One block model + one theme (§39–40) | Med | Med |
| 9 | Permission write and its audit entry are two writes that can diverge | Permission changes as immutable events (§8, 49, 50) | Med | Med |
| 10 | Views own reload paths that can destroy an unsaved draft | Store-first model (§14) | Med | Med |
| 11 | Change detection costs scale with file count, not writer count | One tiny head read per writer (§12) | Med | Med |
| 12 | UNC performance was learned in production, not measured up front | Phase 0 + real-UNC benchmark (§62, 60.4) | High | Med |
| 13 | `contentHash` is a 32-bit djb2; no artifact verifier | SHA-256 + hash chain (§47); build verifier (§53.3) | Med | Low |

### 3a. Fixed by the persistence and event model

**#1 — Backups.** `backupStorage.ts` (2,042 lines) walks the live tree while writers continue. v41.4 hit a `NotFoundError` race against in-flight `.tmp` files. An `STO-5` comment records a share that dropped mid-flush, leaving a truncated file the manifest then **certified complete** — found only by attempting a restore. `backup.manifest.json` carries no per-file hash. And `ANSWER_SAVE_DELTA_PROPOSAL_2026-08-27` §8a documents that two *differing* answer events sharing an `eventId` would be declared identical and one silently dropped.

Sections 45–47 close all of this properly: capture a per-writer sequence cut vector at backup start, copy immutable segments up to each sequence plus the latest verified snapshot, emit a SHA-256 manifest verifiable at rest, and run a restore validator before touching live state. **This is where the event model pays off most cleanly** — a consistent backup without freezing 40 users is only possible because segments are immutable.

**#2 — Causal ordering.** `distributionDerivation.ts` orders events by `event.eventAt.localeCompare(entry.lastEventAt)` with an `eventId` tiebreak. That is wall-clock ordering across machines whose clocks are not synchronised. Skew can reorder a completion and a reassignment, and the fold's legality table then silently drops whichever now looks illegal. The lessons-learned document calls the fold's edge cases *"the single most bug-prone piece of the whole system."* Section 13's per-writer monotonic sequence plus per-entity `baseVersion` makes conflict decisions causal rather than clock-dependent, and turns a `baseVersion` mismatch into an explicit dropped-with-reason outcome. **This is an additive envelope change that can ship without any layout migration.**

**#7 — Quarantine.** `appendOnlyEventLog.ts` throws `segmentParseError` with no isolation path, so one bad segment fails the month for every client. Sections 10 and 47 isolate it. One caveat that must be designed in: the pipeline has to distinguish *"unknown newer version"* (skip, mark state partial) from *"invalid"* (quarantine), or older HTML copies will quarantine perfectly valid new events.

**#9 — Permissions as events.** `users.permissions.json` is a whole-object CAS replace — `userSync.ts` notes it is *"not a field-level three-way merge"* — and the permission write and its audit entry are two separate writes that can diverge. A note in `check-bundle-size.mjs` records four declared action types, including `backup-restored`, that were never fired at any call site. Making the event *be* the state change (§50: "a command is not complete until its audit event exists") means audit coverage cannot drift, and two admins editing different users stop colliding.

### 3b. Fixed by local-first and the local cache

**#3 — No durable cache.** `workspacePersistence.ts` stores only the directory handle in IndexedDB. Every page load, every tab and every hidden sub-tab re-reads and re-folds from the share. `docs/performance-audit/FINDINGS.md` Issue 1 — the hidden Browse view re-parsing up to 400k rows on every distribution action, rated 9/10 — **is still open**. The Chromium UNC benchmark measured 142 s per 1,000 operations.

Sections 12, 14 and 16.2 fix the shape: head files as cheap change beacons, folded state cached in IndexedDB keyed by snapshot + head sequence, a client that sees an unchanged sequence doing no work at all. Confidence is medium rather than high because it is conditional on four things the proposal does not say: key the cache by `(workspace root hash, app user, month)`, register every store in the storage registry, **never make an ownership decision from cache**, and keep heads in one flat directory.

Note the tension with assumption 8: `BROWSER_TECHNOLOGIES.md` already rated IndexedDB read-through **3/10 and rejected it**. That verdict was reached for the current architecture; it should be re-tested, not assumed wrong.

**#10 — Drafts destroyed by refresh.** v59.115 and v59.120 are the same root cause in two views on the same day: a refresh *"silently threw away whatever an employee had typed."* `unsavedWorkRegistry.ts` exists solely to pin dirty tabs against LRU eviction. A store-first model where the UI reads only from the local store and no view owns a reload path removes the class — but only if the design explicitly states that a draft is store state keyed by record and is **excluded from incoming merges**. The proposal states the intent, not the rule.

**#11 — Change detection.** `workspaceSync.ts` computes bounded directory signatures per family, costing ~29 round trips per unchanged tick against a ceiling of ~40. One head read per writer answers "anything new?" and names the exact range to fetch. This only helps if heads live in **one flat directory** — the proposal's three-level `writers/{period}/{employee}/{device}/` tree makes it worse, not better.

### 3c. Fixed by schema validation and integrity

**#13 — Weak hashing.** `jsonEnvelope.ts` uses a 32-bit djb2 (`createSimpleHasher`). Under an advisory security model that is not tamper evidence. Section 47's SHA-256 payload hash and optional `previousSegmentHash` chain is cheap and correct. One implementation constraint: `crypto.subtle.digest` is **not streaming** and needs the whole payload in one buffer, so it must stay segment-only — use streaming SHA-256 from `hash-wasm` (already a dependency) for snapshots, or it reintroduces the exact whole-buffer memory problem v86.0 removed.

### 3d. Fixed by the shared report model

**#4 — Editable PPTX.** There is no PowerPoint output today and no pptx dependency in `package.json`; `TabView.tsx` shows a toast telling the user to print to PDF. This is **the one genuinely new user-facing capability in the whole proposal**, and sections 38–43 describe the right way to get it: a scene model feeding both renderers, rather than converting finished HTML. Gated on the Arabic spike (assumption 10).

**#8 — Deck fragmentation.** Three parallel executive deck implementations — `deck/` (1,361 lines, which `DECK_VISUAL_UPGRADE_PLAN` open question 3 records as *"nothing calls it"*), `deck2/` (14,140 lines including a 2,289-line `theme.ts`) and `deck3/` (2,103 lines) — each with a from-scratch theme. A `tokens.ts` claiming to be the single source of truth is imported by exactly two chart files. One block model and one theme fixes this **only if enforced**: extend `scripts/check-hex-literals.mjs` to the report directories with a zero baseline. The current `tokens.ts` is the proof that an unenforced token module decays.

### 3e. Fixed by process and tooling

**#5 — No property or simulation testing.** `package.json` has no `fast-check`. The fold's terminal-state edge cases shipped four times and were caught by review, not tests (v41.28, v43.12, v43.13, v98.4, v98.5). Boot-progress regressed **five consecutive rounds** (v59.190–197), none caught by the implementer's own tests. Sections 60.2–60.3 prescribe fuzzing over reorder/duplicate/drop/corrupt/clock-skew with the invariant *"deterministic state or explicit conflict."*

This is the highest-value item in the entire proposal that costs nothing architecturally: **it can be applied to `foldDistributionEvents` and a multi-writer `memoryDirectory` harness today, and it should be, before any platform change** — otherwise later phases have no baseline to diff against.

**#6 — Main-thread work.** `workspaceSync.ts` runs inside the React tree via `SyncTick.tsx`; five deck builders import `yieldToMain()` to chunk aggregation rather than remove it; only three files exist under `src/workers/`. The report builders are already pure `(data) => string` functions, so this is a **placement change, not a rewrite** — provided it carries the chunked-transfer pattern from `workbookResultStream.ts`.

**#12 — Measure before building.** v61.0's 192,063 ops / 3–6 hours was discovered in production. The v117.8 OOM fix is annotated *"not verified by automated or manual testing to date."* `scripts/bench/` notes that Node's `fs` does not reproduce Chromium's swap-file cost. Phase 0 is right — but only if run at **XQAP's** volumes (117k-row month, 8k-event distribution, 573 MB import), not the proposal's chat workload.

---

## 4. Mistakes NOT fixed

### 4.1 Inherent to having no backend — already formally risk-accepted

These survive any rewrite and are documented with dated owner sign-off in `docs/architecture/SECURITY_MODEL.md`. Section 49 restates them rather than solving them, which is honest.

| Issue | Why it survives |
|---|---|
| Auth is advisory, not a trust boundary | All checks run in the browser; anyone with folder access can edit the JSON directly |
| The bootstrap admin hash ships in the bundle | It is offline-crackable; the passcode must be strong |
| `writerId` is self-declared by the app | **NTFS ACLs cannot bind to app identity — a browser cannot read the Windows username.** A user logged in as supervisor emits supervisor-role events from whatever directory Windows lets them write |
| Business data is plain and unencrypted at rest | Live-data encryption needs a key-distribution model the organisation has not adopted; a key in the HTML is no key at all (§48.2 says this correctly) |
| No central lock coordinator, broker, or scheduler | Web Locks are origin-scoped; they do **not** coordinate across employee PCs |

The proposal's NTFS-ACL idea is worth pursuing in the weaker form the enhanced plan specifies — probe-based identity discovery, where the one writer directory the app can successfully write into *is* its identity — but the residual must be dated and accepted, not described as solved.

### 4.2 Real problems the proposal simply does not address

**The V8 read ceiling — the app's only hard, unrecoverable scale failure.** `safeReadJson` ends in `JSON.parse`, which needs the whole file as one JavaScript string. V8 caps strings at **536,870,888 UTF-16 code units**. A real customer's `bi.raw.json` measured **573,236,797 bytes decoding to 455,755,299 code units — 84.9% of that hard ceiling, on data that exists today.** Past it the file cannot be read at all: an unparseable month, not a slow one.

The proposal never mentions this. **MessagePack and ZSTD do not help** — both still decompress to one buffer and one object graph. Only Parquet (listed merely as a "benchmark candidate") or an explicit partition index (the unapproved Phase C) lifts it. This must become a stated non-negotiable: *no read path may require a single JS string or object graph over a whole monthly dataset*, with the acceptance test being a 600k-row BI import that round-trips without materialising one string.

**Cross-machine last-writer-wins on the import path.** `data-system-report.md` records LWW on `risk.raw.json`, `bi.raw.json`, `population.final.json`, `processing.summary.json` and the initial `sample.master.json` draw as a deliberate deferral. Section 64 rejects LWW in principle and section 10 has a `snapshots/imports/` folder, but there is no versioned snapshot naming, no pointer file, and no rule in section 8 for two admins importing or drawing the same month. Worse, **the snapshots themselves have no stated writer** — a materialised snapshot rewritten by many clients is precisely the anti-pattern section 5 forbids.

**Compaction.** Section 11 says segments "can later" be compacted; section 59 lists an admin button. There is no owner, no redirect manifest, and no defined reader behaviour for a segment that vanishes mid-fold. Immutable-then-moved is not immutable, and the current app's "NotFound is transient" retry would storm on every compaction.

**Other unaddressed items:** the inconclusive-read-back vs confirmed-wrong-write distinction (v97.1, `XQ-DIST-007` vs `-008` — treating a transiently unreadable just-written file as a failed write once orphaned real assignments); non-reentrant Web Lock keys derived from `dir.name` (C-12, accepted-not-fixed; v41.36 self-deadlocked every preset save); the durable per-user fleet error log that diagnosed `distribution:checkpoint-mismatch` firing 560 times in 5 days; E2E driving the built artifact; backups living on the same share as the data; and the two-sources-of-truth tab identity problem (`tabRegistry` vs `tabCatalog`).

---

## 5. New mistakes the new structure could introduce

A viability assessment that finds no new risks is not credible. These are regressions against behaviour XQAP has already paid for.

| # | Regression | Severity | Mitigation |
|:--:|---|:--:|---|
| 1 | Optimistic writes re-open the stale-snapshot ownership class | **Critical** | Ownership commands stay synchronous |
| 2 | Micro-batched segments recreate the file-count explosion | **Critical** | In-place append with size rotation |
| 3 | 1–4 s polling over a nested tree creates a fleet read storm | **High** | Flat heads dir, 30–45 s baseline |
| 4 | Deeper paths breach the 260-char Windows limit | **High** | Port the path-length assertion |
| 5 | Old HTML copies quarantine valid new events | **High** | Three decode outcomes |
| 6 | Persistent outboxes make restore unsafe | **High** | Workspace epoch + outbox quarantine |
| 7 | RTL regressions across four new libraries | **High** | Per-library RTL harness as an adoption gate |
| 8 | Binary formats destroy on-disk inspectability | Medium | Plain-JSON heads; plain head line on compressed files |
| 9 | Bundle growth on a `file://` deployment | Medium | Numeric budget + per-PR delta |
| 10 | Loss of process governance | Medium | Port the ladder and registers on day one |

**#1 is the most serious.** Ownership decisions made on a stale in-tab snapshot have been fixed **five separate times** (v43.6 → v98.5); v90.0 transferred another employee's row with no event trail at all. Sections 14 and 16.1 make local state the working memory and apply every command optimistically *before* the share is consulted. `baseVersion` catches the conflict afterwards — but the user has already built on an unsynced view. The fix is a CommandBus policy: commands tagged **ownership** (assign, reassign, replace, approve, close month, draw sample) run head-scan → fold → validate → write **synchronously and never enter the outbox**; optimistic mode applies only to append-only personal events.

**#2 and #3 are the measured-cost regressions.** The bottleneck on this share is per-file round trips, not bytes. Section 11's closed micro-segments (flush every 1–3 s; chat 100–500 ms) at click cadence produce roughly one file per action — the shape v61.0 removed. Section 17's 1–4 s polling over `writers/{period}/{employee}/{device}/` with 40 users × 2 devices means ~80 `getDirectoryHandle` + ~80 `getFile` calls per scan; at ~140 ms/op that is **10–25 seconds per scan**, from every client, continuously. There is no per-tick file-operation budget anywhere in the proposal.

**#7 deserves emphasis** because it is where the study is most confidently wrong. RTL appears exactly once, as a Phase 6 bullet. Meanwhile the app's own research document `docs/research/VISUAL_LIBRARIES_2026-07-14.md` **already evaluated ECharts and rated it SKIP** — for "no built-in bidi/RTL layout" and 368 KB gzip. The proposal recommends it as a "strong recommendation" without knowing that. Web Awesome (shadow-root `dir` propagation), Tabulator (header filters, frozen columns) and PptxGenJS (open mixed-run bug, no font embedding) each add another untested Arabic surface — and every KPI string in this app is an Arabic + Latin-digit mixed run, the exact case that reverses.

---

## 6. Kill criteria

Measurable conditions that should stop or descope the work. These are the teeth; without them the phase plan is a wish.

1. **Phase 0 share benchmark** — if a flat-directory head scan for 40 writer instances exceeds **5 s**, or any design pushes per-client files-opened-per-minute above **2× today's** (~55/min at a 45 s tick), the head-beacon/local-first sync design is descoped back to the current family-signature probe.
2. **`file://` capability** — if IndexedDB persistence, Web Locks or a same-origin coordination primitive is unavailable or evicted-by-policy on the managed Edge build opened from `file://`, the IndexedDB cache is **dropped** (in-memory + on-share checkpoint only) rather than the app being served over HTTP.
3. **Format gate** — MessagePack, ZSTD or Parquet is adopted only if it beats the shipped columnar+gzip by **≥30%** on peak RAM or time-to-first-page with partial reads on the real 117,336-row month, **without increasing file-op count**. Otherwise the current format stays and section 20's table is struck.
4. **Determinism gate (every phase)** — any divergence from the Phase 1 oracle (a historical sample draw not reproduced byte-for-byte under its stamped seed and algorithm version, or a fold output differing from the pre-change snapshot) stops the phase. **No snapshot is ever updated to match new output.**
5. **Concurrency gate** — event loss > 0, silent overwrite > 0, or any ownership transfer without an event trail in the XQAP scenario simulation stops the phase.
6. **Arabic PPTX gate** — if the spike shows reversed mixed runs, wrong table column order, an unacceptable fallback font, or a PowerPoint repair prompt on the department's Office build, and it cannot be fixed within two weeks, editable PPTX is descoped to native text and tables only (charts as images), or dropped.
7. **Bundle gate** — any release exceeding **8 MB raw**, or increasing time-to-interactive from the share by more than 50% over baseline, removes the responsible library before merge. The 30 MB / 10 MB ceiling remains the hard stop.
8. **RTL gate** — failure of the per-library RTL screenshot harness rejects that library; a second failure across libraries kills the UI-trial phase entirely.
9. **Production safety** — any data-loss or silent-overwrite incident attributable to a new code path freezes the programme, rolls the fleet back to the last pre-phase release, and requires an incident document before resumption.
10. **Fix-rate trend** — if weekly `Fix:` edit-log entries attributable to platform changes exceed **2× the pre-programme baseline for four consecutive weeks**, the programme pauses for stabilisation.
11. **Schedule** — if Phases 0–3 exceed twice their combined estimate (~18 weeks), the remaining phases are re-estimated and the owner re-decides scope.
12. **Rebuild-specific** — if the new platform passes fewer than **80%** of the ported domain test corpus by the end of its proof phase, or the workspace converter cannot prove fold and draw equivalence on every real month, the rebuild stops and the incremental plan resumes.
13. **Rebuild-specific** — if any stale copy of the current HTML can still write into a migrated workspace in the pre-cutover test, cutover is blocked until a read-only tombstone guard is deployed on every machine.

---

## 7. Recommendation

**Reject the rewrite. Approve an incremental adoption programme inside the existing app.**

### Why not a rebuild

A from-scratch rebuild would have to rediscover most of the **349 recorded fixes** across 54 dated edit logs. It has no migration path for live workspaces holding 573 MB imports, seeded sample draws and thousands of distribution events. It proves its architecture on task-and-chat — a domain XQAP does not have — rather than on 117k-row imports and an 8k-event fold. And it carries **no estimate at all**. An honest one: **6–9 months to parity** at the current AI-assisted cadence; **12–18 months** for a conventional 2–3 person team. During that window, the production app either freezes or diverges from its replacement.

### Why incremental wins

Every valuable idea in the proposal is separable and individually cheap:

> causal ordering → head beacons → local cache + sync worker → backup v2 → quarantine + permission events → versioned import snapshots + partitioned reads → scene model + PPTX

Each is an ordinary versioned release of the same single HTML. Each on-disk change is additive or ships with its own admin-triggered, archive-not-delete migration, per the binding policy in `CLAUDE.md`. Old HTML copies keep reading through the existing `eventSchemaVersion` and fallback rules.

**The answer to "what happens to the existing production app and its data during all this?" is: nothing. It never stops shipping.** No second app, no parallel run, no cutover, no migration weekend. That is not a compromise — it is strictly better than the alternative, and it is the single largest thing the submitted study is missing.

### When a rebuild would be correct

A from-scratch build wins only if the owner actually wants **a different, broader product** — a department platform with tasks, chat and attachments — rather than a better XQAP. The proposal reads as though that may be the real underlying goal; if so, that should be stated as a product decision and costed as one, not framed as an architecture upgrade.

Even then, the rebuild must start from the current storage layer — `safeWrite.ts`'s two-outcome verification, `transientFileErrors.ts`'s classification, the path-length assertion, the columnar codec — **not** from section 16's sketch. Those modules encode incidents, and the sketch does not know about them.

### Immediate next step

Do not start Phase 1 of anything. Run **Phase 0** (2–3 weeks): the real-share benchmark at XQAP's volumes, the `file://` capability table, the format matrix with columnar+gzip as the baseline column, and the Arabic PPTX spike. Then make the incremental-vs-rebuild decision against the kill criteria above, with numbers instead of intuition.

The cheapest high-value work can start in parallel and is worth doing whatever is decided: **property-based tests over the fold, a multi-writer simulation harness, and oracle fixtures captured from real workspaces** (Phase 1 in `A-ENHANCED-STRUCTURE-AND-PLAN.md`). That work is pure gain — it improves the current app immediately and gives every later phase a baseline to diff against.
