# Greenfield plan vs. XQAP — what already exists, what is genuinely new, what the plan should change

**Compared:** 2026-09-08
**Plan reviewed:** *Development Plan — New Offline Shared-Folder Application (Greenfield)*, dated 2026-09-08
**Compared against:** `x-ray-quality-app-v1` @ v132.1.0 (930 source files, 134,881 non-test lines, 466 test files, in production on real SMB shares)
**Nature:** research/reference. Nothing here changes XQAP's behaviour.

---

## 1. Verdict

**The plan is sound, and much of its platform half is already built, shipped, and production-proven in XQAP.** Of 95 concrete
mechanisms the plan specifies, 29 exist today in working code, 23 exist partially or in a different shape, and 43 do not
exist at all. The absent 43 are not filler — they are where the plan is most valuable,
because they are exactly the set of failure modes XQAP has *not* yet had to survive (compaction, restore epochs, quarantine,
multi-tab sync leadership, conflict records).

Three things follow, and they matter more than the scorecard:

1. **The plan's storage kernel is not a design task — it is a port.** XQAP's `src/data/storage/` (10,214 non-test lines)
   already implements the safe-write ladder, tri-state reads, `.name`-based error classification, the CAS loop with a
   delayed verify re-read, per-writer append-only segments with 128 KiB rotation, a gzip envelope, a columnar/dictionary
   codec, and an in-memory File System Access adapter for tests. The plan's Section 3.4 invariants are not aspirations
   there; they are load-bearing comments with production incident numbers attached. Rebuilding that layer from the
   invariant list alone would re-pay a discovery cost that has already been paid — twice in production.
2. **The plan and the shipped code independently converged on the same numbers.** The plan proposes ~128 KiB segment
   rotation as the default; XQAP ships `MAX_OPEN_SEGMENT_BYTES = 131_072`, derived from measured 20–40 ms per-append
   latency on the real share. That is the strongest available evidence that the plan's physics are right.
3. **The plan is not a rebuild of XQAP.** Its MVP is a *generic* platform (users, tasks, notifications, audit, admin);
   XQAP's mass is domain — 28,743 lines of reporting, 18,799 lines of Population UI, sampling, ad-hoc import, templates,
   answers. Whatever is decided, that domain work does not come along for free, and the plan does not claim it will.

**Recommendation (detail in Section 8): do not greenfield the platform layer. Extract it.** Lift XQAP's storage kernel and
its error taxonomy as the new app's Phase 1 foundation, then build the plan's genuinely new mechanisms on top of it, and
re-cut Phase 0 to measure only what has not already been measured. That converts a 4–5 month MVP estimate into something
materially shorter without discarding a single invariant the plan cares about.

---

## 2. Evidence base

Every status below was checked against the working tree at `cabe5d8`, not against documentation claims. Where the
documentation and the code disagreed, the code won. Sources:

- `src/data/storage/*` (the kernel), `src/data/distribution/*`, `src/data/answers/*`, `src/data/workspace/*`, `src/workers/*`
- `docs/architecture/DATA_ARCHITECTURE_AND_LESSONS_LEARNED_2026-08-25.md` — the plan's own ancestor document
- `docs/audit/XQ-IO-032_MULTI_MODEL_FINDINGS_2026-08-25.md` — a real production incident on the real share
- `docs/architecture/FILE_URL_COMPATIBILITY.md`, `docs/architecture/PERF_SYNC_ENHANCEMENT_2026-08-12.md`
- `scripts/`, `playwright.config.ts`, `package.json`, 53 daily edit logs (74,120 lines, 2026-06-23 → 2026-09-03)

Legend: ✅ shipped · 🟡 partial · 🔀 present but a different design · ❌ absent

---

## 3. Scorecard

### 3.1 Layer map (plan §4.1)

