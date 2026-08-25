# Data & Sync Kernel — Decision Document

**Role:** Data & Sync Kernel Architect · **Date:** 2026-08-25 · **Status:** Decided (fallback triggers stated inline)

---

## 1. Mutable operational state: formalized per-writer event log. Not Automerge. Not Yjs.

**Verdict:** The kernel's representation of mutable operational state is an **XQAP-style per-writer append-only event log, formalized** — signed events, bounded per-writer segments, explicit version-vector heads, rebuildable projections. I am explicitly rejecting the proposal's Automerge recommendation (§6–10, §51 rule 7).

**The decision hinge**, as the critique correctly framed it: *how much genuine same-record co-editing does this domain have?* The answer, from nine weeks of XQAP production history, is **approximately none — and where it occurred, it was a bug we blocked, not a feature we merged.** Every serious same-record conflict in the record — ownership theft via unchecked replacement approval (v90.0), stale-tab reassignment stealing another supervisor's rows and regressing completed work (v98.4/98.5), cross-supervisor approval races (v43.6/43.7) — was fixed with *fresh re-reads and terminal-state guards that refuse the second write*. Automerge's core value proposition is silently accepting both writes. For an audit-grade workflow system, silent merge is the failure mode, not the fix. The proposal itself concedes this at §26: for the decisions that matter (approve vs. reject), it falls back to append-only decision events with a derived effective decision — which *is* the event log. Automerge would be carried for the residue.

**The supporting evidence closes the case:**

