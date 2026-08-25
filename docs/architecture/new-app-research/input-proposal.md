# Static-HTML Shared-Folder Application Architecture
## Final Revised Research & Reference Architecture (user-provided proposal, 2026-08-25)

**Constraint revision:** This version assumes the application is allowed to be **static HTML only**. No Windows service, companion process, Node server, API server, local daemon, browser extension, installed executable, database server, or cloud component is allowed.

---

# Executive decision

The architecture should **not** treat the Windows shared folder as a traditional mutable JSON database.

The recommended model is:

> **A single self-contained static HTML application + File System Access API + shared-folder authoritative storage + Automerge CRDT for mutable operational state + partitioned compressed storage for large read-mostly datasets + in-memory/IndexedDB disposable caches + observer/polling synchronization.**

The browser must be able to rebuild itself from the shared folder after its cookies/site data are cleared.

Therefore:

- **The shared folder is authoritative.**
- **IndexedDB is optional/disposable cache only.**
- **OPFS is optional/disposable cache only.**
- **localStorage/sessionStorage are UI/session conveniences only.**
- **No business record may exist only in browser storage.**
- **A browser-data wipe must never cause business-data loss.**
- After a browser-data wipe, the user may need to click **Connect Workspace** and select the shared folder again. Under browser security rules, there is no safe static-HTML mechanism that can silently rediscover and reacquire an arbitrary filesystem directory after the stored handle has been erased.
- The application may feel realtime by using `FileSystemObserver` where available and a targeted polling fallback. A target of **5–30 seconds foreground propagation** and **under 60 seconds worst-normal-case propagation** is realistic, subject to SMB/share performance.
- "Unlimited users" cannot literally be guaranteed. The architecture can remove shared-writer collision as the scaling limit, but the SMB server still has finite IOPS, directory-enumeration capacity, bandwidth, memory, and OS limits.

The most important design shift from XQAP is:

> **Do not solve concurrency by repeatedly making mutable files safer. Design the storage protocol so independent users almost never write the same physical file.**

---

# 1. Hard constraints

1. **Static HTML only** — preferably one self-contained `index.html`; JS/CSS/fonts/WASM/worker code bundled/inlined; no local server, no Node at deployment, no `.exe`, no background service, no browser extension.
2. **Windows shared folder / SMB is the common data medium** — many users, variable latency, transient failures, per-file metadata cost dominates.
3. **Browser storage is not durable** — admins clear site data; IndexedDB/OPFS/localStorage/handles are disposable.
4. **Behave like a normal multi-user app** — <= 1 minute propagation acceptable, prefer faster while active.
5. **No silent data loss** — no silent overwrites; transient SMB read failure is never "does not exist"; crash recovery explicit and testable.

# 2. File System Access API notes

- `showDirectoryPicker({ id, mode: "readwrite" })` requires user gesture; Chromium-only; test against company Edge/Chrome + group policies.
- Secure-context: `file://` treated as potentially trustworthy but implementation-dependent; build a startup capability test (isSecureContext, showDirectoryPicker, FileSystemObserver, CompressionStream, DecompressionStream, Worker, crypto.subtle); stop with clear unsupported-environment message if picker missing.
- Handles serialized to IndexedDB disappear on site-data clear; startup has exactly two paths (stored handle → verify permission → connect; no handle → Connect Workspace → user selects → verify workspace identity → continue).

# 3. Durability model

AUTHORITATIVE: Windows shared folder. DISPOSABLE ACCELERATION: memory, IndexedDB, OPFS, localStorage.
A successful business save is not fully durable until committed to the shared folder. UI staging: Applied in UI → Saved locally → Committing to workspace → Workspace committed. Unsynced local-only changes are at risk and must be visibly flagged.

# 4. Top-level architecture

Static HTML app → UI → Domain/Application Services → { Automerge operational state | Dataset Store (large read-mostly) | Blob Store | Derived Indexes (disposable) } → Shared-Folder I/O → File System Access API → SMB share (bootstrap / sync / datasets / blobs / backup / diagnostics). Access storage only through domain/repository APIs (cases.get(id), assignments.forEmployee(userId)) — never scattered filename logic.

# 5. Four data classes

| Data class | Examples | Representation |
|---|---|---|
| Mutable operational | cases, assignments, answers, requests, workflow, comments | Automerge documents + shared sync storage |
| Large read-mostly/immutable | population-like imports, reference extracts, historical datasets | partitioned columnar/binary + compression |
| Blobs | PDF, XLSX, image, scan, document | content-addressed immutable blob store |
| Derived/cache | search indexes, dashboards, table accelerators | memory/IndexedDB; rebuildable |