| # | Plan item | Status | Evidence in XQAP |
|--:|---|:--:|---|
| 1 | Views read a local store only | 🔀 | Views load through module loaders + `@tanstack/react-query` (8 files); there is no single local store |
| 2 | Hash-based routing (`#/tasks/123`) | ❌ | Tab state only (`tabRegistry.ts`); no URL addressing, so no deep links and no back button |
| 3 | CommandBus (permission → validate → class → route) | ❌ | `canMutate` at render + handler boundaries; each module writes directly. **The single biggest structural difference.** |
| 4 | Domain modules | ✅ | 18 modules under `src/data/` |
| 5 | Local store + IndexedDB cache | ❌ | IndexedDB holds only the directory handle (`workspacePersistence.ts`); caching is in-memory + query-client |
| 6 | Sync worker | 🔀 | `workspaceSync.ts` — one 45 s main-thread delta probe, not a worker |
| 7 | Storage kernel | ✅ | `src/data/storage/` — 10,214 non-test lines, 24 modules |
| 8 | File adapter + in-memory adapter for tests | ✅ | `fileSystemAccess.ts` (824), `memoryDirectory.ts` (607) |

### 3.2 Shared-folder layout (plan §4.2)

| # | Plan item | Status | Evidence |
|--:|---|:--:|---|
| 9 | `format.meta` (schema version) | 🟡 | `workspace.schema.json` detects layout only; `workspaceSchema.ts` is explicitly detection-only |
| 10 | `min-app-version` tombstone guard | ❌ | Nothing stops an old `index.html` copy from reading a newer workspace |
| 11 | Workspace epoch | ❌ | `bumpWorkspaceEpoch` (`inFlightReads.ts`) is an in-memory read-dedupe epoch — unrelated to restore |
| 12 | Label store on the share | 🟡 | Labels live in `localStorage` (`xray_custom_labels_v1`); only exported into backups (`labelsSnapshot.ts`) |
| 13 | One flat `heads/` directory | ❌ | Replaced by per-family bounded name+size directory signatures |
| 14 | Per-writer append segments + rotation | ✅ | `appendOnlyEventLog.ts` — `{deviceHash}-{sessionHash}` chains, `MAX_OPEN_SEGMENT_BYTES = 131_072`, `MAX_OPEN_SEGMENT_LINES = 2_000`; 4 consumers |
| 15 | Snapshots + parts + `current.pointer` | 🟡 | One columnar+gzip `population.final.json` per month; focused loaders (Phase A) and worker paging (Phase B) shipped; partitioning is Phase C, **proposed and unapproved** |
| 16 | Content-addressed attachments | ❌ | No attachment feature |
| 17 | Compaction manifests | ❌ | "segments are never merged" (`appendOnlyEventLog.ts`) |
| 18 | `quarantine/` | ❌ | Unparseable segments are logged and skipped, never isolated |
| 19 | `errors/<user>/` | ✅ | `5-system/system-errors/` — per-user files + yearly archives, admin XLSX export |
| 20 | Backups on a *different* share | 🟡 | `src/data/backup/` writes to `5-system/backups/` — the same share it protects |
| 21 | Archive-not-delete | ✅ | Policy in CLAUDE.md; precedent `messages.json.migrated`; audit archives |

### 3.3 Identity, envelope, command classes (plan §4.3–4.5)

| # | Plan item | Status | Evidence |
|--:|---|:--:|---|
| 22 | `writerId = employee-device-instance` | 🟡 | `deviceId` (localStorage) + per-session id name each writer chain, but writer identity is not modelled app-wide |
| 23 | Identity by NTFS folder probe | ❌ | Login + Argon2id (`hash-wasm`), advisory; no IT-provisioned per-writer ACLs |
| 24 | Globally unique event id | ✅ | `crypto.randomUUID` (14 modules); **not** sortable (no ULID/UUIDv7) |
| 25 | Per-writer `seq` | ❌ | Segment file names carry a chain seq; events do not |
| 26 | Entity `base` version on events | ❌ | CAS `revision` exists for shared single files only |
| 27 | Ordering never by wall clock | ❌ | Distribution folds by `(eventAt, eventId)` — but with an explicit late-event guard that forces a full refold (`appendOnlyEventLog.ts:1097+`) |
| 28 | Per-record hash | 🟡 | Envelope `contentHash` (non-cryptographic, corruption only), post-close byte-size verify, commutative `eventSetDigest` |
| 29 | Optimistic personal writes + outbox | ❌ | No outbox anywhere; every write is synchronous |
| 30 | Ownership changes never optimistic | ✅ | True by construction (see 29) |
| 31 | Per-type conflict rules | 🟡 | CAS + fold terminal-state guards; no typed conflict algebra (union/counter/field-version) |
| 32 | Conflict records + resolve UI | ❌ | Losers retry or fail; nothing is ever surfaced as a resolvable conflict |

