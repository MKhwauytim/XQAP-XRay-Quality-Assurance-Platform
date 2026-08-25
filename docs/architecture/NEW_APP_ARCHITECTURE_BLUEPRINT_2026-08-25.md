# New App — Architecture Blueprint

**Date:** 2026-08-25
**Status:** Decided baseline (fallback triggers stated inline)
**Provenance:** Synthesized from a structured research + design workflow: four research agents verified the open technical questions against primary sources (CRDT libraries, 2026 browser platform, large-data formats, prior art & security), and two senior design passes produced decision documents for the data/sync kernel and the application architecture. Inputs: the full XQAP lessons-learned corpus (`DATA_ARCHITECTURE_AND_LESSONS_LEARNED_2026-08-25.md` — cited below as "lessons §…" with XQAP version numbers), the externally-drafted static-HTML shared-folder proposal, and its critical review. This document supersedes both: where it differs from the proposal, the difference is deliberate and argued in §13.

**Deployment shape (unchanged from XQAP):** one self-contained static `index.html`, Chromium-only, typically opened via `file://` from a Windows SMB share; no backend of any kind; all durable data in a user-selected shared workspace folder via the File System Access API; many users and machines concurrently on the same folder; Arabic/RTL-first UI.

**Zero-install guarantee (hard constraint, restated):** nothing is ever installed on any employee machine — no server, no service, no daemon, no executable, no browser extension, no npm at deployment. An employee opens the one HTML file in Chrome/Edge and picks the shared workspace folder; every runtime asset (fonts, worker code, any WASM) is inlined inside that single file. npm/Vite/React exist only on the developer machine at build time; the deployed artifact has zero external dependencies and works with no network access beyond the file share itself.

---

## Table of contents