# 6. Automerge under static-HTML constraint

Automerge JS uses WebAssembly; official docs provide a base64-encoded WASM module for single-file embedding. Build with Vite/TS/npm in development; deployment artifact remains one static HTML.

# 7. Do not make one giant Automerge document

Bounded documents: workspace-root, users/directory, settings/global, cases/<case-id>, workflows/<period>/<partition>, assignments/<period>/<team>, answers/<period>/<employee-id>, notifications/<period>/<audience-shard>. Rules: coherent ownership boundary; a normal employee should not load org-wide data; documents reasonably sized; high-activity areas partitioned; large immutable datasets are NOT CRDT documents.

# 8. Immutable IDs everywhere

Never use mutable usernames as storage identity. usr_/case_/req_/evt_/doc_/blob_ prefixes with UUIDv7/ULID.

# 9. Shared-folder write protocol

Three safe shapes: (9.1) immutable objects (new uniquely-named file — sealed sync batches, blobs, dataset chunks, backups, snapshots, exports); (9.2) single-writer files (sync/writers/usr_123/session_ABC/current-head); (9.3) CRDT documents for logically multi-writer state. Avoid app-wide manual CAS loops.

# 10. SharedFolderSyncAdapter

Custom browser-side adapter: discover newly committed sync material; read new Automerge changes; feed into documents; convert local changes into shared-folder sync batches; track only disposable cursors; reconstruct from share with empty browser profile; never depend on a global mutable lock file. Core infrastructure with dedicated tests.

# 11. Sync shape

workspace/ { bootstrap/ (workspace.json, schema.json), sync/00..ff (hash documentId → shard), datasets/, blobs/, backup/, diagnostics/ }. Within a shard: sync/7a/doc_019XYZ/ { snapshot/, writers/, sealed/ }.

# 12. File-count vs bandwidth

Neither one-file-per-mutation nor one giant rewritten file. Batch: flush at 5–15s of active work OR 32–128 KB OR workflow-required immediate durability. Benchmark on real SMB.

# 13. Single-writer bounded segments

One writer → one active bounded segment → rotate/seal at 128–512 KB (candidate: 256 KB target, 1 MB hard max; rotate on size/session close/time boundary). Sealed segments immutable forever. Benchmark 64/128/256/512 KB.

# 14. Realtime sync

Fast path: FileSystemObserver (experimental, non-standard, Chromium-limited — acceleration only, never correctness). Correctness path: targeted polling of user's subscriptions only (employee: assignments partition, open cases, own requests/notifications; supervisor: team partitions, approval queues; admin: broader/coarser). Cadence: active 5–10s; idle 15–30s; background 30–60s; observer event → immediate targeted check.

# 15. Avoid "everyone watches everything"

Subscription map { partitionId, reason: assignment|team|open-record|notification }; role/navigation changes update the set.

# 16. Cheap discovery

Answer "has anything relevant changed?" from filenames, sealed segment IDs, size, mtime where reliable, content/change hashes, small per-writer heads — without parsing full documents.

# 17. Browser caches

Use IndexedDB aggressively for speed (snapshots, cursors, chunk cache, derived indexes, remembered handle) — never for correctness/durability.

# 18–19. Startup flows

Normal: load remembered handle → query/request permission → validate workspace ID → load cache → targeted reconcile → ready. After wipe: Connect Workspace → select folder → validate bootstrap → load role/user bootstrap → load only required documents → rebuild caches in background → ready. Routine supported condition, not disaster recovery.

# 20. Bootstrap

Tiny workspace.json: { format, workspaceId, schemaVersion, createdAt, rootDocumentId, syncProtocolVersion }. Rarely modified.

# 21–22. Large datasets

XQAP measured ~1,000,805,318 → 44,120,740 bytes (22.7×) with columnar+gzip. New imports: normalize → partition → columnar/binary encode → compress → immutable chunks. datasets/ds_.../{manifest.json, chunks/NN.bin.gz}. Manifest: schema, partition map, row count, chunk hashes, compression, created time, source identity. Read only required chunks. On-disk chunk size independent of UI page size.

# 23. Compression

CompressionStream/DecompressionStream; start with gzip. Don't prematurely stack Automerge+CBOR+zstd+gzip. Compress datasets/snapshots/backups/large batches where measured. Benchmark bytes, CPU, transfer, end-to-end.

# 24. Blobs

Content-addressed: blobs/ab/abcdef...bin; reference { hash: sha256, size, mime }. No overwrite races, verification, dedup, idempotent retries, simple backups.