### 3.4 Sync and cache (plan §4.6–4.8)

| # | Plan item | Status | Evidence |
|--:|---|:--:|---|
| 33 | One sync leader per PC + BroadcastChannel | ❌ | No `BroadcastChannel`/`SharedWorker` anywhere; every tab polls the share independently |
| 34 | 30–45 s tick | ✅ | `SyncTick.tsx`, 45 s, delta-only broadcast |
| 35 | Focus-triggered ~10 s probe | ❌ | Only the feedback unread poll is visibility-gated |
| 36 | One enumeration per tick | 🔀 | Per-family enumerations — ~29 metadata round trips for a 20-employee month (`PERF_SYNC_ENHANCEMENT_2026-08-12.md:178`) |
| 37 | `FileSystemObserver` as optional accelerator | ❌ | Not used; correctness correctly does not depend on it |
| 38 | SMB client-cache awareness | 🟡 | `FileInfoCacheLifetime` ~10 s is documented in the XQ-IO-032 analysis; no GPO conversation with IT |
| 39 | Clock-skew guard | ❌ | `feedbackUnread.ts` notes peer clocks run ahead; no user-facing warning |
| 40 | IndexedDB cache keyed by head vector | ❌ | — |
| 41 | One storage registry | ✅ | `storageRegistry.ts` + a coverage test |
| 42 | `navigator.storage.persist()` | 🟡 | Persistence state is surfaced in Settings (`StorageSection.tsx`), not requested at boot |
| 43 | Streaming import, never a whole workbook | 🟡 | SheetJS parses the whole workbook in a worker; **results** are streamed back in chunks after `DataCloneError: out of memory` (XQ-POP-003) |
| 44 | Bounded loaders / LRU | ✅ | `MonthLoadScope`, focused month loaders, tab-mount LRU capped at 3 |
| 45 | Row-count-independent aggregate sidecars | 🟡 | Distribution fold checkpoint + sidecar exist; KPI aggregates are computed on load |

### 3.5 Decode, backup, security, reporting, i18n (plan §4.9–4.13)

| # | Plan item | Status | Evidence |
|--:|---|:--:|---|
| 46 | Three decode outcomes (OK / unknown-newer / invalid) | 🟡 | `eventSchemaVersion` drops events newer than the reader understands — no "partial state" marking, no user prompt, no quarantine |
| 47 | Quarantine on INVALID | ❌ | — |
| 48 | Admin-triggered compaction | ❌ | — |
| 49 | Restore advances a workspace epoch | ❌ | `restoreSentinel.ts` marks a restore in progress; running clients are not epoch-fenced |
| 50 | Backup cut vector | ❌ | — |
| 51 | Immutable segments copied to backup | ✅ | `backupSegments.ts`, `backupAnswersSegments.ts`, byte-verified copies |
| 52 | SHA-256 per-file manifest | ❌ | Copies are byte-verified but not manifested |
| 53 | Restore validator + drill each release | 🟡 | `restoreSentinel`/`restoreVisibility` tests exist; no release-gate drill |
| 54 | NTFS per-writer ACLs | ❌ | Not deployed |
| 55 | Roles + audited permission changes | ✅ | 5 roles, permission matrix, CAS-protected action log |
| 56 | Hash-chained approvals (four-eyes) | ❌ | `src/data/approvals/` records decisions; no chain |
| 57 | Documented accepted residuals | ✅ | `docs/architecture/SECURITY_MODEL.md` |
| 58 | One scene model → many renderers | ✅ | `ExecutiveReportInput` → `deck2/`, `deck/`, `document/`, `workbook/`, `viewer/` |
| 59 | HTML + print-CSS PDF | ✅ | `src/data/reporting/` self-contained Arabic HTML |
| 60 | Editable PPTX / DOCX | ❌ | No PptxGenJS, no `docx` |
| 61 | Every figure traced to real data | ✅ | Enforced as a repo rule; deck fields map to the data layer |
| 62 | Label store as data | ✅ | `labelsStore.ts` (2,417 lines) + `useLabels()` |
| 63 | `Intl` date/number formatting | 🟡 | 3 usages repo-wide; most formatting is hand-rolled (`utils/formatting.ts`) |
| 64 | Hijri (`u-ca-islamic-umalqura`) | ❌ | Hijri exists only as *imported* BI/risk columns, never as a formatting calendar |
| 65 | Logical CSS properties | ✅ | 45 `margin-inline-start` / 29 `padding-inline`, **zero** `margin-left`/`padding-left` in CSS |