1. [Executive decisions](#1-executive-decisions)
2. [Hard constraints and verified platform facts](#2-platform-facts)
3. [The data model: four classes, three write shapes](#3-data-model)
4. [The event kernel — mutable operational state](#4-event-kernel)
5. [Workspace layout, filenames, and path budget](#5-workspace-layout)
6. [Sync engine: discovery, subscriptions, cadence](#6-sync-engine)
7. [Caching, integrity, signing, backup/restore, compaction](#7-integrity)
8. [Large datasets, blobs, workers](#8-datasets-blobs-workers)
9. [Application architecture: repositories, UI, identity](#9-app-architecture)
10. [Error taxonomy and retry policy](#10-errors)
11. [Testing strategy, quality gates, process](#11-testing-process)
12. [Phased delivery plan](#12-phases)
13. [Decision log — deviations from the input proposal](#13-decision-log)
14. [Risk register](#14-risks)
15. [Non-negotiable rules](#15-rules)
16. [Technology stack summary](#16-stack)
17. [Verified sources](#17-sources)

---

<a id="1-executive-decisions"></a>
## 1. Executive decisions

1. **Mutable operational state is a formalized per-writer append-only event log — not Automerge, not any CRDT.** Signed NDJSON events in bounded per-writer segments, Lamport-ordered, folded into rebuildable projections, with per-writer heads forming an explicit version vector. This is XQAP's battle-tested endgame pattern, formalized and designed-in from day one instead of discovered incident-by-incident. Full rationale in §4 and §13; the short version: the research found **zero production precedent** for CRDT-over-shared-folder, Automerge costs ~320 KB gzip of WASM (well over 1 MB raw once base64-inlined — and raw bytes are what `file://` users wait on), CRDT files are binary and un-greppable (XQAP's incident forensics were literally grep), and — decisively — this domain's real same-record conflicts (XQAP v90.0, v98.4/98.5) are ones we *want rejected against fresh state, not silently merged*. The proposal itself concedes that the decisions that matter (approve/reject) need append-only decision events anyway.
2. **Narrow CRDT escape hatch: Yjs, never Automerge.** If the product later ships two or more features requiring genuine character-level concurrent text co-editing, adopt Yjs (~18 KB gzip, pure JS, documented commutative/associative/idempotent updates, `Y.mergeUpdates` file-exchange shape) for *those document types only*, storing Yjs updates as immutable payloads inside ordinary kernel events. Until that trigger fires: zero CRDT bytes in the bundle.
3. **The application is kernel-agnostic behind one repository contract** (§9.1). The single write API is `mutate(id, decide)` — the UI can never pass state into a write, only a decision function invoked against freshly-read authoritative state. This turns XQAP's most-repeated bug class (five independent stale-ownership incidents) from a discipline into an impossibility.
4. **The shared folder is authoritative; every browser storage tier is disposable acceleration.** A browser-data wipe is a routine, tested condition (reconnect → rebuild), never data loss.
5. **Design out contention structurally.** Every kernel file is exactly one of three shapes — immutable, single-writer mutable, or CAS-merged (rare) — chosen at design time. Independent users almost never write the same physical file.
6. **Tri-state reads everywhere** (`found` / `absent` / `failed`), in the type system. `failed` never licenses a default-seeding write. This closed XQAP's single most dangerous recurring bug shape (≥8 recurrences in 9 days).
7. **Polling is the only cross-machine correctness mechanism.** `FileSystemObserver` (stable since Chrome 133, desktop-only) is a same-machine acceleration signal — research confirmed it is a thin wrapper over local OS file-watch primitives with no cross-machine SMB guarantee whatsoever.
8. **Immutable IDs everywhere; usernames are display data.** Filenames use short (22-char) hashes, never raw UUIDs/ULIDs, under an enforced total-path-length budget.
9. **Everything is measured before it is trusted**: Phase 0 proves the environment (with production file extensions — the antivirus lesson), Phase 5 proves scale on the real share, and every deterministic module is snapshot-gated in CI.

---

<a id="2-platform-facts"></a>
## 2. Hard constraints and verified platform facts

The constraints are XQAP's, restated in §Deployment shape above. The following platform facts were **verified against primary sources in August 2026** (URLs in §17) and are load-bearing for the design:

| Fact | Status | Design consequence |
|---|---|---|
| `file://` is a secure context in Chromium; `showDirectoryPicker`, Workers (incl. Blob-URL), WASM, `CompressionStream`, `crypto.subtle`, Web Locks, IndexedDB all work there | Verified | The whole architecture is viable under `file://`. Use `WebAssembly.instantiate(bytes)`, never `instantiateStreaming` (no reliable MIME under `file://`). |
| **All `file://` pages share one Chromium origin** — `localStorage`, IndexedDB, BroadcastChannel, SharedWorker, and Web Locks are shared with every other local static-HTML tool on the machine | Verified — new finding neither the proposal nor XQAP documented | Hard rule: every storage key, channel name, and lock name carries an `{appId}_{workspaceId}` prefix. Lint-enforced. |
| Web Locks is origin-scoped → works same-machine cross-tab under `file://`, useless cross-machine | Verified | Same-machine writer serialization + polling-leader election via Web Locks; cross-machine safety comes only from the write protocol itself. |
| `FileSystemObserver` shipped stable Chrome 133 (Feb 2025), desktop only; spec is explicitly "best-effort" over local OS watch primitives (`ReadDirectoryChangesW` on Windows); no source claims cross-machine SMB visibility; Windows reports no `"moved"` events | Verified | Acceleration only. Assume it never fires for another machine's write. Runtime-probe on the actual fleet build in Phase 0. |
| Persistent File System Access permission ("Allow on every visit") exists since 2024; long-idle background tabs can still be auto-revoked; grants are not guaranteed across sessions | Verified | Startup always `queryPermission()`s the stored handle; reconnect flow is first-class UX. |
| Managed fleets can block the File System API outright via enterprise policy (`DefaultFileSystemWriteGuardSetting` etc.) | Verified | Phase 0 includes a GPO/CBCM policy review with IT, not just a runtime probe. |
| `CompressionStream` supports gzip/deflate/deflate-raw (baseline) + zstd (~Chrome 123); brotli-format milestone unverified | Verified/partial | gzip is the default codec; probe others at runtime, adopt only with measured benefit. |
| V8 max string length 536,870,888 UTF-16 units; structured clone requires one contiguous allocation; no IndexedDB per-record cap but whole-origin LRU eviction; `navigator.storage.persist()` under `file://` undocumented | Verified/partial | Streaming paths default-on above thresholds; bounded worker messages; IndexedDB treated as evictable; `persist()` probed in Phase 0 as a nicety, never a correctness input. |
| Windows `MAX_PATH` 260 remains the default; long-path opt-in cannot be assumed; NTFS directories degrade badly at 100k+ entries (case-insensitive create-compare on Samba, enumeration minutes at 300k) | Verified | Enforced path budget (§5); per-directory entry budgets with sharding. |
| `createWritable({mode:"exclusive"})` exists (Chrome 121+); whether exclusivity is browser-internal or OS/SMB-backed cross-machine is **unverified** | Open | Phase 0 empirical cross-*machine* test. If it blocks a second machine, it upgrades the lease protocol's fast-fail; it never replaces the lease. |
| WebAuthn/passkeys are infeasible under `file://` (HTTPS origin required) | Verified | Don't design for it. Documented reason to consider internal HTTP static serving later. |
| Windows security = SMB share permissions ∩ NTFS ACLs, per-directory ACLs are standard practice but entirely IT-owned | Verified | ACL layout is a documented *deployment requirement*; the app degrades gracefully on denial and never tries to manage ACLs. |

---

<a id="3-data-model"></a>
## 3. The data model: four classes, three write shapes

Adopted from the proposal (its strongest section), refined by XQAP's history:

| Data class | Examples | Representation | Write shape |
|---|---|---|---|
| Mutable operational | cases, assignments, answers, requests, decisions, workflow status | **Event kernel** (§4): signed events → per-writer segments → rebuildable projections | Immutable (sealed segments) + single-writer (active segment, head) |
| Large read-mostly | monthly imports, reference extracts, historical datasets | Partitioned columnar + gzip, immutable chunks + manifest (§8) | Immutable |
| Blobs | PDFs, XLSX, images, scans | Content-addressed immutable store (§8) | Immutable |
| Derived / cache | folds, search indexes, dashboards, table accelerators | Memory / IndexedDB (/ OPFS later), rebuildable, composite-keyed (§7.2) | Browser-local only — **never on the share** |

**The three write shapes, and the rule that every kernel file is assigned exactly one at design time:**

| Shape | Protocol | Files |
|---|---|---|
| **Immutable** — new unique name, never rewritten | write → close → read back → verify bytes/hash → only then publish a reference. No `.bak` (replaces nothing). | Sealed segments, snapshots, dataset chunks, blobs, backups |
| **Single-writer mutable** — one logical owner | Full XQAP **stage → verify → commit → re-verify → rollback-or-promote** with `.bak`. The proposal's blanket retirement of `.bak`/`.tmp` protocols is rejected for these few files: a torn writer-head or bootstrap file is the bricked-workspace scenario (lessons §9.1, v43.4). | `head.json` per writer, active segment, per-user preferences |
| **CAS-merged mutable** — genuinely multi-writer, rare | XQAP casLoop verbatim: revision + UUID write-token + immediate read-back + **jittered 80–180 ms delayed re-verify** (v43.15). Unexpected errors fail immediately (v26.1). **Never invoked from a polling/read path** (v123.0's write storm). | `bootstrap/*.json`, user registry, partition digest, leases |

---

<a id="4-event-kernel"></a>
## 4. The event kernel — mutable operational state

### 4.1 The event

One event = one NDJSON line:

```json
{ "v": 1, "id": "evt_<22-char-hash>", "type": "case.assigned", "typeV": 2,
  "writer": "wrt_<id>", "lamport": 4182, "wallTime": "2026-08-25T11:02:03Z",
  "partition": "cases-2026-08-p3", "subject": "case_<id>",
  "payload": { }, "prevHash": "<sha256 of prior line in this segment>",
  "sig": "<ECDSA-P256 over canonical bytes>" }
```

- **Identity & idempotency:** `id` is globally unique; **the fold is a set-fold over event IDs** — duplicate application is a no-op, discovery order is irrelevant, and convergence is checkable via XQAP's commutative digest (lessons §4.3). Re-reading a segment, replaying a duplicated batch, or discovering segments in any order all produce the same state. This *is* the out-of-order/duplicate story SMB demands — and it is exactly the property Yjs documents ("commutative, associative, idempotent") achieved here without a CRDT library.
- **Ordering:** `lamport` — per-writer monotonic counter, advanced past any observed counter — with writer-ID tiebreak by raw UTF-16 code-unit comparison. Never `localeCompare` (v41.37 made sample draws locale-dependent), never wall clock (cross-machine skew; research 4 confirms Lamport + stable tiebreak is the textbook answer). `wallTime` is display-only, always.
- **Schema evolution:** `typeV` per event type, resolved by an **upcaster chain at read time** — old events are transformed to the current shape before the fold ever sees them. This replaces XQAP's version-branching-inside-the-fold, its single most bug-prone spot. Unknown *future* `typeV` → dropped-and-preserved, never a crash, never a state reset (v47.2, v41.28's uninitialized-fallthrough).
- **Transitions:** the fold is a per-subject state machine with an explicit legal-transition table covering **every** mutating event type including request-type events (v98.4's `replacement-requested` gap), a `default` branch that preserves existing state, and terminal-state guards (`replaced` and `completed` are terminal absent an explicit `reopened`).

### 4.2 Segments and heads

- **Per-writer segments:** each writer session appends to one active segment (append-by-rewrite to 64 KB, then chunked appends), rotating to a **sealed, immutable, hash-stamped** segment at 256 KB target / 1 MB hard cap, and always on session end or 30 min idle (v79.0: unbounded whole-rewrite was quadratic; v61.0: per-event files were 192,063 ops and 3–6 hours — segmenting was a measured 2,462× reduction).
- **`head.json` per writer** (single-writer mutable): `{ writerId, lamport, activeSegment, activeSize, sealed: [{name, hash, count}], updatedAt }`. **The set of heads in a partition is the version vector** — research 4 confirms XQAP's per-writer-file pattern *is* a version-vector scheme with the vector implicit in filenames; we serialize it, which makes "anything new?" a comparison of N tiny files against a local vector with zero directory enumeration and zero payload parsing.
- **Batching:** buffer in memory; flush on 5 s of activity, 32 KB accumulated, or a `durable: true` commit (assignment, submission, approval — the UI awaits `workspace_committed` for these). Sits deliberately between XQAP's two measured failure extremes.

### 4.3 Why not Automerge — the evidence in one place

Verified by research (sources §17): (a) Automerge-Repo's storage-adapter model *can* in principle run over files without a live peer (via `load`/`loadRange`/incremental save-load — the peer sync protocol is explicitly session-based and not usable here), but **no FSA/SMB adapter exists for any CRDT library; it is 100% new code**, and the only public CRDT-over-folder artifact is a self-described proof-of-concept; (b) bundle: ~320 KB gzip WASM, base64-embedding documented as "slower and larger," compounding raw bytes on a `file://` deployment where raw bytes are the wait (v123.2's corrected assumption); (c) no inspection tooling exists for either Automerge's or Yjs's binary format — forfeiting the grep-based forensics that closed XQAP's worst corruption incident (v90.0); (d) Automerge's own binary-format spec **mandates abort on checksum mismatch** — so torn-write staging discipline (safeWrite) is still required *underneath* any adapter: we would keep all our hard problems and add theirs; (e) the concurrent-compaction race is real and its documented mitigation is content-addressed snapshot keys — the same discipline our own compaction protocol (§7.5) needs anyway; (f) Automerge's convergence guarantee has one documented historical counterexample (issue #870, closed); (g) a production CRDT vendor's own retrospective: "the hard parts are not the merge function but persistence, transport, schema migration, access control, and observability" — precisely the parts that remain ours either way. And the domain fact that decides it: XQAP's genuine same-record conflicts were **bugs we blocked with fresh re-reads, not edits we wanted merged**.

---

<a id="5-workspace-layout"></a>
## 5. Workspace layout, filenames, and path budget

```
ws/
  bootstrap/            workspace.json · keys.json (append-only key registry) · schema.json
  log/
    <partition>/        e.g. cases-2026-08-p3/   (partition id ≤ 24 chars)
      w/<writerId>/     seg-<lamportStart>-<8hex>.jsonl.json   (sealed, immutable)
                        head.json                              (single-writer mutable)
      snap/<hash>.json  content-addressed compaction snapshots
      digest.json       partition rolling digest (advisory; admin-written; CAS)
  ds/                   ds_<id>/manifest.json + c/<seq>-<8hex>.bin.gz.json
  blob/<2hex>/<sha256-hex>.bin.json
  users/                user registry & role snapshots (CAS)
  sys/                  leases/ · backups/ · diag/ · errorlog/w/<writerId>/
```

- **IDs:** `evt_`/`case_`/`usr_`/`wrt_` prefixes; **filenames always use 22-char base32 hash forms, never 36-char UUIDs** (v99.4: 80-char names + deep UNC + Chromium's `.crswap` staging sibling broke 260). ULIDs/UUIDv7 may live *inside* payloads for uniqueness — never as correctness-bearing cross-machine ordering.
- **Path budget — enforced, not advised:** workspace connect measures the real root path via a probe write of the longest legal kernel path. Root ≤ 120 chars (warn), refuse ≥ 140; app-relative ≤ 100 (the grammar above guarantees ~80 worst-case); 20 chars reserved for `.crswap`/`.tmp` siblings → total ≤ 240 < 260. Also a unit test and a Phase-0 probe against the deepest *real* UNC deployment path.
- **Extensions — the v98.3 rule:** every file the kernel writes ends in **`.json`** (`.jsonl.json`, `.bin.gz.json`), because `.json` is the extension the fleet's AV/DLP demonstrably passes; XQAP's probe wrote `.tmp` (universally allowlisted) while real `.ndjson` segments were eaten — the probe lied for five field reports. Ugly beats quarantined. Phase 0 probes with **production filenames**.
- **Sharding:** partitions bound directory growth naturally (per-writer subdirs, monthly-style partition rotation); budget any single directory in the low tens of thousands of entries, far below the measured NTFS/SMB degradation cliff.

---

<a id="6-sync-engine"></a>
## 6. Sync engine: discovery, subscriptions, cadence

- **Heads, not listings.** "Anything new in partition P?" = read the writer heads, compare lamports with the local version vector. A partition-level `digest.json` (hash over sorted head hashes — a named Merkle-lite structure, per research 4) lets one read skip a whole partition. The digest is advisory acceleration, written by admin sessions only — **never a correctness input, never written from a read path** (v123.0: a read-path index repair polled by every client became a self-sustaining write storm).
- **Subscriptions:** every session holds `{ partitionId, reason: assignment | team | open-record | notification }` derived from role + navigation. Nobody polls the whole tree (v70.0).
- **Cadence:** active-foreground partitions 5 s; visible-idle 20 s; `document.hidden` → suspend all polling (v59.170) except one 60 s heartbeat on the user's own notification partition. Scoped reconciliation (verify sealed-segment lists + hashes per subscribed partition) every 5 min with jitter. Change detection compares **name set + size + mtime + head hash — never size alone** (v83.1: same-length edits were invisible).
- **Same-machine coordination** (new, enabled by the shared-`file://`-origin finding): Web Locks serialize same-machine writers per **full logical path** (never leaf name — v81.0; distinct `:rmw` suffix for outer locks — v41.36); BroadcastChannel propagates local-echo ("I appended to partition X") so sibling tabs refresh without disk I/O; one tab per machine is elected polling leader via a held lock — others consume its broadcasts. All names carry the `{appId}_{workspaceId}` prefix.
- **`FileSystemObserver`:** observes the workspace root for same-machine fast echo; an event triggers an immediate targeted head-check, nothing more. Cross-machine invisibility is assumed (verified, §2).
- **Freshness UI:** `LIVE / SYNCING / LOCAL_PENDING / WORKSPACE_UNAVAILABLE / RECONNECT_REQUIRED / ERROR` + "synced Ns ago" per view. `LOCAL_PENDING` (unflushed buffer) is always visibly flagged. **A refresh never clobbers unsaved draft state** (XQAP standing rule); silent refresh swaps rows in place with no spinner (v70.0).

---

<a id="7-integrity"></a>
## 7. Caching, integrity, signing, backup/restore, compaction

### 7.1 Cache tiers
Memory (live folds/queries) → **IndexedDB** (`durability: "relaxed"`, 500–1000 puts per transaction — the measured best practice; fold checkpoints, head vectors, chunk metadata, remembered directory handle) → **OPFS deferred**: v1 ships IndexedDB-only; adopt OPFS `SyncAccessHandle` (worker-only, ~9× measured on 100 MB writes) as the chunk-byte cache only when measured chunk traffic exceeds ~50 MB/session. All tiers disposable; whole-origin eviction is a routine tested event; `navigator.storage.persist()` is an opportunistic nicety probed in Phase 0, never a correctness input.

### 7.2 The composite-key invalidation rule
XQAP was burned four separate times by caches keyed on fewer dimensions than their derivation consumed (v41.39 revision-without-fold-version; v88.0/89.1 the fix that shipped inert; v101.0 a whole class of change invisible to every freshness signal; v59.142). Therefore: every checkpoint/cache entry embeds `{ foldVersion, upcasterChainVersion, headsVector, auxInputFingerprint, schemaVersion }` — **every input dimension the derivation reads**. Any mismatch on any dimension → full rebuild. Review rule: *adding an input to a derivation without adding it to the key is a correctness bug, not an optimization miss.*

### 7.3 Hashing and signing
- **SHA-256 via hash-wasm streaming** (`init/update/digest`) for all content addresses and segment seals — already a proven dependency (Argon2id), composes with chunked reads, and avoids `crypto.subtle.digest`'s documented whole-input-in-memory contract (which recreates the 573 MB failure shape, v86.0). Not BLAKE3: SHA-256 hex is what an admin's off-the-shelf tooling recognizes; hashing throughput is not the bottleneck. Full-payload hash verification stays size-gated (≤512 KB; v80.0 measured hashing at 7.1× the parse) — above that, the write path's byte-exact read-back is the stronger guarantee.
- **Per-writer ECDSA-P256 event signing, honestly framed.** Keypair generated in-browser; public key published as an **append-only registration event** in `bootstrap/keys.json`. On browser-storage wipe: generate a fresh keypair, append a new registration — key history is append-only, old events stay verifiable under old keys. No passphrase-derived keys (a second offline-crackable credential duplicating the bootstrap-admin risk). The documented claim, verbatim: *"tamper-evident against another user editing a peer's file by hand; not tamper-proof against the file's own legitimate writer or anyone with SMB write access."* Research found no direct precedent for this exact design (wipe-surviving browser signing identity) — it gets its own written risk-acceptance section, XQAP `SECURITY_MODEL.md`-style. Auth stays Argon2id via hash-wasm at OWASP baseline (m=19 MiB, t=2, p=1 — verified current); the advisory-only trust boundary is documented from day one.

### 7.4 Corruption, backup, restore
- A sealed segment failing its hash is **quarantined** (renamed `.corrupt.json`, surfaced in diagnostics with writer/lamport range, lines salvaged up to the first bad one) — never silently skipped (v78.0 turned a backup into a lie). Truncation classifies as *corrupt*, never valid-short (v89.0 critical); nothing overwrites a `.bak` without full inflate/verify first (v89.0's second critical).
- Backups cover bootstrap, log, datasets, blobs, users, audit — with a manifest, per-file verify-by-read-back, completion sentinel, and per-file failure tolerance (one unreadable giant must not abort the whole backup — v99.6). Derived caches and checkpoints are never backed up.
- **Restore merges, never replaces**: union segments by immutable filename, invalidate every checkpoint/cursor whose heads-vector no longer matches, and re-mint the change-detection token so peers notice (v99.7's invisible restore). An interrupted restore leaves its sentinel and is surfaced to every role.

### 7.5 Compaction / GC — the honestly-hardest problem
Research confirmed no surveyed prior art solves coordinator-less compaction on a shared concurrently-read store; this protocol is ours:
1. **Admin-only, explicit, lease-guarded**: KeePass-pattern self-expiring lease (`sys/leases/compact-<partition>.json`, 10 min expiry, heartbeat), acquisition *and* steal-after-expiry via full CAS-with-delayed-reverify so two stealers can't both win.
2. **Content-addressed snapshot + tail**: fold all sealed segments up to a recorded heads-vector; write `snap/<contentHash>.json` embedding that vector and the fold/upcaster versions. Never overwrite a prior snapshot — concurrent compaction degrades to redundant snapshots, not data loss (the same content-addressed discipline Automerge's community documented for its own compaction race).
3. **Seal-and-archive, never delete (v1 rule)**: covered segments move to archive only after a verified backup includes them, a 14-day grace, and every registered writer's head is past the snapshot vector or the writer is retired (Dotted-Version-Vector-style, so departed writers don't pin GC forever). Hard delete is a manual admin act outside the app.
4. **Stale-client bootstrap**: newest snapshot whose fold/upcaster versions match current code + newer segments; an unknown future version is ignored and the client re-folds from segments — a snapshot is never trusted by recency (the poisoned-checkpoint class, v41.39; the 18-hour replay war story in the event-sourcing literature).

---

<a id="8-datasets-blobs-workers"></a>
## 8. Large datasets, blobs, workers

- **Datasets: keep the proven columnar-JSON + gzip** (`CompressionStream`, 64 KB feed windows — tiny chunks into the stream were measured pathological), chunked at ~50k rows / ~8 MB compressed, immutable, sequence+hash named, per-dataset `manifest.json` carrying **chunk metadata only, never row copies** (v62.0: an index that inlined rows turned a 28 MB import into a 385 MB workspace). 22.7× compression is the reproduced-in-production baseline (v86.0/87.0). On-disk chunk size, UI page size, and cache budget are **three independent decisions** (the Phase A/B lesson).
- **Format upgrades are trigger-gated, not day-one**: if profiling shows a hot path decompressing >3× more rows than it consumes, adopt **hyparquet** (~10 KB, pure JS, real row-group random access — gzip is not seekable) for that dataset class; Arrow JS/parquet-wasm only if cross-tool (Python/DuckDB) interop becomes a hard requirement, as a documented bundle-budget raise. fflate (~8 KB) is pre-approved where compression-level control or sub-1 MB whole-buffer latency measurably matters — native `CompressionStream` has no level knob.
- **Blobs:** content-addressed `blob/<2hex>/<sha256>.bin.json`, streamed hash, verify-after-write, references carry `{hash, size, mime}`. **Fixed-size chunking only** for oversized blobs — our blobs are write-once; there is no edit-locality for content-defined chunking to exploit.
- **Workers:** import parsing, chunk encode/decode, dataset query/paging, streaming hashes run in workers (`?worker&inline` Blob-URL workers — verified under `file://`). Report builders stay main-thread chunked via `yieldToMain()` (proven at v59.94–102), with the reentrancy corollary enforced: module-level state touched by a now-async builder gets a promise-chain mutex. **Worker protocol rules are framework-level, not per-worker choices:** (1) bounded chunk streaming, never one structured-clone payload (v117.7/8 OOM at ~500k rows); (2) **per-lane staleness tokens** — one shared "latest wins" counter across lanes was v59.189's critical bug; (3) `onerror`/`onmessageerror` + a generously-sized silence watchdog on every worker (v97.2: a dead worker's silence hung promises forever); (4) error recovery must work on the *Nth* load, not just the first (v59.189's follow-up).

---

<a id="9-app-architecture"></a>
## 9. Application architecture: repositories, UI, identity

### 9.1 The repository contract — fixed now, kernel-agnostic

```ts
type ReadResult<T> =
  | { kind: "found"; value: T; meta: { revision: Revision; epoch: number } }
  | { kind: "absent" }                                  // proven absent — every location examined
  | { kind: "unreadable"; error: TypedStorageError };   // NEVER collapsed into absent

interface Repository<T, E extends DomainEvent> {
  get(id: Id): Promise<ReadResult<T>>;
  query(scope: Scope): Promise<ReadResult<readonly T[]>>;
  subscribe(scope: Scope, cb: (snap: Snapshot<T>) => void): Unsubscribe;
  mutate(id: Id, decide: DecideFn<T, E>): Promise<CommitResult>;
}

type DecideFn<T, E> = (fresh: FreshState<T>) =>
  | { commit: E | E[] }            // events, not patched state
  | { reject: DomainRejection };   // typed, user-presentable

type CommitResult =
  | { kind: "workspace_committed"; revision: Revision }
  | { kind: "local_pending"; flushId: string }     // visibly flagged
  | { kind: "rejected"; reason: DomainRejection }  // decide() said no on fresh state
  | { kind: "failed"; error: TypedStorageError };
```

**`mutate(id, decide)` is the single most important structural decision in this blueprint.** The kernel re-folds the subject's authoritative state immediately before invoking `decide`, and re-invokes it on retry. A stale tab structurally cannot steal a row or regress completed work — `decide` sees `fresh.status === "completed"` and rejects. Business rules are pure `DecideFn`s, testable with zero I/O; the legal-transition table lives in one shared module. `decide` is contractually pure (lint: no awaits/IO inside — its re-invocation on retry makes side effects a bug; risk #10). `unreadable` never licenses a write: `mutate` against an unreadable read fails — it does not seed defaults (closing the v99.1 roster-wipe class at the API, not per call site). No React component ever sees a `FileSystemFileHandle`.

### 9.2 Identity
Immutable IDs everywhere; display names are one editable field — renames orphan nothing, and XQAP's entire `usernameRenameGuard` apparatus becomes unnecessary. Every repository that can reference a user registers a `footprintEnumerator(userId)` at module definition; the deletion guard is the union over the registry (the v99.10/114.2 ad-hoc blind spot becomes structurally impossible) and **fails closed** on any `unreadable`. Storage key ≠ actor: `onBehalfOf` is a narrow, stripped-elsewhere field; actor tagging is wired into *both* login and session-restore paths from day one (v123.1: restored sessions logged blank actors for weeks).

### 9.3 UI architecture
React 19 + React Compiler. No Redux/Zustand — repositories are the external stores behind a `useRepo(scope)` hook on `useSyncExternalStore`. The v59.190–197 saga's *final* lessons are the *initial* design:
- **One app-wide epoch (generation counter)**, incremented synchronously inside the reset function on login/logout/workspace-switch/role-preview — never session-key string comparison (React re-renders within one commit before any effect; v59.195's deeper bug). Snapshots carry their epoch; a mismatched snapshot renders neutral.
- **Boot gating**: boot-source registry, children mount under the overlay, minimum-visible-time floor from day one, an errored source never blocks readiness; hydration flags gate *decisions* (clear a session, render the shell), never reads (v59.11, v59.132/163).
- **Tab preservation, the structural fix, once** (XQAP shipped this bug four times): the tab host renders each tab as a memoized element created once per `(tabId, epoch)`; visibility is CSS; **tab components take zero changing props** (everything via subscriptions), so React bails out of hidden subtrees by identity. A standing adversarial test: churn shell state 100×, assert the hidden tab's render counter never moves.
- **Labels/RTL**: the `labelsStore` pattern unchanged (defaults + overrides + `useLabels()`); hard-coded UI strings are a lint error; namespaced storage keys (shared `file://` origin); logical CSS properties enforced; `@tanstack/react-virtual` (react-window's RTL gap stands).

---

<a id="10-errors"></a>
## 10. Error taxonomy and retry policy — one table, one helper

v123.0's finding: six independently-written retry loops, none recognizing the actual error name. The kernel ships **one** classification table and **one** `retry(op, policyName)`; a bespoke retry loop is review-rejectable; a lint rule flags `catch` blocks inspecting `.message`.

| Condition | Category | Policy |
|---|---|---|
| `NotFoundError` — ordinary read/probe | ABSENT | No retry → tri-state `absent`. |
| `NotFoundError` — post-write verify only | LISTING_LAG | Patient ladder ~11 s (the file provably exists; SMB listing lag — v75/98.0). |
| `NotFoundError` — between list and open | ENUM_RACE | Resolve entry to null; never abort the walk (v76.0, v41.4). |
| `NotReadableError`, `InvalidStateError` | STALE_SNAPSHOT | 4× retry **re-acquiring the handle/File each attempt** — a stale interface object fails identically forever (v56.1, v123.0). |
| `NoModificationAllowedError` | CONTENTION | Jittered 6×100 ms (SMB-sized). **Never** permission loss (v99.5). |
| `NotAllowedError` / `SecurityError` | PERMISSION | No retry; re-request permission **outside** any CAS loop (v59.12); → `RECONNECT_REQUIRED`. |
| `QuotaExceededError` | CAPACITY | No retry; coded surface. |
| Hash/parse/truncation | CORRUPTION | No retry; `.bak`/quarantine path (§7.4). |
| CAS revision/token mismatch | CAS_CONFLICT | casLoop ≤10 attempts, jittered, delayed re-verify. A *thrown* verify ≠ data loss — re-read before declaring failure (v123.0 discarded a confirmed write). Exhaustion surfaces a visible conflict (v48.2). |
| Write verifies, then vanishes/alters shortly after | **SCANNER_INTERFERENCE** | 2 retries at 1 s / 5 s; then a code naming AV/DLP as suspect (v98.3). |
| Anything else | UNKNOWN | No retry (v26.1); log **including `error.name`** — its omission blinded v123.0. |

Every user-visible failure carries a stable quotable code (the `XQ-AREA-NNN` catalog pattern, v92.0 — built day one, not retrofitted at week 8), **tagged onto, never wrapping**, the error object. Raw English DOMException text never reaches the Arabic UI (v75.0).

---

<a id="11-testing-process"></a>
## 11. Testing strategy, quality gates, process

**Testing:**
1. **Memory-FS double with fault injection, day one**: permission simulation (v58.1: a double hardcoded to "granted" made a whole regression class untestable), per-path fault schedules (`failNthRead(path, n, "NotReadableError")`, `tornWrite(path)`, injected latency), mid-enumeration mutation, and every DOMException the classifier knows — including `InvalidStateError`.
2. **I/O-count assertions as a CI gate**: the double counts opens/reads/writes/enumerations per logical operation; core flows carry tight budget assertions. The only test shape that catches "re-scans everything while appearing correct from return values" (v59.137) — and would have caught the 192,063-op disaster pre-production.
3. **Adversarial-ordering tests for every async identity transition** (login, restore, workspace switch, epoch bump): publish before subscribe, reset mid-render, deliver a stale-epoch snapshot late — every XQAP timing bug passed its own tests because the tests built the safe ordering.
4. **Golden snapshots with the traps pre-sprung**: `.gitattributes` day one (CRLF divergence), mandatory injected clock (no direct `Date.now()`/`new Date()` in builders — lint rule), deterministic modules under a declared path set, CI failing any diff without a golden-manifest update.
5. **Real concurrency interleaving**: genuine `Promise.all` races with injected jitter; **fake timers banned** in any test exercising CAS delayed re-verify, leases, or retry ladders (v117.13's dangling-lock trap) — delays are injectable parameters shortened to real ms sleeps.
6. **Failure-injection suite** (proposal §43 adopted): torn writes, duplicates, out-of-order, truncated segments, vanished files, identity rename, old-build/new-schema — CI against the double; site-data-clear and permission-revoke as scripted Playwright/manual; SMB loss and 100-writer bursts in Phases 0/5 on the real share.

**Process (kept from XQAP — proven, cheap):** generated tiered edit-log discipline; tier-3 sweeps as release gates only; version-consistency check; vendored-dependency SHA check; complexity budget; **per-PR bundle-delta CI job as the real guard with the ceiling as permission-not-target**; mandatory `build` + `typecheck` before any push at every tier (vitest transpiles per-file and hides type errors). **Added:** error-code catalog from day one; the one-retry-helper rule; snapshot-before-touch enforced by CI; a reviewer rule that any PR touching effect timing, epoch transitions, or the tab shell requires an independent adversarial review pass — the only mechanism that caught all five v59.19x rounds. **Dropped:** XQAP-specific checks (hex-literals) unless the same problem recurs — no cargo-culting.

**Packaging:** Vite + `vite-plugin-singlefile`; source fully modular TS; dev-only preview entries excluded from production. **Initial raw ceiling 8 MB — deliberately tight**; raises name the feature and measured overage. Fonts subset from day one (Arabic + Latin + digits), budgeted as a named line item. hash-wasm pre-approved; any other WASM must win its place *including* its base64-inflated raw cost. `public/` stays empty (the single-file guarantee, v38.4).

---

<a id="12-phases"></a>
## 12. Phased delivery plan

| Phase | Scope | Days | Acceptance |
|---|---|---|---|
| **0 — Environment proof** | On the *actual* fleet, share, deepest real UNC path: full API surface under `file://`; read-after-write + enumeration latency distributions; 100 parallel ops; **all probes with production file extensions** (v98.3); path-budget probe incl. `.crswap`; `createWritable({mode:"exclusive"})` **cross-machine** test; `FileSystemObserver` cross-machine probe (expect failure; confirm); `storage.persist()` under `file://`; GPO/CBCM policy review with IT; browser-wipe acceptance test end-to-end; shared-`file://`-origin collision check. | 4–7 | Written results per probe; every red item has a named mitigation before Phase 1. Retry ladders re-sized from *measured* numbers. |
| **1 — Storage kernel** | Tri-state reads, the three write shapes, safeWrite, casLoop, error table + one retry helper, path budget, IDs/hashing, workspace connect/reconnect/wipe-recovery, bootstrap. | 15–25 | Repository contract implemented against the memory double; failure-injection CI subset green; I/O budgets published per primitive. |
| **2 — Event kernel** | Event format, signing + key registry, segments/rotation/heads, upcaster chain, fold framework + transition tables, checkpoints with composite keys, `mutate(decide)`. Timeboxed validation against the failure-injection scorecard + a real-share smoke test. | 10–15 | Scorecard green; duplicate/out-of-order/torn-segment scenarios pass; a one-page decision record confirms (or, on failure, triggers the Yjs escape-hatch evaluation for affected surfaces). |
| **3 — Sync engine** | Heads-based discovery, subscriptions, cadences, BroadcastChannel local echo + polling-leader election, observer acceleration, freshness UI, reconciliation. **Restore-merge semantics specified before code.** | 12–20 | Propagation SLOs measured on the real share (target: <10 s foreground observe, p95 <30 s, max <60 s); observer-silent/polling-only scenario green. |
| **4 — Datasets & blobs** | Chunked immutable datasets + manifests, gzip windows, blob store, worker streaming, backup/restore incl. merge-restore. | 10–15 | A real ≥500 MB customer-scale file round-trips through worker streaming without OOM; ~22.7×-class compression reproduced; restore-merge scenarios green. |
| **5 — Scale test** | 50 → 100 → 250 simulated clients on the real share; tune cadence/segment/shard/batch. | 5–8 | No error-rate cliff at target concurrency; per-directory entry counts within budget; SLOs hold. |
| **6 — Product build** | Business features, on repository APIs only. | — | Begins only after 0–5 are green. |

Total pre-product infrastructure: **~56–90 engineering days**. That is the honest price of "no backend" — XQAP paid it in production incidents instead.

---

<a id="13-decision-log"></a>
## 13. Decision log — deviations from the input proposal

| Proposal position | This blueprint | Why |
|---|---|---|
| Automerge CRDT for mutable operational state (§6–10, rule 7) | **Rejected** → formalized signed per-writer event log; Yjs-only escape hatch behind an explicit trigger | §4.3: no production precedent, ~17× Yjs's bundle at 0× the domain need, binary opacity, safeWrite still required underneath, and the domain wants conflicts *rejected fresh*, not merged. |
| Retire `.bak`/`.tmp` protocols for operational state (§53) | Rejected **for the surviving single-writer mutable files** | A torn `head.json`/bootstrap is the bricked-workspace scenario (v43.4). Correct for immutable objects only. |
| "Prefer Automerge's storage model" for compaction (§49) | Replaced by lease + content-addressed snapshots + seal-and-archive (§7.5) | Coordinator-less GC is unsolved in all surveyed prior art; our protocol embeds the one documented mitigation (content addressing) without the CRDT. |
| Columnar library day one (implied §21–22) | Trigger-gated: hand-rolled columnar+gzip first; hyparquet on measured need | 22.7× is already banked; a library must buy something measured. |
| SLO "<2 s median commit" | Kept as target, sized by Phase 0 measurements | XQAP's share latencies argue against promising numbers before measuring. |
| No mention: shared `file://` origin; AV extension policy; path budget enforcement; clock-skew rules; restore-merge; per-lane worker staleness | **Added throughout** | Each is a documented XQAP incident (v98.3, v99.4, v78.0/85.0/99.7, v59.189) or a verified new platform finding. |
| Everything else — data classes, immutable IDs, three write shapes, subscriptions, tri-state reads, freshness UI, failure-injection list, wipe acceptance test, phased structure | **Adopted, most of it verbatim** | The proposal's storage diagnosis was right; this blueprint sharpens execution, it does not re-litigate direction. |

---

<a id="14-risks"></a>
## 14. Risk register (top 10)

| # | Risk | Grounding | Mitigation |
|---|---|---|---|
| 1 | Stale state across async identity transitions resurfaces | v59.190–197 (5 rounds), 4× tab bug | Epoch + `useSyncExternalStore` structural design; mandatory adversarial-ordering tests; adversarial-review rule |
| 2 | Absent/unreadable conflation licenses a destructive write | ≥8 recurrences in 9 days; v99.1, v99.6 | Tri-state in the type system; `mutate` refuses after `unreadable`; footprint guard fails closed |
| 3 | Real production volume invalidates size assumptions | 573 MB file, 500k rows, 35.66× inflation — all production-discovered | Streaming default-on above thresholds; Phase 4 acceptance on real-scale files; "10× what you tested" headroom rule |
| 4 | The event kernel becomes the new most-bug-prone module | XQAP's fold/checkpoint history; zero prior art for no-server file sync | Timeboxed Phase-2 validation scorecard; upcaster chain isolates versioning; I/O budgets in CI; set-fold idempotency by construction |
| 5 | AV/DLP or GPO silently breaks/blocks file ops on the fleet | v98.3; verified enterprise-policy surface | Production-extension probes + IT policy review in Phase 0; SCANNER_INTERFERENCE category |
| 6 | Path-length / files-per-dir limits bite at deployment | v99.4; measured NTFS degradation | Enforced path budget vs. deepest real UNC path; 22-char hash filenames; sharding with entry budgets |
| 7 | Bundle raw-size creep degrades every open | v123.2's months-long wrong assumption | 8 MB deliberate ceiling + per-PR delta as the real guard; WASM/fonts as named line items |
| 8 | Worker protocol regressions (unbounded messages, cross-lane staleness, silent death) | v117.7/8, v59.189, v97.2 | Framework-level protocol rules; no microtask-instant worker mocks; Nth-load recovery test |
| 9 | Restore/backup silently loses or hides events | v78.0, v85.0, v99.7, v112.0 | Merge-not-replace + cursor invalidation specified pre-Phase-3; unreadable-during-backup fails the backup; restores audited |
| 10 | New risk this design introduces: non-idempotent `decide` functions (re-invoked on retry) | Analog of v59.9's non-idempotent replay guard | `decide` contractually pure (lint); side effects keyed off `CommitResult` only; kernel tests re-invoke every `decide` at least twice |

---

<a id="15-rules"></a>
## 15. Non-negotiable rules

1. Static HTML is only the deployment format; source stays modular TypeScript.
2. The shared folder is authoritative; browser storage is disposable acceleration; a wipe is a routine, tested condition.
3. No committed business data lives only in browser storage — a durable action completes when `workspace_committed`.
4. Every kernel file is exactly one write shape: immutable, single-writer mutable, or CAS-merged. Never a shared mutable free-for-all.
5. Tri-state reads everywhere; `unreadable` never licenses a write, a default, or a "safe to delete".
6. Mutations go through `mutate(id, decide)` against fresh state — no other write API exists.
7. Immutable IDs as storage identity; usernames are display data; filenames are short hashes under an enforced path budget.
8. Every file the kernel writes ends in `.json`; every probe uses production filenames.
9. Ordering comes from Lamport counters + code-unit tiebreaks; wall clocks are display-only.
10. Polling over subscriptions is the only cross-machine correctness mechanism; observers, digests, and caches are acceleration.
11. Derived data is disposable, composite-keyed on every input dimension, and never restored from backup; restore merges, never replaces.
12. One error-classification table, one retry helper, stable error codes, `error.name` always logged.
13. Deterministic modules are snapshot-gated; algorithm/fold/upcaster versions stamped from the first release.
14. Raw bundle bytes are the budget; every raise names its feature and measured overage.
15. Nothing ships to Phase 6 before Phases 0–5 are green on the real environment; benchmarks on the actual SMB share are the only capacity claims.

---

<a id="16-stack"></a>
## 16. Technology stack summary

| Layer | Choice |
|---|---|
| Deployment | One self-contained static `index.html` (Vite + `vite-plugin-singlefile`; dev-only entries excluded) |
| UI | React 19 + TypeScript + React Compiler; `useSyncExternalStore` over repository subscriptions; no state library |
| Operational state | Signed per-writer append-only event log (NDJSON segments) + rebuildable projections |
| CRDT | None. Escape hatch: Yjs per co-edited document type, trigger-gated |
| Shared access | File System Access API; Web Locks (same-machine, prefixed); BroadcastChannel local echo + leader election |
| Change observation | Targeted polling of subscriptions (correctness) + `FileSystemObserver` (same-machine acceleration) |
| Browser persistence | IndexedDB cache-only (`relaxed` durability, batched); OPFS chunk cache as a measured upgrade |
| Datasets | Hand-rolled columnar-JSON + gzip (`CompressionStream`, 64 KB windows), immutable chunks + manifests; hyparquet/fflate trigger-gated |
| Blobs | Content-addressed SHA-256 (hash-wasm streaming), immutable |
| Auth | Argon2id via hash-wasm (OWASP baseline), advisory trust boundary documented; per-writer ECDSA-P256 event signing with append-only key registry |
| IDs | Prefixed immutable IDs; 22-char base32 hash forms in filenames |
| Workers | Blob-URL inline workers; bounded chunk streaming; per-lane staleness; silence watchdogs |
| Virtualization | `@tanstack/react-virtual` |
| Errors | One DOMException-name classification table + one retry helper + stable error-code catalog |
| Security perimeter | Windows SMB ∩ NTFS ACLs (IT-owned, documented deployment requirement) + advisory app-level authorization |

---

<a id="17-sources"></a>
## 17. Verified sources

**CRDT:** Automerge storage/adapters (`automerge.org/docs/reference/repositories/storage/`, `automerge.org/automerge-repo/classes/_automerge_automerge-repo.StorageAdapter.html`, `automerge.org/docs/reference/under-the-hood/storage/`, `automerge.org/docs/reference/library-initialization/`, `automerge.org/automerge-binary-format-spec/`, `automerge.org/blog/automerge-3/`, `github.com/automerge/automerge/issues/870`, `docs.rs/automerge`); concurrent compaction analysis (`patternist.xyz/posts/concurrent-compaction-in-automerge-repo/`); Yjs (`docs.yjs.dev/api/document-updates`, `github.com/yjs/y-indexeddb`, `github.com/yjs/yjs/blob/main/INTERNALS.md`); bundle comparisons (`github.com/dmonad/crdt-benchmarks`, pkgpulse 2026 comparison); CRDT-over-filesystem PoC (`tonsky.me/blog/crdt-filesync/`); production caution (`powersync.com/blog/why-cinapse-moved-away-from-crdts-for-sync`).

**Platform:** FileSystemObserver (MDN; `developer.chrome.com/blog/file-system-observer`; blink-dev Intent to Ship, Chrome 133; `github.com/whatwg/fs/blob/main/proposals/FileSystemObserver.md`); persistent permissions (`developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api`); enterprise policies (`chromeenterprise.google/policies/...`); secure contexts (W3C; MDN same-origin policy — the shared `file://` origin); `showDirectoryPicker` (MDN); CompressionStream formats (MDN, June 2026); Web Locks (MDN/W3C); `createWritable` exclusive mode (`developer.chrome.com/blog/new-dev-trial-for-multiple-readers-and-writers`, `github.com/whatwg/fs/issues/148`); SMB watcher unreliability (`github.com/microsoft/vscode/issues/201103`, `github.com/dotnet/corefx/issues/7576`).

**Data engineering:** Arrow JS (`arrow.apache.org/docs/js/`, `github.com/apache/arrow-js/issues/52`); parquet-wasm (`github.com/kylebarron/parquet-wasm`); hyparquet (`github.com/hyparam/hyparquet`); fflate (`github.com/101arrowz/fflate`); WHATWG compression explainer; IndexedDB performance (Nolan Lawson, 2021; storage quotas MDN); OPFS vs IndexedDB measurement (`powersync.com/blog/sqlite-persistence-on-the-web`); `SubtleCrypto.digest` one-shot contract (MDN); hash-wasm (`github.com/Daninet/hash-wasm`); FastCDC (USENIX ATC '16); Samba/Azure Files large-directory guidance.

**Prior art & security:** KeePass multi-user/sync (`keepass.info/help/base/multiuser.html`, `keepass.info/help/v2/sync.html`); Syncthing conflict handling (`docs.syncthing.net/users/syncing.html`); Obsidian sync conflict model; Git object model (GitHub blog); Fossil sync; local-first (Ink & Switch); event-sourcing patterns (Azure Architecture Center; event-driven.io upcasting; production war stories); Certificate Transparency (RFC 6962) and Sigstore/Rekor; OWASP Password Storage Cheat Sheet (Argon2id baseline); WebAuthn secure-origin requirement; version vectors and Dotted Version Vectors (Preguiça et al., arXiv:1011.5808); Merkle anti-entropy (HashiCorp).

---

**Relationship to XQAP:** this blueprint is the architecture XQAP converged on after nine weeks of production incidents — per-writer files, append-only events, rebuildable projections, tri-state reads, structural contention avoidance — designed in from the first commit, formalized (version vectors, Lamport ordering, upcaster chains, signed events), and stripped of the parts XQAP proved wrong (username-keyed files, shared mutable hotspots, per-feature retry loops, caches keyed on partial dimensions). Where the future disagrees with this document, update this document — it is the argument, not just the answer.