# 25. Derived data stays out of the share

Search/sort/dashboard/counts in memory/IndexedDB, rebuildable. Shared derived projections only when construction cost justifies invalidation complexity. XQAP showed shared derived caches become correctness liabilities.

# 26. Technical vs business conflicts

CRDTs merge technical conflicts (A changes priority + B adds comment). A approves + B rejects is a business conflict: model as append-only decisions [{ id, actorId, decision, time }] with derived effective decision by explicit rules.

# 27. Facts/events where transitions matter

Events for approvals, assignments, reassignment, submission, reopening, audit evidence, irreversible transitions (CaseCreated, Assigned, Submitted, Approved, Reopened); current status is a projection. Do NOT event-source every preference/label.

# 28. Never trust default multi-writer file behavior

Prevent shared mutable writer collision structurally: immutable filenames OR single-writer ownership OR CRDT merging.

# 29. Tri-state reads (mandatory)

type SharedRead<T> = { kind: "found"; value: T } | { kind: "absent" } | { kind: "failed"; error: Error }. Never T | null for authoritative shared data.

# 30. Error handling

Classify by DOMException.name: NOT_FOUND, PERMISSION, TRANSIENT_READ, TRANSIENT_WRITE, CONTENTION, INVALID_STATE, CORRUPTION, UNSUPPORTED, QUOTA/CAPACITY, UNKNOWN. Log error.name, operation, resource, browser version, timestamp, user ID, retry count, payload size, share latency. No sensitive payloads.

# 31. Retry policy

Centralized retry(operation, policy); policies distinguish existence probe / post-write verification / transient read / contention / permission / corruption; jitter; never retry logic/schema errors.

# 32. Integrity

Immutable files: hash reference + verify bytes. Snapshots/manifests: schema version, content hash, size, createdAt. Critical finalization: stage → close → read back → verify → publish reference. Simplification vs XQAP: new immutable objects usually need no .bak rollback because they replace nothing.

# 33. Backups

Back up bootstrap, sync authoritative data, datasets, blobs, config, audit. Not IndexedDB/OPFS/derived/temp. Manifest + completion sentinel; successful only after verification.

# 34–35. Packaging & workers

dist/index.html contains HTML/CSS/JS/runtime/Automerge JS+WASM base64/fonts/worker code as Blob strings/icons. Source stays modular TS; single file is a build artifact. Workers via Blob URLs; stream bounded chunks, never one enormous structured-clone result.

# 36. What NOT to use as shared database

No shared SQLite on SMB; no giant master.json; no localStorage business data; no OPFS/IndexedDB as authority.

# 37. Security model

Static HTML + raw folder access → browser app is not a strong security boundary. Real security: Windows/SMB ACLs, share permissions, read/write directory design, organizational controls, audit logging, integrity checks. Document honestly from day one.

# 38. ACLs

Where allowed: public-read/, user-write/, admin-write/, immutable/ areas. ACLs are coarse boundaries; app model is workflow-level authorization; don't make workflows constantly modify Windows permissions.

# 39. Freshness UI

"Synced 4s ago"; states LIVE / SYNCING / LOCAL_PENDING / WORKSPACE_UNAVAILABLE / RECONNECT_REQUIRED / ERROR.

# 40. Sync SLOs (product targets)

Foreground active: UI < 100ms; small commit < 2s median; others observe < 10s target; p95 < 30s; normal max < 60s. Transient failure → auto retry; unavailable → visible state; wipe → reconnect+rebuild; no silent loss.

# 41–42. Capacity & benchmarks

No spec'd user/file/GB limits — deployment-specific (SMB server, network, AV/DLP, browser, endpoint, files/dir, batch size, writer rate, cadence, dataset sizes). Simulate 10/50/100/250/500/1000 clients; measure writes/s, sync bytes/s, listings/s, latencies, observer/polling/propagation latency, error/retry rates, CPU, memory, files/hour, growth/day; normal + burst.

# 43. Failure-injection tests (mandatory)

1 same-record different fields; 2 same field; 3 SMB loss mid-write; 4 browser close mid-write; 5 close with unsynced changes; 6 site data cleared; 7 permission revoked; 8 file vanishes between list and open; 9 file changes between getFile() and read; 10 100+ concurrent writers; 11 added latency; 12 duplicate batch replay; 13 out-of-order batch; 14 truncated segment; 15 corrupt snapshot + valid history; 16 identity renamed; 17 role change while open; 18 old build/new schema; 19 new build/old workspace; 20 observer silent, polling-only recovery.