### 3.6 Tools, budgets, testing, release (plan §5, §6, §8, §9)

| # | Plan item | Status | Evidence |
|--:|---|:--:|---|
| 66 | TypeScript + Vite + singlefile | ✅ | One `dist/index.html`, 4.30 MB raw (measured at v132.1) |
| 67 | React 19 | ✅ | + React Compiler via `@rolldown/plugin-babel` |
| 68 | Headless component primitives | ❌ | Hand-rolled components, plain co-located CSS |
| 69 | TanStack Table + Virtual | 🟡 | `react-virtual` yes; table is the in-house `DataTable` (search/filter/sort/reorder/resize/export) |
| 70 | Charts (Chart.js or owned SVG) | ✅ | `d3-scale`/`d3-shape` + hand-built SVG; Recharts deliberately rejected |
| 71 | Zod runtime validation | ❌ | Hand-written normalizers/guards |
| 72 | Zustand / reducer store | ❌ | React context + query client |
| 73 | `idb` | 🟡 | Raw IndexedDB for the handle only |
| 74 | Native gzip | ✅ | `compressedEnvelope.ts` (732 lines) |
| 75 | `hash-wasm` (Argon2id) | ✅ | + transparent PBKDF2 upgrade on login |
| 76 | ULID / UUIDv7 | ❌ | `crypto.randomUUID` (unsortable) |
| 77 | Comlink | ❌ | Raw `postMessage` in 2 workers |
| 78 | Columnar / dictionary encoding | ✅ | `columnarCodec.ts` (519 lines), canonical round-trip contract |
| 79 | Streaming XLSX (`fflate` + SAX) | ❌ | Vendored SheetJS 0.20.3 + `check:vendor` SHA gate |
| 80 | Local full-text search | ❌ | — |
| 81 | Vitest | ✅ | 1,970 tests / 231 files |
| 82 | Property-based (fast-check) | ❌ | — |
| 83 | N-client simulation harness | ❌ | Single-client memory adapter only |
| 84 | Oracle/determinism fixtures | ✅ | e.g. `distributionDerivation.golden.test.ts`, snapshot-before-change rule |
| 85 | Playwright against the **built** HTML over `file://` | 🟡 | 18 specs, but against the dev server — the config states plainly that it proves features work, not that the bundle works |
| 86 | RTL screenshot harness | ❌ | **The single most valuable missing test asset for an RTL-first app** |
| 87 | Custom governance lint | ✅ | `check:hex-literals`, `check:complexity`, `check:release`, `check:vendor`, `check:bundle-size` |
| 88 | `knip` / `license-checker` / provenance file | ❌ | — |
| 89 | Bundle budget | ✅ | 30 MB raw / 10 MB gzip ceiling + a CI `Measure (pr)` Δ job |
| 90 | Files-opened-per-minute budget | ❌ | Not measured, not enforced |
| 91 | TTI-from-share budget | ❌ | — |
| 92 | Peak-memory budget | 🟡 | V8 string ceiling handled by a streamed write path; no gate |
| 93 | Path-length (260) assertion in CI | 🟡 | Diagnosed at *runtime* by an error code; not asserted at build time |
| 94 | Reproducible build + embedded hash/licences | ❌ | `__APP_VERSION__` only |
| 95 | Offline toolchain / `npm ci --offline` | 🟡 | Only `xlsx` is vendored; everything else needs the registry |