- Research 1 confirms the SharedFolderSyncAdapter is **wholly new code with zero production precedent** — the only public CRDT-over-shared-folder artifact is a self-described proof-of-concept. So the choice was never "proven library vs. home-grown log"; it is "home-grown transport for someone else's opaque binary format vs. home-grown log in a format we already debugged for nine weeks." XQAP's most bug-prone module was exactly this kind of component (the fold + checkpoint, §9 passim); moving the complexity into a binary we cannot grep makes every one of those bugs harder, not rarer.
- Research 1 also confirms **safeWrite discipline is still required under Automerge** (a torn chunk hits the "MUST abort" checksum path), the compaction race requires the same content-addressed discipline we'd need anyway, and Automerge's convergence guarantee has a documented historical counterexample (issue #870). We would keep all our hard problems and add theirs.
- Bundle: ~320 KB gzip WASM, base64-inflated, against a `file://` deployment where **raw bytes are what users wait on** — a lesson XQAP held wrong for months before correcting (v123.2). Indefensible for a feature the domain doesn't need.
- Greppability: v90.0's forensics were literally a manual grep across the share. v123.0's four-bug cluster was diagnosed off plain JSON. In a no-backend deployment the admin *is* ops; binary changes with no inspection tooling (Research 1 §4) forfeit that.

**Narrow escape hatch:** if the product later grows a genuinely co-edited rich-content surface (shared free-text case notes edited live by two people), adopt **Yjs — never Automerge** — for *that document type only* (~18 KB, pure JS, categorical idempotence/commutativity guarantees, `Y.mergeUpdates` file-exchange shape), storing Yjs updates as immutable payloads inside ordinary kernel events. **Fallback trigger:** two or more shipped features requiring character-level concurrent text merge. Until then, zero CRDT bytes in the bundle.

### The event log, concretely

An **event** is one JSON object (one NDJSON line):

```json
{ "v": 1, "id": "evt_<22-char-hash>", "type": "case.assigned",
  "typeV": 2, "writer": "wrt_<id>", "lamport": 4182,
  "wallTime": "2026-08-25T11:02:03Z", "partition": "cases/2026-08/p3",
  "subject": "case_<id>", "payload": { }, "prevHash": "<sha256 of prior line, this segment>",
  "sig": "<ECDSA-P256 over canonical bytes>" }
```

- **Identity:** `id` is globally unique; the fold is a **set-fold over event IDs** (duplicate application is a no-op; discovery order is irrelevant), validated by XQAP's commutative digest (§3/§4.3 of the lessons doc). This *is* the idempotency and out-of-order story: re-reading a segment, replaying a duplicated batch, or discovering segments in any order all converge.
- **Ordering:** `lamport` (per-writer monotonic counter, advanced past any observed counter) with **writer-ID tiebreak by raw code-unit comparison** — never `localeCompare` (v41.37), never wall clock (Research 4 §5; critique flag #3). `wallTime` is display-only.
- **Schema evolution:** `typeV` per event type, resolved by an **upcaster chain** at read time (Research 4 §2) — the fold sees only current shapes, killing XQAP's version-branching-inside-the-fold bug class. Unknown future `typeV` → **dropped-and-preserved**, never crash (v47.2).
- **Transitions:** the fold is a per-subject state machine with an explicit legal-transition table, a `default` branch that preserves state (v41.28's silent-reset bug), and terminal-state guards covering **every** mutating event type, including request-type events (v98.4's gap).
- **The hard rule from §6.1 of the lessons doc, in the kernel not the app:** every mutating repository operation re-folds the subject's authoritative state **immediately before** appending — `append(event, expectedState)` refuses if the fresh fold disagrees. Ownership-theft-by-stale-snapshot becomes structurally impossible, not per-incident-patched.

---

## 2. Workspace layout

```
ws/
  bootstrap/            workspace.json  keys.json (append-only key registry)  schema.json
  log/
    <partition>/        e.g. cases-2026-08-p3/  (partition id ≤ 24 chars)
      w/<writerId>/     seg-<lamportStart>-<8hex>.jsonl.json   (sealed, immutable)
                        head.json                              (single-writer mutable)
      snap/<hash>.json  (content-addressed compaction snapshots)
      digest.json       (partition rolling digest — CAS, admin/elected only; advisory)
  ds/                   datasets: ds_<id>/manifest.json + c/<seq>-<8hex>.bin.gz.json
  blob/<2hex>/<sha256-hex>.bin.json
  users/                per-user bootstrap (roles snapshot; CAS)
  sys/                  leases/  backups/  diag/  errorlog/w/<writerId>/
```

- **IDs:** `evt_`/`case_`/`usr_`/`wrt_` prefixes + **22-character base32 hash IDs, never 36-char UUIDs in filenames** (v99.4 — 80-char names + deep UNC + Chromium's staging suffix broke 260). UUIDv7 may exist *inside* payloads; filenames get the short form. **Immutable IDs only — never usernames** (the rename-orphan hazard, lessons §6.1).
- **Path budget (enforced, not advised):** at workspace connect, measure the root's own path length (via a probe write of the longest legal kernel path). Budget: **root ≤ 120 chars** (hard warning above, refuse above 140), **app-relative path ≤ 100 chars** (grammar above guarantees this: `log/` + 25 + `w/` + 12 + 30 ≈ 80 worst case), **reserve 20 chars** for `.crswap`/`.tmp` siblings → total ≤ 240 < 260. This is a Phase-0 test against the *real deepest UNC path*, per Research 2 §5.
- **Extensions — the v98.3 rule:** every file the kernel writes ends in **`.json`**, including NDJSON segments (`.jsonl.json`) and binary chunks (`.bin.gz.json`), because `.json` is the one extension the fleet's AV/DLP allowlists are proven to pass; a novel extension is exactly what v98.3 showed gets silently quarantined while the `.tmp` probe lies. Phase 0 probes write/read/list with **production filenames**, not synthetic ones. Yes, `.bin.gz.json` is ugly; ugly beats quarantined.
- **Sharding:** partitions are the shard. Within a partition, per-writer directories bound entry counts naturally; rotate a partition (e.g. monthly) before any directory approaches ~10k entries (Research 3 §6; SMB enumeration degradation).

---

## 3. Write protocol

**Three shapes, and every kernel file is assigned exactly one:**

| Shape | Files | Protocol |
|---|---|---|
| **Immutable** (new unique name, never rewritten) | sealed segments, snapshots, dataset chunks, blobs, backups | Write → close → read back → **verify bytes/hash** → only then publish a reference. No `.bak` needed (replaces nothing — proposal §32 is right *for this shape only*). |
| **Single-writer mutable** | `head.json` per writer, active segment, per-user prefs | Full XQAP **stage → verify → commit → re-verify → rollback-or-promote** with `.bak`. The critique's flag #6 is correct and the proposal's §53 over-corrects: a torn `head.json` or `bootstrap/workspace.json` is the v43.4 bricked-workspace scenario. Keep safeWrite for these few files. |
| **CAS-merged mutable** (rare) | `bootstrap/*.json`, `users/*`, `digest.json`, leases | XQAP casLoop verbatim: revision + UUID write-token + immediate read-back + **jittered 80–180 ms delayed re-verify** (v43.15 — the immediate-only gap was live for weeks). Unexpected errors fail immediately (v26.1). Never on a polling path (v123.0's write storm). |

**Segments:** active segment is **append-by-rewrite until 64 KB, then chunked appends**, rotating to sealed at **256 KB target / 1 MB hard cap**, and always sealed on session end or 30 min idle (v79.0: unbounded rewrite-whole was quadratic and widened the torn-read window). Sealed = renamed once into its final immutable name, hash-stamped in `head.json`.

**Batching/flush:** buffer events in memory; flush on **5 s of activity, 32 KB accumulated, or a `durable: true` commit** (any workflow-significant action — assignment, submission, approval — is `durable: true` and the UI awaits `workspace_committed`). Preference edits ride the timer. This sits deliberately between XQAP's two measured failure modes: one-file-per-event (192,063 ops, 3–6 h, v61.0) and giant rewrites.

**Tri-state read contract — the kernel's most important type:**

```ts
type SharedRead<T> = { kind: "found"; value: T }
                   | { kind: "absent" }          // every location genuinely examined and empty
                   | { kind: "failed"; error: ClassifiedError }
```

`absent` may be returned **only** when every candidate location was successfully enumerated and found empty. Any inconclusive failure is `failed`, and `failed` **never licenses a default-seeding write**. This conflation caused XQAP's worst data loss — roster wiped back to revision 1 by one read blip (v99.6), default accounts durably persisted over real ones mid-session (v99.1), eight recurrences in nine days (lessons §10.1). It is a compile-visible type, not a convention.

---

## 4. Discovery & sync engine

**Heads, not listings.** Each writer maintains one tiny `head.json`: `{ writerId, lamport, activeSegment, activeSize, sealed: [{name, hash, count}], updatedAt }`. The set of heads in a partition **is the version vector** (Research 4 §5 — XQAP's per-writer files were always an implicit version vector; we serialize it). "Anything new?" = read N small head files and compare lamports against the local vector — no directory enumeration, no document parsing. A partition-level `digest.json` (hash over sorted head hashes — Merkle-lite) lets a client skip a whole partition with one read; it is **advisory acceleration written by admin sessions only**, never a correctness input and never written from a read path (v123.0).

**Subscriptions:** each session holds `{ partitionId, reason }` derived from role + open records + navigation (proposal §15, adopted as-is). Nobody polls everything (v70.0's re-sync storm).

**Cadences:** active/foreground partitions **5 s**; visible-but-idle **20 s**; `document.hidden` → **suspend entirely** (v59.170) except one 60 s heartbeat on the user's own notification partition. Scoped reconciliation — verify sealed-segment lists and hashes against local state per subscribed partition — every **5 min**, staggered with jitter. Change detection compares **(name set, size, mtime, head hash)** — never size alone (v83.1: same-length edits were invisible).

**Same-machine coordination:** all `file://` pages share one Chromium origin (Research 2 §3 — new finding), so: every `localStorage`/IndexedDB/BroadcastChannel/Web Locks name carries an app+workspace-ID prefix, as a hard rule. Web Locks serialize same-machine writers per logical path (keyed on **full logical path**, never leaf name — v81.0; outer RMW locks get distinct `:rmw` keys — v41.36). BroadcastChannel propagates "I appended to partition X" so sibling tabs refresh without disk polls, and elects one tab per machine (via a held lock) as the polling leader — other tabs consume its broadcasts.

**FileSystemObserver:** acceleration only, observing the workspace root to fast-echo same-machine writes; **assume it never fires for another machine's SMB write** (confirmed by Research 2 §1). Polling is the sole correctness path. An observer event triggers an immediate targeted head-check, nothing more.

**Freshness UI:** `LIVE` / `SYNCING` / `LOCAL_PENDING` (unflushed buffer — visibly flagged) / `WORKSPACE_UNAVAILABLE` / `RECONNECT_REQUIRED` / `ERROR`, with "synced Ns ago" per view. A refresh **never clobbers unsaved draft state** (XQAP standing rule).

---

## 5. Caching

**Tiers:** memory (folds, live queries) → **IndexedDB** (fold checkpoints, head vectors, dataset-chunk metadata, decompressed small chunks, remembered directory handle; `durability: "relaxed"`, batched 500–1000 puts/transaction) → **OPFS deferred**: v1 ships IndexedDB-only; adopt OPFS `SyncAccessHandle` as the chunk-byte cache **only when** measured chunk-cache traffic exceeds ~50 MB/session (Research 3 §5's ~9× applies to large binary volume we haven't proven yet). All tiers disposable; the folder is the sole authority.

**Invalidation keys — the fingerprint-blindness rule.** XQAP was burned four separate times by a cache keyed on fewer dimensions than its derivation consumed: revision without fold version (v41.39), revision without derive version on the mirror guard (v88.0/89.1 — the fix that shipped inert), event digest without the sample-row set (v101.0 — a whole class of change invisible to every freshness signal), dedupe key without an input dimension (v59.142). Therefore every checkpoint/cache entry embeds a **composite key of every input dimension**: `{ foldVersion, upcasterChainVersion, headsVector (per-writer lamports + sealed-set hash), auxInputFingerprint (order-sensitive hash of any non-event input the fold reads), schemaVersion }`. Any mismatch on any dimension → full rebuild. Rule for reviewers: *adding an input to a derivation and not adding it to the key is a correctness bug, not an optimization miss.*

**Cold boot after wipe (routine, not disaster):** Connect Workspace → validate `workspace.json` identity → load `users/` bootstrap → for each subscribed partition, load latest snapshot (if any) + fold sealed segments newer than it + active tails → UI ready per-partition (own-work partitions first) → rebuild remaining caches in background. Checkpoints only ever accelerate this; they are **never restored from backup and never trusted across a restore** (v78.0/v85.0 — see §6).

---

## 6. Integrity & tamper-evidence

**Hashing:** **SHA-256 via hash-wasm streaming** (`init/update/digest`) for all content addresses and segment seals — already a dependency (Argon2id), composes with chunked reads, avoids `crypto.subtle.digest`'s whole-buffer-in-memory contract that recreates the 573 MB failure shape (v86.0). Not BLAKE3: SHA-256 hex is what an admin's off-the-shelf tooling recognizes, and hashing throughput is not our bottleneck (Research 3 §4). Full-payload hash verification is size-gated (≤512 KB) as in XQAP (v80.0: hashing cost 7.1× the parse); above that, the write path's byte-exact verification is the stronger guarantee anyway.

**Signing: adopt per-writer ECDSA-P256, with honest framing.** Each writer generates a keypair in-browser; the public key is published as an append-only registration event in `bootstrap/keys.json` (CAS shape). Every event is signed; segments additionally carry the per-line `prevHash` chain. **Key management is option (b) from Research 4 §3:** on browser-storage wipe, generate a fresh keypair and append a new registration — **key history is append-only, never replaced**, so old events remain verifiable under old keys. No passphrase-derived keys (that invents a second offline-crackable credential, duplicating the bootstrap-admin risk XQAP already accepts once). The documented claim, verbatim in the security model doc: *"tamper-evident against another user editing a peer's file by hand; not tamper-proof against the file's own legitimate writer or anyone with SMB write access."* Same advisory posture as XQAP's `SECURITY_MODEL.md`, upgraded from djb2-recomputable to cryptographically checkable. This design has no direct precedent (Research 4's flag #2) — it gets its own written risk-acceptance section.

**Corruption handling:** a sealed segment failing its hash is **quarantined** (renamed `.corrupt.json`, surfaced in diagnostics with its writer/lamport range, events salvaged line-by-line up to the first bad line) — **never silently skipped** (v78.0: silently dropped unreadable segments turned a backup into a lie). A truncated file classifies as *corrupt*, not as valid-short (v89.0's critical bug), and corruption never overwrites a `.bak` without full inflate+CRC verification first (v89.0's second critical bug).

**Restore must merge.** Restore unions segments by filename (immutable names make this safe), **never replaces** the log directory (v78.0), invalidates every checkpoint/cursor whose heads-vector no longer matches, and **re-mints the change-detection token** so other clients notice (v99.7 — the invisible-restore bug). Derived caches and checkpoints are never in backups at all.

---

## 7. Compaction / GC

The honestly-hardest problem (Research 4: unsolved in all surveyed prior art). Protocol:

1. **Admin-only, explicit, lease-guarded.** KeePass-pattern lease at `sys/leases/compact-<partition>.json`: `{ holderId, acquiredAt, expiresAt (10 min), heartbeat }`, refreshed on a timer; acquisition and steal-after-expiry both go through the full CAS-with-delayed-reverify protocol so two stealers can't both win.
2. **Snapshot + tail, content-addressed.** Compactor folds all sealed segments up to a recorded heads-vector, writes `snap/<contentHash>.json` embedding that vector and the fold/upcaster versions — a new unique name, **never overwriting a prior snapshot** (the patternist content-addressed rule; concurrent compaction degrades to redundant snapshots, not data loss).
3. **Seal-and-archive, never delete — v1 rule.** Covered segments move to `sys/backups/archive/…` only after (a) a verified backup includes them, (b) a 14-day grace window, (c) every registered writer's head shows a lamport past the snapshot vector *or* the writer is expired-inactive (Dotted-Version-Vector-style retirement so departed writers don't pin GC forever). Hard delete is a manual admin action outside the app. XQAP survived nine weeks on archive-and-supersede; storage is cheaper than a stale client's silent event loss.
4. **Stale-client bootstrap:** newest snapshot whose versions match current code + segments newer than its vector. A snapshot with an unknown future fold version is ignored (falls back to full re-fold) — never trusted by recency (the poisoned-checkpoint class, v41.39 / Research 4 §2's 18-hour war story).

**Fallback trigger:** if a partition's sealed-segment count makes cold-boot folds exceed ~5 s at Phase-5 scale testing, raise snapshot frequency before touching retention.

---

## 8. Large datasets & blobs

**Format: keep XQAP's columnar-JSON + gzip (`CompressionStream`, 64 KB feed windows), chunked** — 22.7× measured on real customer data (v86.0/87.0), greppable after `gunzip`, zero new dependencies. Chunks of **50k rows / ~8 MB compressed target**, immutable, sequence-plus-hash named. `manifest.json` per dataset: schema, partition map, row counts, per-chunk `{name, sha256, rows, byteSize}`, compression, source identity, created time — **metadata only, never inlined rows** (v62.0: an index that copied rows inflated 28 MB to 385 MB). On-disk chunk size, UI page size, and cache budget are **three independent decisions** (Phase A/B lesson). Re-import archives and supersedes; raw inputs are immutable.

**Explicit disagreement with adopting a columnar library day one:** hyparquet is cheap (~10 KB) but v1 doesn't need intra-chunk random access — chunk granularity already bounds reads. **Fallback trigger:** if Phase-5 profiling shows a hot read path decompressing >3× more rows than it consumes, adopt hyparquet(-writer) for that dataset class; Arrow/parquet-wasm only if cross-tool (Python/DuckDB) interop becomes a hard requirement, as a documented bundle-budget raise.

**Blobs:** content-addressed `blob/<2hex>/<sha256>.bin.json`, streamed hash via hash-wasm, verify-after-write, references carry `{hash, size, mime}`. Fixed-size chunking only for oversized blobs; **no content-defined chunking** — our blobs are write-once, there is no edit-locality to exploit (Research 3 §6).

**Workers:** all parsing/folding of large data off-main-thread; results stream out in **bounded batches, never one structured-clone payload** (v117.7/117.8 OOM); every worker gets an error handler plus a silence watchdog sized for legitimate multi-minute parses (v97.2: a dead worker's silence hung promises forever).

---

## 9. Error taxonomy & retry policy — one table, one helper

v123.0's core finding: six independently-written retry loops, none recognizing the actual error. The kernel ships **one** classification table and **one** `retry(op, policyName)`; writing a bespoke retry loop is a review-rejectable offense.

| `DOMException.name` / condition | Category | Policy |
|---|---|---|
| `NotFoundError` — ordinary read/probe | ABSENT | No retry → tri-state `absent`. |
| `NotFoundError` — **post-write verify only** | LISTING_LAG | Ladder to ~11 s total (file provably exists; SMB listing lag — v75–77.0). |
| `NotFoundError` — between list and open | ENUM_RACE | Resolve entry to null, continue enumeration; never abort the walk (v77.0, v41.4). |
| `NotReadableError`, `InvalidStateError` | STALE_SNAPSHOT | 4× retry **with handle/File re-acquired each attempt** — a stale interface object fails identically forever (v56.1, v123.0's unrecognized name). |
| `NoModificationAllowedError` | CONTENTION | Transient: jittered 6×100 ms (SMB-sized, not local-disk — lessons §8). **Never** classified as permission loss (v99.5). |
| `NotAllowedError` / `SecurityError` | PERMISSION | No retry; requery/re-request permission **outside** any CAS loop (v59.12); then `RECONNECT_REQUIRED`. |
| `QuotaExceededError` | CAPACITY | No retry; surface with error code. |
| Hash/parse/truncation failure | CORRUPTION | No retry; `.bak` / quarantine path (§6). |
| CAS revision/token mismatch | CAS_CONFLICT | Full casLoop: ≤10 attempts, jittered backoff, delayed re-verify. **A thrown verify ≠ data loss** — re-read before declaring failure (v123.0 discarded a confirmed write). Exhaustion surfaces a visible conflict (v48.2). |
| Write verifies, then read-fails/vanishes/alters shortly after, or probe file disappears | **SCANNER_INTERFERENCE** | 2 retries at 1 s and 5 s (AV scan windows); then a dedicated error code naming AV/DLP as suspect. Phase 0 probes with production extensions (v98.3: the `.tmp` probe passed while `.ndjson` was eaten — the probe lied). |
| Anything else | UNKNOWN | No retry (v26.1: retrying real bugs); log **including `error.name`** — its omission blinded v123.0's diagnosis. |

Every user-visible failure carries a stable quotable code (XQAP's `XQ-AREA-NNN` catalog pattern, v92.0), tagged onto — never wrapping — the error object. Raw English DOMException text never reaches the Arabic UI (v75.0).

---

## Phase-0 gates (kernel-blocking)

Before Phase 1: production-extension AV probe on the real share; path-budget probe at the real deepest UNC root; `createWritable({mode:"exclusive"})` cross-*machine* test (unverified per Research 4 — if it blocks a second machine, it upgrades the lease steal, never replaces it); FileSystemObserver stability check on the fleet build; `navigator.storage.persist()` behavior under `file://`; 100-parallel-op and read-after-write latency baselines that size the retry ladders above with measured, not inherited, numbers.

**Summary of explicit disagreements with the proposal:** Automerge rejected (§1 above); §53's blanket retirement of `.bak`/stage-verify-commit rejected for the surviving mutable files; §49's "prefer Automerge's storage model" for compaction replaced by the lease + content-addressed snapshot + seal-and-archive protocol; day-one columnar-library adoption deferred behind a measured trigger. Everything else in the proposal — data classes, immutable IDs, subscriptions, tri-state reads, freshness UI, failure-injection list, wipe-acceptance test — is adopted as written.