# 44. Browser-data-clear acceptance test

Use normally → confirmed shared changes → close → clear all site data → reopen → disconnected state → select workspace → verify ID → sign in → all authoritative data reconstructed → nothing missing → caches rebuild without modifying business data.

# 45–47. Code architecture

src/{domain,data{automerge,datasets,blobs,cache,repositories},sync{SharedFolderSyncAdapter,discovery,subscriptions,segments,retry,integrity},filesystem{workspace,permissions,reads,writes,errors},workers,auth,ui}. No React component touches a FileSystemFileHandle. Repository interface: get/subscribe/update returning CommitResult = workspace_committed | local_pending | failed. Workflows requiring durability demand workspace_committed.

# 48. Reconciliation

Fast targeted discovery frequently + slow scoped reconciliation (every few minutes, role-specific, verify known heads/segments). Never full-tree scans from every employee.

# 49. GC/compaction

Plan from day one: never delete history a live client may need without a safe snapshot; admin-controlled or deterministically safe; per document/partition; backup before destructive compaction; stale client bootstraps from snapshot + newer changes. Prefer Automerge's own storage model over inventing an independent revision/fold system.

# 50. Upgrades

appVersion ≠ workspaceSchemaVersion; track syncProtocolVersion, documentSchemaVersion, datasetSchemaVersion. Fail clearly on unsupported future schema; no silent multi-GB startup migrations; prefer backward readers + explicit migration tools.

# 51. Final stack

One static HTML; React+TS; Vite dev-only; Automerge (+Repo or thin domain repo); base64 WASM; File System Access API; FileSystemObserver accel; targeted polling; IndexedDB cache-only; partitioned columnar datasets; gzip first; SHA-256 blobs; UUIDv7/ULID; Blob workers; sharded subscription-scoped discovery; immutable/single-writer writes; centralized DOMException classification; Windows ACLs + advisory client permissions.

# 52. Carry forward from XQAP

found/absent/unreadable tri-state; per-writer ownership; immutable event/fact history where order/audit matters; partitioning+compression for large read-mostly data; Web Workers; stream not clone; immutable IDs; deterministic algorithms; derived data not authoritative; real-volume benchmarks; fresh ownership validation before business decisions; error .name; observer/cache freshness never replaces authoritative reconciliation.

# 53. Do NOT carry forward

One JSON per feature; mutable giant JSON; username-keyed filenames; feature-specific CAS/retry; dozens of .bak/.tmp protocols for operational state; global shared state files; per-event tiny files at volume; shared derived caches; whole-workspace loading/polling; last-writer-wins; browser cache as authority; local-disk timing assumptions on SMB.

# 54. Phases

Phase 0 environment proof (secure context, picker, UNC read/write, read-after-write, 100 parallel ops, observer, 5s polling, data-clear reconnect, single-file Automerge WASM init) — do not proceed until passing. Phase 1 storage kernel (bootstrap, tri-state reads, centralized errors, immutable write helper, hashes, IDs, retry, reconnect, cleanup recovery). Phase 2 Automerge document kernel (partition rules, cache handling, serialization, snapshot, shared sync representation, duplicate/out-of-order determinism). Phase 3 sync engine (adapter, subscriptions, targeted polling, observer accel, batching/segments, backpressure, status UI). Phase 4 large datasets (schema, partitioning, columnar, gzip, manifest, worker parsing, chunk cache). Phase 5 scale test 50→100→250→500+ before building the full product; tune poll interval/segment size/shard count/batch interval/cache size. Phase 6 business development on repository APIs only after kernel is stable.

# 55–56. Non-negotiable rules

1 Static HTML is deployment format only — source stays modular. 2 Shared folder authoritative. 3 No committed business data only in browser storage. 4 Reconnect after wipe. 5 Never one giant shared mutable file. 6 Prefer immutable/single-writer physically. 7 Automerge for logical multi-writer state. 8 Partitioned compressed large datasets. 9 Content-addressed blobs. 10 Poll only subscriptions. 11 Observer is accelerator only. 12 Read failure ≠ absence. 13 Immutable IDs, never usernames. 14 Derived indexes disposable. 15 Benchmark on the actual SMB environment before claiming scale.

# Sources cited by the proposal

MDN File System API / showDirectoryPicker / FileSystemDirectoryHandle / FileSystemFileHandle / FileSystemObserver / Secure Contexts; W3C Secure Contexts; Chrome Developers File System Access + persistent permissions + File System Observer origin trial; Automerge docs (local sync, network sync, concepts, repositories, storage internals, library initialization).