**Tally over 95 checked items: 29 ✅ · 20 🟡 · 3 🔀 · 43 ❌.** Just over half the plan's platform surface already exists in
some working form; the 43 absent items are where the plan earns its keep.

---

## 4. Where the plan and the shipped code independently agree

These are the strongest parts of the plan, because two independent derivations reached the same answer:

1. **~128 KiB segment rotation.** Plan default vs. `MAX_OPEN_SEGMENT_BYTES = 131_072`, chosen because one append costs
   20–40 ms of fixed round-trip latency on the real share and 128 KiB of payload adds only ~13 ms at a pessimistic
   10 MB/s — while every extra segment costs every reader a `getFile()` per fold, forever.
2. **One logical writer per physical file.** The plan states it as invariant 1; XQAP reached it by repeatedly failing the
   other way — notifications, audit log, error log, and feedback each migrated from one shared file to per-writer files,
   every time citing the same cause: *a CAS retry ladder tuned for local disk is shorter than one SMB round trip.*
3. **"Could not read" ≠ "does not exist".** Plan invariant 2 vs. `readOptionalJson`'s contract, which is credited with
   real historical data loss (zeroed answers, truncated logs) before it was enforced.
4. **Classify by `error.name`, never message text.** Plan invariant 4 vs. `transientFileErrors.ts` — and XQ-IO-032 is what
   happens when one DOM name (`InvalidStateError`) is missing from that classification: four users, ~88 minutes of
   silently failing answer saves.
5. **Verified vs. inconclusive writes.** Plan invariant 3 vs. the stage → verify → commit → re-verify → promote ladder,
   which deliberately leaves a verified `.tmp` on disk rather than losing a write.
6. **Ownership changes are never optimistic.** Plan §4.5 vs. XQAP having no outbox at all.
7. **Never one JS string over a whole dataset.** Plan invariant 11 vs. the streamed serialize/hash/verify path built after
   real `bi.raw.json` files were measured at 85% of V8's ~536M-code-unit ceiling.
8. **Advisory security, written down.** Plan §4.11 vs. `SECURITY_MODEL.md`, including the same reasoning about the
   bootstrap hash shipping inside the bundle.

---

## 5. What the plan genuinely adds (ranked by value)

1. **Decode taxonomy + quarantine + `min-app-version`** (§4.9). XQAP's only defence is dropping events with a newer
   `eventSchemaVersion`, silently. It has no way to isolate a corrupt segment, and nothing stops a stale `index.html`
   copied to someone's desktop from folding a workspace it does not understand. This is the highest-value addition.
2. **Compaction + workspace epoch + restore semantics** (§4.9–4.10). XQAP never merges segments, so its per-fold read
   cost only grows; and a restore cannot fence clients that are still running against pre-restore state.
3. **`heads/` beacons + one sync leader per PC** (§4.2, §4.6). Today every tab on every PC independently enumerates
   several directories every 45 s (~29 round trips per probe for a modest month). A flat heads directory plus Web-Locks
   leadership plus BroadcastChannel fan-out collapses that to one enumeration per *machine*, and gives presence for free.
4. **CommandBus with explicit command classes** (§4.1, §4.5). XQAP's permission checks are correct but scattered; there
   is no single place where "is this an ownership change?" is answered, which is why that property is guaranteed only by
   the accident of having no outbox.
5. **Conflict records with a resolve UI** (§4.5). Today a CAS loser retries or reports an error; a human never sees a
   conflict as a conflict.
6. **Property-based + N-client simulation testing** (§8). XQAP has 1,970 tests and still shipped XQ-IO-031/032; the class
   of bug it keeps hitting (interleaving, late events, stale caches) is exactly what fast-check plus a multi-client
   memory-adapter harness finds and unit tests do not.
