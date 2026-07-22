# Large-Population Performance — Architecture Proposal

**Date:** 2026-07-22 · **Status:** proposed; implementation requires owner approval
**Scope:** populations above 200,000 rows per month, including workspaces already observed above 400,000 rows
**Decision order:** Phase A → Phase B → Phase C → Phase D. Phase A is independently shippable.

## 1. Decision summary

The application should not keep an arbitrary global total of 100 or 1,000 rows in memory. It should:

1. load no heavy business dataset at startup;
2. load data only for the active, authorized workflow;
3. return visible pages rather than complete arrays to React;
4. store the processed population as port-partitioned, envelope-wrapped files;
5. retain only a bounded number of partitions in an in-memory LRU cache; and
6. use IndexedDB only as an optional acceleration cache, never as the source of truth.

The user-selected workspace remains the portable, auditable source of truth. Role-aware loading is a resource-control and privacy-minimization measure, not a stronger security boundary; the advisory client-side authorization posture in `SECURITY_MODEL.md` remains unchanged.

## 2. Current state and cause

### Before

- `PopulationTab` defaults to the processing sub-tab and reacts to the global month by calling `loadMonthForEditing()`.
- `loadMonthForEditing()` concurrently reads and parses the manifest, `population.final.json`, `processing.summary.json`, both raw datasets, and the sample.
- Population is the first allowed top-level tab for an employee. An employee can therefore pay the processed/raw loading cost despite having no processing capability and normally needing only their sample and answer files.
- `safeReadJson()` obtains the complete file text and calls `JSON.parse()`. A 100-row table page does not prevent the complete 200,000-row object graph from being created.
- Browse keeps all rows in React state, derives search/filter results across the complete array, and slices the visible page last.
- Excel reading already runs in a worker, but the complete parsed workbook result is structured-cloned back to the main thread. Population processing then creates additional full-sized arrays.

### After all four phases

- Workspace connection loads identity, permissions, month metadata, manifests, summaries, and the signed-in employee's small files only.
- The active screen requests a dataset through a paged repository contract.
- React holds the visible page and a small lookahead, not the complete population.
- Processed rows live in immutable-at-revision, port-partitioned files of approximately 10,000 rows each. A verified index identifies the committed set.
- Workers parse legacy monoliths, search partitions, process imports, run sampling jobs, and aggregate reports without posting complete populations to React.
- An LRU cache retains a bounded number of verified partitions and evicts by a byte budget as well as an entry limit.

## 3. Target read model

The UI should consume a repository API rather than workspace filenames directly:

```ts
type PopulationQuery = {
  monthFolderName: string;
  offset: number;
  limit: number;
  search?: string;
  filters?: Record<string, string[]>;
  sort?: { column: string; direction: "asc" | "desc" };
};

type PopulationPage<T> = {
  rows: T[];
  totalRows: number;
  revision: number;
  contentHash: string;
  nextOffset: number | null;
};
```

Page size is a UI decision, normally around 100 rows. Partition size is a storage decision, initially around 10,000 rows and subject to measurement. Cache capacity is a memory-budget decision. These three units must not be conflated.

## 4. Phase A — demand and capability gating

**Goal:** remove the reported employee startup freeze without changing the workspace schema.

### Before

- Selecting an existing month triggers the all-in-one edit loader.
- The loader cannot express that a screen needs only a summary, sample, distribution, or one raw source.
- Raw imports are reconstructed into workbook-shaped React state during historical month loading.

### After

- Replace the unconditional edit load with focused operations such as:

```ts
loadMonthMetadata()
loadProcessingSummary()
loadPopulationFinalLegacy()
loadRawDataset("risk" | "bi")
loadSampleState()
loadDistributionState()
```