7. **RTL screenshot harness** (§3.6, §8). An RTL-first app with 65 CSS files and no visual gate.
8. **Backups on a second share + SHA-256 manifest + cut vector** (§4.10).
9. **Streaming XLSX import** (§5). XQAP already hit the wall this avoids.
10. **Files-per-minute, TTI-from-share and path-budget gates** (§6). All three are currently "known concerns" rather than
    enforced numbers.
11. Editable PPTX/DOCX exports, content-addressed attachments, local full-text search, Hijri `Intl` formatting — real
    features, none of which exist today.

---

## 6. Corrections the plan needs (each from measured XQAP reality)

### 6.1 There is no cheap append. Rewrite the segment table.
The plan's segment strategy table frames "in-place append with size rotation" as cheap, with *partial-write detection*
as its risk. On the File System Access API that is not how it works:

> `createWritable({ keepExistingData: true })` is implemented by copying the existing file into a swap file first, so a
> "positional append" would pay the same O(file size) cost on the share while being harder to verify. Genuinely
> append-only writes are available only via `FileSystemSyncAccessHandle`, which is OPFS-only and cannot address the
> workspace folder at all. — `appendOnlyEventLog.ts`

So **every append rewrites the whole open segment**: bytes on the wire per append are `currentSegmentSize + batchSize`.
A 900-event session was measured at **129,763 bytes written per append**, still climbing, before rotation was introduced.
Rotation is therefore a *cost bound*, not a file-count knob, and the real risk column reads "O(segment size) rewrite
amplification + a crash-exposed rewrite window", not "partial-write detection". Keep the 128 KiB default; change the
reasoning, because the reasoning is what a future maintainer will use to re-tune it.

### 6.2 Heads are not free — specify when a head is written.
A head file rewritten on every append adds one more `createWritable` (20–40 ms fixed) to every write, roughly doubling
small-append cost. The plan should state that heads are written on a coalesced schedule (per flush/rotation, or at most
once per N seconds), and that a reader treats a stale head as "no news", never as authority for an ownership decision.

### 6.3 Wall-clock ordering needs the fallback spelled out.
The plan's invariant 7 (never order by wall clock) is right, and XQAP violates it — distribution folds by
`(eventAt, eventId)`. What saved it is a mechanism the plan does not mention: a **late-event guard** that detects an
event sorting before a key's last-folded event and forces a full refold instead of patching the checkpoint. Even with
`writer + seq`, a fold that resumes from a checkpoint needs that guard, because segments still arrive out of order across
machines. Add it to §4.9.

### 6.4 One invalidation authority, from day one.
The plan says "no server, so no query library needed". XQAP shipped ad-hoc caching first and added `@tanstack/react-query`
at v62.0 *specifically* to have one invalidation authority. The tool is optional; having exactly one place that decides
"this derived data is stale" is not. The plan's local store should own that explicitly, or it will grow N caches with
N-1 bugs. Related, and hard-won: **a refresh must never clobber unsaved local draft state** (plan invariant 6 — keep it,
it has already been a real bug here).

### 6.5 Identity-by-probe should not be on the critical path.
The plan makes NTFS-provisioned per-writer folders the primary identity discovery mechanism. That is an IT dependency
with an unknown lead time, and it is unproven in this environment. XQAP's login + Argon2id + stable device id works today.
Recommend: ship advisory login identity in Phase 1, treat the ACL probe as a Phase 4+ enhancement that *upgrades* identity
if IT delivers, and never let Phase 1 block on it.

### 6.6 `file://` storage sharing is worse than "namespace it".
Chrome gives **every** `file://` page one shared `localStorage`/`sessionStorage`/IndexedDB area (verified, 2026-08-10,
`FILE_URL_COMPATIBILITY.md`). Namespacing prevents collisions but cannot stop a *neighbouring* local HTML file from
clearing the origin. The plan's IndexedDB cache should therefore be treated as *evictable by an unrelated page*, not just
by the browser — which strengthens the plan's own "rebuildable, never authoritative" rule and its fallback.

### 6.7 Backups: add the restore sentinel.
The plan has cut vector, manifest, validator and a second share — all correct, all missing here. Add one thing XQAP has
that the plan lacks: a **restore-in-progress sentinel file** on the share, so a client that wakes mid-restore refuses to
write rather than interleaving with the restore. That pairs naturally with the workspace epoch.