- Gate calls by active tab/sub-tab, active phase, and capability.
- Employee landing loads the manifest/summary needed for chrome plus that employee's sample and answers. It does not load population or raw rows.
- Population Browse requests processed data only after the user opens Browse.
- Raw risk/BI rows load only for an explicit reprocessing or detailed accuracy workflow.
- Phase 2 summary uses `processing.summary.json`; Phase 3 requests population only for an actual draw; Phase 4 uses sample and distribution data.
- Prefer Employee Workspace as the employee landing surface, while preserving explicitly granted Population Browse access.

### Effort estimate

**2–4 engineering days**, including loader characterization tests, role/capability tests, month-switch race tests, and a 200k-row startup benchmark. This estimate excludes unrelated Population UI refactoring.

### Migration and rollback

- No disk migration.
- Existing files and readers remain valid.
- Rollback is a code rollback to the prior eager loader.
- A temporary release flag may retain the eager path for diagnosis, but it must default off once acceptance tests pass.

### Acceptance criteria

- Employee workspace entry performs no read of `population.final.json`, `risk.raw.json`, or `bi.raw.json`.
- Entering Phase 4 does not read raw or processed population files when sample/distribution state is already available.
- Month switching cannot commit stale results from a superseded request.
- Existing corruption handling continues to fail explicitly rather than treating governance files as empty.

## 5. Phase B — worker-owned legacy parsing and paging

**Goal:** keep large legacy `JSON.parse`, search, and filter work off the main thread before the durable format changes.

### Before

- `safeReadJson()` reads and parses a monolithic population on the UI thread.
- Moving parsing to a worker but posting the complete array back would reproduce the freeze through structured cloning and main-thread allocation.

### After

- A dataset worker owns the parsed legacy array for the lifetime of the active query session.
- The main thread sends query messages and receives only the visible page plus a small lookahead.
- Search/filter/sort execute in the worker. React stores page results and metadata only.
- Closing the data-heavy tab, switching workspace, changing role, or invalidating the source revision terminates the worker and releases its dataset.
- Request IDs and source revision/hash prevent stale worker responses from overwriting a newer month or query.

Phase B improves responsiveness and main-thread memory, but it does not yet bound total memory: a worker still parses one complete legacy monolith. Phase C supplies that bound.

### Effort estimate

**4–7 engineering days**, including the worker protocol, cancellation/stale-response tests, legacy corruption propagation, page/lookahead behavior, and performance instrumentation.

### Migration and rollback

- No disk migration.
- The existing main-thread reader can remain behind a diagnostic fallback during the phase's release.
- Rollback selects the old query executor; workspace files are unaffected.

### Acceptance criteria

- No complete population array crosses `postMessage()` into the window.
- Paging, search, filter, and sort produce characterized results equivalent to the current Browse behavior.
- The main thread remains interactive during a 200k-row legacy parse and query.
- Worker termination releases the active dataset when its consumer unmounts or loses permission.

## 6. Phase C — port-partitioned durable population storage

**Goal:** bound total reads and make browse/sampling access proportional to the required strata.

### Before

```text
1-population/{month}/2-processed/
  population.final.json
  processing.summary.json
```

Every processed-population read parses the complete monolith.

### After

```text
1-population/{month}/2-processed/
  population.final.json                 # retained compatibility copy during transition
  population.final/
    index.json
    part-000000.json
    part-000001.json
    part-000002.json
  processing.summary.json
```

Rows are partitioned first by normalized `portName`, then divided into parts of approximately 10,000 rows. Filenames remain numeric/safe; the index carries the port/stratum identity.

Every part and `index.json` must be a `JsonEnvelope`. A representative index data shape is:

```ts
type PopulationPartDescriptor = {
  partId: string;
  fileName: string;
  portName: string;
  rowCount: number;
  firstOrdinal: number;
  contentHash: string;
};

type PopulationPartitionIndex = {
  formatVersion: 2;
  datasetRevision: number;
  totalRows: number;
  sourceLegacyRevision: number | null;
  sourceLegacyContentHash: string | null;
  countsByPort: Record<string, number>;
  countsByPortStage: Record<string, Record<string, number>>;
  spilloverCapacityByPort: Record<string, number>;
  parts: PopulationPartDescriptor[];
};
```

The exact index fields must be derived from the existing sampling/report requirements and characterized before implementation. Index metadata must be sufficient for Hamilton allocation and capacity planning without reading row files.

### Commit and concurrency protocol

1. Acquire the existing workspace/file coordination mechanisms.
2. Write and verify every part through `safeWriteJson`.
3. Write and verify `index.json` last. The index is the commit point.
4. Readers use only parts referenced by a verified index and verify each part's envelope hash against its descriptor.
5. Unreferenced parts from an interrupted write are ignored and may be cleaned only by a separate validated maintenance operation.

Index-last makes a single commit crash-safe; it does not solve two-device concurrent ordering. Two writers can still race on `index.json`. Exactly ordered multi-device writes require a backend and remain outside the product's guarantees.

### Reader compatibility

```text
verified population.final/index.json exists → partition reader
otherwise                                   → legacy population.final.json reader
```

The first release that writes partitions must retain a current legacy monolith as a rollback/compatibility copy. It must not delete the monolith. A later decision to stop maintaining that copy requires proof that all consumers and supported rollback versions understand partitions.

### Bounded LRU

- Key: `(workspace path, dataset revision, part contentHash)`.
- Limit by both part count and estimated bytes; begin with a conservative measured budget rather than a fixed row promise.
- Invalidate by construction when revision or content hash changes.
- Keep active page and lookahead partitions pinned only while their query is active.
- Clear on workspace disconnect and release role-inappropriate entries on role/session changes.

### Backup coordination requirement

Partition support cannot ship until backup, restore, validation, and audit inventory copy `index.json` plus every referenced part and reject incomplete sets. Backup work is changing independently because large SheetJS backup exports have their own memory pressure; the two changes must be sequenced rather than editing backup code concurrently.

### Effort estimate

**10–18 engineering days** for storage/index types, safe writer/reader, LRU, legacy fallback, migration UI/service, backup/restore integration, corruption tests, crash-point tests, and performance fixtures. The estimate may split into separate reader/migration and writer releases.

### Migration

Migration must follow workspace rules:

1. detect legacy state read-only;
2. produce a dry-run plan and space estimate;
3. require a verified backup;
4. read the legacy monolith once;
5. write envelope-wrapped parts;
6. validate row count, stable identifiers, per-port counts, and content hashes;
7. commit `index.json` last;
8. re-open through the partition reader and validate again; and
9. retain the legacy file.

The operation is idempotent: an index tied to the same legacy revision/content hash is already migrated; a mismatched source produces a new staged set rather than silently reusing stale parts.

### Rollback

- Code rollback ignores `population.final/` and reads the retained monolith.
- A failed pre-index migration leaves only ignored, uncommitted parts.
- A failed post-index validation removes or quarantines the new index through an explicit recovery operation; it never deletes the legacy file.
- Restoring a backup restores both representations as one validated dataset set.

### Acceptance criteria

- Opening the first Browse page reads metadata and only the required part(s).
- A missing, corrupt, hash-mismatched, or unreferenced part is never interpreted as empty population data.
- Sampling allocation counts can be computed from the index without reading every row.
- Peak memory is bounded by the worker/query budget rather than total population size for Browse.

## 7. Phase D — streaming whole-population consumers and import output

**Goal:** remove remaining full-array requirements from processing, sampling orchestration, reports, and exports while preserving domain behavior.

### Before

- Workbook parsing returns complete normalized arrays to the main thread.
- Population processing accumulates prepared, removed, duplicate, and invalid arrays before saving.
- `drawSample()` receives the complete processed population.
- Reports and backup/export paths may materialize complete datasets or workbooks.

### After