### 6.8 Five things XQAP learned that the plan does not mention at all
- **Period/scope-gated loading as a first-class concept.** `MonthLoadScope` + focused loaders + capability gating (Phase A)
  cut boot cost far more than any codec change. The plan's snapshot section implies it; make it explicit.
- **Fold checkpoints with a validity guard** (see 6.3) — the difference between a 2 s and a 20 s month load.
- **A boot-progress data-source checklist.** XQAP's `bootProgress`/`BootSplashOverlay` regressed **five times in a row**
  (v59.190–v59.197), every round caught by review rather than self-testing. If the new app has a post-login readiness
  gate, design it test-first and treat it as a state machine, not an effect.
- **The identity key of a per-user file is a migration hazard.** §6.1 of the lessons document exists because renaming the
  key that maps an employee to their file breaks every existing file silently. Choose an immutable id, never a username.
- **Auto-backup pruning and an archive-status check** — backups grow without bound otherwise.

### 6.9 The estimate is conservative on build, optimistic on discovery.
XQAP went from nothing to v132.1.0 — 134,881 non-test lines, 466 test files, in production — in about **eleven weeks**
(edit logs 2026-06-23 → 2026-09-03), AI-assisted, single developer. Measured against that, the plan's "MVP ≈ 4–5 months"
is roughly 2× conservative *for writing the code*. But those same eleven weeks produced two numbered production incidents,
a five-round regression in one overlay, and a stream of SMB-timing fixes — i.e. the schedule risk is **not** typing speed,
it is the rate at which reality reveals cases. Re-cut the estimate along that axis: build weeks are cheap and predictable;
discovery weeks are neither, and Phases 0, 2 and 8 are where they are bought deliberately instead of in production.

---

## 7. What a greenfield actually costs here

| Layer | XQAP non-test lines | Portable to a new app? |
|---|--:|---|
| Storage kernel (`src/data/storage/`) | 10,214 | **Yes, nearly verbatim** — domain-free by design |
| Workspace layer (paths, sync, provider, schema) | 5,731 | Mostly, with the layout renamed |
| Auth (`src/auth/`) | 3,794 | Yes, as a pattern (roles/matrix/Argon2id) |
| Reporting (`src/data/reporting/`) | 28,743 | No — X-ray domain |
| Population UI + processing | ~22,770 | No — X-ray domain |
| Distribution / answers / sampling / templates / referral | ~11,800 | Pattern only |
| Ad-hoc import | 5,204 | No |

So the reusable platform is roughly **15–20k lines**, and the domain that would have to be rebuilt if the new app must
eventually do what XQAP does is roughly **110–120k lines**. That asymmetry is the whole decision: greenfield buys a clean
platform architecture (CommandBus, local store, heads-based sync) at the price of re-deriving a storage kernel whose
comments encode two production incidents — unless the kernel is carried across, in which case the price disappears.

---

## 8. Recommendation

**Option B — extract, then build.** Concretely:

1. **Cut Phase 0 to what has not been measured.** Already known: per-append cost on the real share (20–40 ms fixed),
   segment economics (~258 B/event, ~500 events per 128 KiB), the `file://` capability table, SMB `FileInfoCacheLifetime`
   (~10 s), the V8 string ceiling in practice, AV/DLP quarantine behaviour on unfamiliar extensions. Still unknown and
   worth two weeks: **flat-directory enumeration at 1k/10k/100k files**, **head-scan cost at 10/40/80 instances**,
   **write-visibility lag between two PCs**, **IndexedDB eviction under `file://`**, and the **Arabic PPTX spike**.
2. **Make Phase 1's storage layer a port, not a rewrite.** Lift `safeWrite.ts`, `transientFileErrors.ts`, `errorCodes.ts`,
   `casLoop.ts`, `appendOnlyEventLog.ts`, `jsonEnvelope.ts`, `compressedEnvelope.ts`, `columnarCodec.ts`, `webLocks.ts`,
   `directoryScan.ts`, `fileSystemAccess.ts`, `memoryDirectory.ts`, `storageRegistry.ts`, `errorLogger.ts` — with their
   comments, which are the actual asset — and re-point them at the new layout. Keep the invariant tests from Section 3.4
   as the acceptance criteria for the port.