- The processing worker emits processed rows in batches directly to staged part writers and returns progress/summary metadata, not the full prepared population.
- Hamilton apportionment and spillover capacity use verified index counts.
- The sampling worker reads only target port partitions and returns the final sample. The existing `SAMPLING_ALGORITHM_VERSION` and exact seeded behavior remain stable unless a separately approved semantic migration bumps the version.
- Reports and executive-deck model builders scan parts sequentially in workers and aggregate incrementally.
- Full-row exports stream/append partition data where the output library permits. SheetJS-specific memory ceilings must be handled by the coordinated backup/export design rather than hidden behind UI pagination.
- Detailed removed/duplicate/invalid processing records are also partitioned or stored as bounded diagnostic artifacts; they must not become a replacement monolith.

### Effort estimate

**12–22 engineering days**, likely delivered as separate processing, sampling, and reporting/export increments. Deterministic sampling characterization and export-format constraints are the largest uncertainty.

### Migration and rollback

- Phase D does not require a new population format beyond Phase C, but each consumer moves behind the same repository/index abstraction independently.
- Until all consumers move, the compatibility monolith remains available to old consumers.
- Each converted consumer keeps its old implementation selectable for a short compatibility window and is verified against fixture outputs.
- Sampling rollback must not change historical sample interpretation or algorithm version.

### Acceptance criteria

- Import processing does not retain or post a complete prepared population in React/window memory.
- Sampling for a fixed fixture and seed matches the characterized current output byte-for-byte unless an explicit algorithm-version migration is approved.
- Report totals, breakdowns, and source-revision lineage match legacy outputs.
- Every worker job supports cancellation, progress, stale-result rejection, and explicit corruption failure.

## 8. IndexedDB decision

IndexedDB is deferred and optional.

- It may cache verified indexes or hot partitions after measurement shows repeated File System Access reads are still material.
- It is never authoritative: it is per-browser/per-origin, evictable, invisible to workspace backup/audit, and not portable across machines.
- Entries must be keyed by workspace identity/path plus content hash. A hash change creates a different key, making stale reuse impossible by construction.
- The partition LRU may make IndexedDB unnecessary. Measure Phase C before adding a second cache layer.
- Cached business rows must not survive workspace/session boundaries without an explicit lifecycle policy, even though client authorization remains advisory.

## 9. Performance and correctness gates

Create repeatable fixtures at 200k and at least 400k rows. Record before/after values for:

- time from workspace ready to employee workspace usable;
- heavy files read during employee startup;
- longest main-thread task;
- first Browse page latency;
- search/filter latency;
- peak main-window and worker memory where browser instrumentation permits;
- partition-cache hit/miss and eviction counts;
- sampling duration and deterministic-output equivalence;
- report/export duration and output equivalence; and
- migration/backup duration and required free disk space.

Release gates include focused storage/worker tests, complete Vitest, strict typecheck, lint, complexity, build, bundle-size, release consistency, and vendor-integrity checks per `docs/product/RELEASE_CHECKLIST.md`.

## 10. Recommended release order

| Order | Deliverable | User-visible result | Schema impact |
|---:|---|---|---|
| 1 | Phase A | Employees stop loading population/raw processing data; faster startup | None |
| 2 | Phase B | Legacy large-data browse stays responsive | None |
| 3 | Phase C | Bounded partition reads and cache; scalable durable format | Additive, migration available |
| 4 | Phase D | Bounded import/consumer pipelines and worker-based aggregation | Uses Phase C format |

Do not combine Phase C with unrelated refactors. Phase A should ship and be measured independently before the storage migration begins.

## 11. Approval decisions required before implementation

1. Approve Phase A as the first isolated implementation.
2. Confirm the initial memory/cache budget and benchmark machines after measurement scaffolding exists.
3. Confirm whether the first Phase C writer must maintain a current legacy monolith for more than one release.
4. Sequence Phase C with the active backup redesign so partition sets are backed up atomically at the logical level.
5. Approve any sampling semantic change separately; this proposal assumes none.