3. **Spend the saved time on the five things XQAP does not have:** decode taxonomy + quarantine + `min-app-version`;
   compaction + epoch + restore fencing; heads + sync leader; CommandBus with command classes; conflict records.
4. **Add the two missing test assets before the module waves:** an N-client simulation over the in-memory adapter, and
   an RTL screenshot harness. Both would have caught real XQAP bugs, and neither is expensive.
5. **Keep XQAP running unchanged during all of it.** It is in production on real shares; nothing in this plan requires
   touching it, and its incident stream remains the best available source of truth for the new app's Phase 0.

**When Option A (pure greenfield, kernel included) would be right:** if the new app's storage shape diverges enough that
the port becomes a rewrite anyway — e.g. if Phase 0 says file operations are cheap and closed micro-segments win, or if
attachments and datasets dominate over event streams. Decide that *after* Phase 0, not before.

**When Option C (evolve XQAP in place) would be right:** if the new app's real target is the same department doing the
same work with a better UI. Then the missing mechanisms in Section 5 are 4–6 weeks of work inside a codebase that already
has the domain, and a greenfield is the more expensive path to the same place.

### Owner decisions, with XQAP-informed defaults

| Plan §12 decision | Plan default | Recommendation after this comparison |
|---|---|---|
| MVP module set | users/tasks/notifications/audit/admin | Keep — but state explicitly whether the X-ray domain must eventually move over; it is ~110k lines |
| Phase 0 concurrency targets | 10 and 40 instances | Keep; add 80 for the head scan only |
| UI framework | React 19 | Keep — XQAP's React 19 + React Compiler path is proven on this exact build stack |
| Messaging | threads at tick latency | Keep; XQAP's feedback poll was widened 60 s → 5 min for exactly this reason |
| Excel imports | yes, streaming | Keep; XQAP already hit the whole-workbook wall (XQ-POP-003) |
| Backup location | second share | Keep — this is a live gap in XQAP today |
| NTFS per-writer folders | request from IT | Request, but do **not** put Phase 1 identity on its critical path (§6.5) |
| Browser standard | managed Edge, pinned | Keep |
| Admin + deputy | owner + one employee | Keep |
| *(new)* Kernel strategy | — | **Port XQAP's storage kernel; do not re-derive it** |

---

## 9. If a pure greenfield is chosen anyway — read these first

| File | Lines | Why |
|---|--:|---|
| `src/data/storage/safeWrite.ts` | 2,356 | The whole write/read ladder, including the streamed path |
| `src/data/storage/appendOnlyEventLog.ts` | 1,127 | Segment mechanics + the measured reasoning behind 128 KiB |
| `src/data/storage/fileSystemAccess.ts` | 824 | The Like-handle contract that makes everything testable |
| `src/data/storage/directoryScan.ts` | 735 | Enumeration, caching, segment tails |
| `src/data/storage/compressedEnvelope.ts` | 732 | Format-agnostic gzip reads, permanent coexistence |
| `src/data/storage/errorCodes.ts` | 728 | The error taxonomy and its user-facing advice |
| `src/data/storage/memoryDirectory.ts` | 607 | The in-memory FSA adapter the plan wants |
| `src/data/storage/transientFileErrors.ts` | 528 | Retry ladders, AV/DLP behaviour, lock contention |
| `src/data/storage/columnarCodec.ts` | 519 | Dictionary/columnar encoding with a canonical round-trip |
| `src/data/storage/casLoop.ts` | 226 | CAS with write token + delayed verify re-read |
| `docs/architecture/DATA_ARCHITECTURE_AND_LESSONS_LEARNED_2026-08-25.md` | — | The plan's ancestor; §9 is the full bug history |
| `docs/audit/XQ-IO-032_MULTI_MODEL_FINDINGS_2026-08-25.md` | — | What an unclassified DOMException costs in production |
