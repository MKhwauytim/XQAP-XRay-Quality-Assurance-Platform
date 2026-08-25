# Application Architecture & Delivery Plan — New Shared-Folder App

**Role:** application architecture above the data/sync kernel. Assumes the kernel exposes repository APIs over a shared-folder-authoritative store with tri-state reads and typed commit results. Grounded in XQAP's nine-week production history; version numbers cite `docs/architecture/DATA_ARCHITECTURE_AND_LESSONS_LEARNED_2026-08-25.md`.

## 0. Position statement (where I disagree with the proposal)

The proposal's storage diagnosis is right and adopted wholesale: design out contention (immutable / single-writer / merged), immutable IDs, four data classes, disposable browser caches, targeted subscriptions, tri-state reads. **I reject "Automerge as settled architecture."** Four reasons, each independently corroborated by the research: (1) no FSA/SMB adapter exists for any CRDT library — the `SharedFolderSyncAdapter` is 100% new code of exactly the kind that was XQAP's most bug-prone module (distribution event store + fold + checkpoint); (2) the decisions that matter in this domain (approve/reject, assign/replace) are ones we *want* blocked by fresh re-reads (v90.0, v98.4/98.5), not silently merged — the proposal itself falls back to append-only decision events for these, i.e. XQAP's model; (3) ~320KB-gzip WASM base64-inlined adds >1MB *raw*, and raw bytes are what `file://` users wait on (the v123.2 correction — a wrong assumption held for months); (4) binary opacity kills the grep-based forensics that closed v90.0's corruption incident. **Decision: the application layer is designed to be kernel-agnostic behind the repository contract below, my recommendation into the Phase 2 bake-off is XQAP-style typed per-writer append-only segments + rebuildable projections, and if the bake-off demands a CRDT for genuinely co-edited documents, Yjs (18KB, pure JS, categorical idempotency/commutativity guarantees) is the candidate — not Automerge.** Everything below works unchanged whichever way the bake-off lands; that is the point of the contract.

---

## 1. Domain/application layering

### 1.1 Repository contract

Every feature talks to storage through repositories; no React component ever sees a `FileSystemFileHandle` (proposal §45, adopted). The interface, fixed now so the kernel and app teams can build in parallel:

```ts
type ReadResult<T> =
  | { kind: "found"; value: T; meta: { revision: Revision; epoch: number } }
  | { kind: "absent" }                    // proven absent — every location examined
  | { kind: "unreadable"; error: TypedStorageError }; // NEVER collapsed into absent

interface Repository<T, E extends DomainEvent> {
  get(id: Id): Promise<ReadResult<T>>;
  query(scope: Scope): Promise<ReadResult<readonly T[]>>;
  subscribe(scope: Scope, cb: (snap: Snapshot<T>) => void): Unsubscribe;
  mutate(id: Id, decide: DecideFn<T, E>): Promise<CommitResult>;
}

type DecideFn<T, E> = (fresh: FreshState<T>) => 
  | { commit: E | E[] }        // events, not patched state
  | { reject: DomainRejection }; // typed, user-presentable

type CommitResult =
  | { kind: "workspace_committed"; revision: Revision }
  | { kind: "local_pending"; flushId: string }   // visibly flagged in UI
  | { kind: "rejected"; reason: DomainRejection } // decide() said no on fresh state
  | { kind: "failed"; error: TypedStorageError };
```

**`mutate(id, decide)` is the single most important structural decision in this document.** XQAP's most repeated, most damaging bug class — acting on stale ownership state before a durable write — was rediscovered at least five times (v43.6/43.7, v59.9/57.9, v88.0/89.1, v90.0, v98.4/98.5) and fixed the same way every time: re-read authoritative state immediately before the decision. In this design that fix is not discipline, it is **the only write API that exists**. The UI cannot pass state into a write; it can only pass a *decision function*, and the kernel invokes it with freshly-read authoritative state inside its concurrency envelope (and re-invokes it on CAS retry). A supervisor's hours-stale tab structurally cannot steal a row or regress a completed one: `decide` sees `fresh.status === "completed"` and returns `reject`. Business rules become pure `DecideFn`s — testable with zero I/O, and the terminal-state transition table (XQAP's fold guard, source of v41.28/43.12/43.13 and v98.4) lives in **one** shared module consumed by every `decide`, never re-implemented per feature.

`unreadable` never licenses a write. The kernel enforces this (a mutate against an unreadable read fails, it does not seed defaults) — this closes the v99.1 roster-wipe class (unreadable roster → default accounts durably persisted over real ones) and the v99.6 revision-42→revision-1 reseed at the API level, not per call site.

### 1.2 Identity model

- **Immutable IDs everywhere** (`usr_`, `case_`, `evt_` + ULID). IDs provide *uniqueness only*; never correctness-bearing cross-machine ordering (critique flag #3 — clock skew; XQAP's locale tie-break lesson v41.37 generalized). Ordering comes from per-writer sequence numbers (a degenerate version vector, per Research 4 §5).
- **Filenames use short hashes of IDs, never raw ULIDs/usernames** — v99.4's 260-char path incident and the 80→22-char rename. A path-length budget check is a Phase 0 probe *and* a unit test.
- **Display names are data**, one field in the user record. Rename = one field edit, orphaning nothing — the entire `usernameRenameGuard.ts` apparatus exists in XQAP only because files were keyed by username (§6.1); with ID-keyed storage it disappears.
- **The footprint guard generalizes as a registry.** Every repository that can reference a user ID registers a `footprintEnumerator(userId)` at module definition. The deletion guard is the union over the registry — a new store cannot be forgotten (the v99.10/114.2 ad-hoc blind spot becomes impossible to reintroduce silently). **Fails closed**: any enumerator returning `unreadable` blocks deletion, exactly like `usernameRenameGuard`.
- **Storage key ≠ actor.** `onBehalfOf` carried as a narrow, stripped-elsewhere field (XQAP §5's `answeredOnBehalfBy`), never overloading the key. Actor tagging is wired into *both* login and session-restore paths from day one (v123.1: restored sessions logged blank actors for weeks).

---

## 2. UI architecture

React 19 + React Compiler (as XQAP — it de-risked decomposing large components there).

### 2.1 State: `useSyncExternalStore` over repository subscriptions, with an epoch

No Redux/Zustand. Repositories are the external stores; a thin `useRepo(scope)` hook wraps `subscribe` + `useSyncExternalStore`. The v59.190–197 saga (five review rounds, one feature, every fix caught by review not tests) is the design input here, and its final lessons become the *initial* design:

- **Generation counter, not key comparison.** A single app-wide `epoch`, incremented **synchronously inside the reset function** on login/logout/workspace-switch/role-preview — never derived from session-key string equality, which fails when React re-renders multiple times within one commit before any effect runs (v59.195's second bug). Every snapshot a store publishes carries the epoch it was produced under.
- **Snapshot and identity read atomically.** `useSyncExternalStore`'s `getSnapshot` returns `{epoch, data}` as one object; a component seeing `snapshot.epoch !== currentEpoch()` renders the neutral/loading state. This closes v59.191 (subscribe-after-publish loss — `useSyncExternalStore` subscribes before paint by contract) and v59.192/59.196 (stale-data-at-matching-key latches) structurally.
- **Boot gating**: a boot-source registry (XQAP's `bootProgress` shape), children mounted under the overlay so their effects register sources; minimum-visible-time floor from day one (v59.195); an errored source never blocks `allLoaded`. Hydration-complete flags gate *decisions* (clear a session, render the shell), never reads (v59.11, v59.132/59.163).
- **Refresh never clobbers drafts** (XQAP's `dataRefreshSignal` hard rule): subscription updates deliver into repository snapshots; form draft state lives in component/`useReducer` state keyed by record ID + epoch, merged explicitly, and silent refresh swaps rows in place with no spinner (v70.0).

### 2.2 Tab preservation — the structural fix, once

XQAP rediscovered the hidden-tab bug four times (§9.2 mount-preservation cluster), each needing the same two-part fix. The new app makes it a shell invariant:

1. The tab host renders each mounted tab as a **memoized element created once per (tabId, epoch)** and cached; visibility is CSS (`content-visibility: hidden` container), LRU-capped like XQAP's mount cache.
2. **Tab components accept zero changing props.** Everything they need arrives via `useRepo`/context subscriptions. With stable element identity and no props, React bails out of hidden subtrees by identity; parent shell churn cannot reach them.
3. A **standing adversarial test** in the shell suite: mount two tabs, hide one, churn shell state 100×, assert the hidden tab's render counter did not move. This is the test XQAP never had, which is why the bug shipped four times.

### 2.3 Labels, RTL

Adopt `labelsStore` unchanged: `DEFAULT_LABELS` + `localStorage` overrides + `getLabels()`/`useLabels()`; hard-coded Arabic is a lint error, not a convention. Two upgrades: **namespaced storage keys** (`{appId}_labels_v1`) because all `file://` pages share one Chromium origin (Research 2's new finding — XQAP's `xray_` prefix was informal; make it a rule with a lint check), and label keys carried in the error-code catalog so every `XQ-`-style code (v92.0's ~86-code catalog, adopted day one) has an Arabic string. RTL-first: `dir="rtl"` at root, logical CSS properties only (lint-enforced), `@tanstack/react-virtual` (react-window's RTL gap is documented, v-table decision carried forward).

---

## 3. Workers architecture

**What runs where:** Workers get Excel/import parsing, dataset chunk encode/compress/decode, dataset query/paging (XQAP Phase B shape), and streaming hashes (hash-wasm incremental SHA-256 per Research 3 — never one-shot `crypto.subtle.digest` on large blobs). Report builders stay **main-thread chunked via `yieldToMain()`** as in XQAP — they touch too much app state to marshal cheaply, and the chunked-async conversion is proven (v59.94–102) — with the known corollary enforced: any module-level state a now-async builder touches gets a promise-chain mutex (reentrancy, §5 of lessons doc).

**Message protocol — fixed rules, not per-worker choices:**

1. **Bounded chunk streaming, never one giant result.** Structured clone materializes the whole payload as one contiguous allocation; v117.7/117.8's OOM at ~500k rows is the proof. Every result-bearing message is `{requestId, lane, seq, done, chunk}` with a bounded chunk size; worker frees each batch after posting.
2. **Per-lane staleness.** Every request stream (load / table / filter-preview / export…) owns its own monotonic token; a reply is dropped iff *its own lane* has a newer token. One shared "latest wins" counter across lanes was v59.189's critical bug — Browse showed "no data" over a correctly loaded month.
3. **Silence watchdog + error handlers on every worker** (v97.2): `onerror`/`onmessageerror` wired, plus a generously-sized per-request watchdog (legitimate parses exceed a minute) that terminates and recreates a presumed-dead worker and rejects pending promises with a typed error. A hung promise is worse than a wrong error.
4. **Error-recovery must work on the Nth load, not just the first** — v59.189's follow-up bug (failed subsequent load left the previous month cached and queryable) becomes a standing test case.
5. **Workers are bundled inline** (`?worker&inline` → Blob URL) — confirmed working under `file://` (Research 2). WASM, if any, embedded and instantiated via `WebAssembly.instantiate(bytes)`, never `instantiateStreaming` (no reliable MIME under `file://`).

---

## 4. Testing strategy

**4.1 Memory-FS double with fault injection, day one.** XQAP's `createMemoryDirectory()` plus everything it learned it was missing: **permission simulation** (v58.1: the double hardcoded "granted," making a whole regression class — six write paths bypassing the deferred-permission boundary — untestable), per-path **fault schedules** (`failNthRead(path, n, "NotReadableError")`, `tornWrite(path)`, injected latency), and mid-enumeration mutation (v41.4's backup-abort shape, v77.0's vanished-entry shape). Every DOMException the classifier knows must be raisable by the double — including `InvalidStateError`, which none of XQAP's six retry loops recognized (v123.0).

**4.2 I/O-count assertions as first-class.** The double counts opens/reads/writes/enumerations per logical operation; core flows carry budget assertions (`expect(fs.stats.reads).toBeLessThan(N)`). This is the only test shape that catches v59.137's "re-scans the whole directory while appearing correct from return values" and would have caught v61.0's 192,063-ops disaster before production. Budgets are exact-ish, not generous — a budget with slack is not a signal (meta-lesson 6).

**4.3 Adversarial-ordering tests for every async identity transition.** Meta-lesson 4 verbatim: every timing bug passed its own tests because tests constructed the safe ordering. Required per transition (login, restore, workspace switch, role-preview, epoch bump): at least one test that publishes *before* subscribe, resets *mid-render*, and delivers a stale-epoch snapshot after the new epoch — asserting neutral rendering, no latch, no clobber.

**4.4 Golden snapshots with the traps pre-sprung.** Deterministic builders (sampling-equivalents, folds, report HTML) get byte-exact goldens. Day-one repo config: `.gitattributes` marking snapshot files `-text` (the CRLF Windows-capture/Linux-CI divergence, v59.94–102) and a **mandatory injected clock** — no builder may call `Date.now()`/`new Date()` directly (lint rule); the frozen-Date snapshot that passed only because CI ran on capture day is the cautionary tale.

**4.5 Real concurrency interleaving.** CAS/lease/mutate tests run genuine `Promise.all` races with injected scheduling jitter, not sequential awaits. **The fake-timer/CAS trap (v117.13) becomes a written rule:** `vi.useFakeTimers()` is banned in any test exercising CAS delayed re-verify, lease heartbeats, or retry ladders — fake timers either deadlock the jittered sleep or trivially collapse the race window the test exists to exercise. Instead, delays are injected as parameters and shortened to real 1–5ms sleeps.

**4.6 Failure-injection suite (proposal §43) mapped to harness.** Scenarios 1–5, 8, 9, 12–16, 20 run in CI against the memory double (fault schedules above). Scenarios 6–7 (site-data clear, permission revoke) run as scripted manual/Playwright passes against real Chromium. Scenarios 3, 10, 11 (SMB loss, 100 writers, added latency) belong to Phase 0/5 against the real share — CI cannot honestly simulate SMB.

---

## 5. Quality gates & process

**Keep from XQAP (proven, cheap):** the generated edit-log discipline (`editlog.mjs`-style, tiered); the tier ladder itself — tier-3 sweeps as release gates only; `check:release` version consistency; vendored-dependency SHA check; complexity budget; **the per-PR bundle-size delta CI job as the real guard, with the ceiling as permission-not-target** (v123.2: 26MB of headroom cannot catch a 200KB accident); mandatory `npm run build` + `typecheck` before any push at every tier (vitest transpiles per-file and hides type errors — documented XQAP failure class).

**Add:**
- **Snapshot-before-touch, enforced not remembered** (meta-lesson 8): deterministic modules live under a declared path set; CI fails any PR that diffs those paths without also updating the golden manifest, and the PR template requires a "goldens diffed intentionally: yes/no + why" line. Algorithm-version stamps (`SAMPLING_ALGORITHM_VERSION` pattern, plus `DERIVE_VERSION` for every fold — v41.39) exist from the first draw/fold, bumped only for approved semantic change.
- **Error-code catalog from day one** (v92.0 was retrofitted at ~week 8): append-only `XQ-`-style codes, tagged not wrapped (preserving `.name` classification), `.name` logged in every error record end-to-end (v123.0: the log never captured the one field that mattered).
- **I/O-budget suite as a CI gate** (§4.2).
- **One retry-decision helper, by construction:** the kernel owns it; app code cannot write its own retry loop (v123.0: six independently-written loops, none recognizing `InvalidStateError`). A lint rule flags `catch` blocks that inspect `.message`.
- **Reviewer rule:** any PR touching effect timing, epoch/session transitions, or the tab shell requires an independent adversarial review pass — the *only* mechanism that caught all five v59.19x rounds and all four mount-preservation recurrences.

**Drop:** hex-literal check and XQAP-specific checks unless the same problem recurs; don't cargo-cult.

---

## 6. Packaging & build

- **Vite + `vite-plugin-singlefile`**, source fully modular TS; single file is a build artifact only. Separate dev-only preview entries (XQAP's `deck-preview.html` pattern) for report builders — excluded from the production build.
- **Budget philosophy: raw bytes govern** (`file://`, no content-encoding negotiation, every byte read off the share every open). Initial ceiling **8MB raw** — deliberately tight; raises must name the feature and measured overage (XQAP doctrine). The delta job is the daily guard.
- **Fonts: subset from day one.** Arabic fonts are the largest single asset class in an app like this; subset to the used ranges (Arabic + Latin + digits), base64-inlined (generated reports are offline too — XQAP v38.4). Budget fonts as a named line item in the delta report.
- **WASM:** only what the kernel justifies. hash-wasm (small, proven in XQAP) is pre-approved. A CRDT WASM payload (~1.3MB+ raw once base64'd) must win the Phase 2 bake-off *including* its bundle cost — it does not get to treat bytes as free.
- **Workers inline** (§3.5). `public/` stays empty/deleted (v38.4 — the single-file guarantee).

---

## 7. Phased delivery plan

**Phase 0 — Environment proof (4–7 days).** On the *actual* target fleet, share, and deepest real UNC path. Probes: secure context + full API surface under `file://`; read-after-write and enumeration latency distributions; 100 parallel ops; **all probes use production file extensions** (v98.3: `.tmp` was AV-allowlisted, `.ndjson` wasn't — the probe always lied) and the error classifier gets a scanner-interference category; **total-path-length budget test including Chromium's `.crswap` staging suffix** (v99.4); `createWritable({mode:"exclusive"})` cross-*machine* probe (Research 4 could not verify — settle it empirically); `FileSystemObserver` cross-machine probe (expect failure; confirm); `navigator.storage.persist()` behavior under `file://`; GPO/CBCM file-system-guard policy check with IT (a managed fleet can block the API outright); the **browser-wipe acceptance test** (proposal §44) run manually end-to-end; `file://` shared-origin collision check with any other static tools on fleet machines. *Acceptance: written results per probe; any red item has a named mitigation before Phase 1.*

**Phase 1 — Storage kernel (sibling's scope; 15–25 days).** App-side acceptance: repository contract of §1.1 implemented against the memory double; failure-injection CI subset green; I/O budgets published per primitive.

**Phase 2 — State-model bake-off (timeboxed 10 days, hard stop).** Two candidates against the identical §43 subset + a real-share smoke test: (A) typed per-writer append-only segments + rebuildable projections + upcaster chain (Research 4 §2 — upcasting replaces XQAP's version-branching-inside-the-fold, its most bug-prone spot); (B) Yjs docs over per-writer update files (`Y.mergeUpdates` idempotency). **Decision hinge, stated up front: how much genuine same-record concurrent co-editing does the domain have?** If the answer is "records have natural single owners and conflicts should be *rejected* fresh" — XQAP's reality — (A) wins and no CRDT ships. Acceptance: a one-page decision record with measured bundle delta, greppability assessment, and the failure-injection scorecard.

**Phase 3 — Sync engine (12–20 days).** Targeted subscriptions, polling cadences, Merkle-ish per-partition change hashes for cheap discovery (Research 4 §5 naming the proposal's §16), same-machine BroadcastChannel local echo, freshness UI. **Restore semantics specified before code:** restore merges, never replaces, and invalidates every cursor/checkpoint (v78.0/v85.0/v99.7 — a restore invisible to peers served stale data indefinitely). Acceptance: propagation SLOs (§40) measured on the real share; scenario 20 (observer silent, polling-only) green.

**Phase 4 — Large datasets (10–15 days).** Chunked immutable datasets, gzip via `CompressionStream` with 64KB feed windows, hyparquet only if paged sub-range reads are demanded at real volumes (Research 3's tiering); manifests carry chunk metadata only, never row copies (v62.0: 28MB import → 385MB workspace). Acceptance: a real ≥500MB customer-scale file round-trips through worker streaming without OOM; 22.7×-class compression reproduced.

**Phase 5 — Scale test (5–8 days).** 50→100→250 simulated clients on the real share before product code; tune cadence/segment/shard/batch. Acceptance: no error-rate cliff at target concurrency; files/dir stays under the sharding budget.

**Phase 6 — Product build on repository APIs only.** Business features begin here and *only* here.

Total pre-product infrastructure: ~56–85 engineering days. That is the honest price of "no backend"; XQAP paid it in production incidents instead.

---

## 8. Risk register (top 10)

| # | Risk | Grounding | Mitigation |
|---|---|---|---|
| 1 | Stale state across async identity transitions resurfaces despite the epoch design | v59.190–197 (5 rounds), v59.11, 4× tab bug | Epoch + `useSyncExternalStore` structural design (§2.1); mandatory adversarial-ordering tests (§4.3); adversarial review rule (§5) |
| 2 | Absent-vs-unreadable conflation licenses a destructive write | ≥8 recurrences in 9 days (§9.3); v99.1, v99.6 | Tri-state in the type system; kernel refuses mutate-after-unreadable (§1.1); footprint guard fails closed |
| 3 | Real production volume invalidates size assumptions | 573MB file, 500k rows, 35.66× inflation — all found only in production | Streaming paths default-on above thresholds; Phase 4 acceptance uses real customer-scale files; "10× what you tested" headroom rule |
| 4 | Sync transport (whichever bake-off winner) becomes the new most-bug-prone module | XQAP's fold/checkpoint history; zero prior art for no-server file-sync | Timeboxed bake-off with failure-injection scorecard; upcaster chain isolates versioning; I/O budgets in CI |
| 5 | AV/DLP or GPO silently breaks or blocks file ops on the fleet | v98.3; Research 2 enterprise-policy finding | Phase 0 probes with production extensions + IT policy review; scanner-interference error category |
| 6 | Path-length / files-per-dir limits bite at the deployment, not in dev | v99.4; SMB enumeration degradation at 100k+ entries | Path budget test vs. deepest real UNC path; hash-short filenames; sharding with per-dir entry budget |
| 7 | Bundle raw-size creep degrades every open on the share | v123.2's months-long wrong assumption | 8MB deliberate ceiling + per-PR delta as the real guard; WASM/fonts as named line items |
| 8 | Worker protocol regressions (unbounded messages, cross-lane staleness, silent death) | v117.7/8, v59.189, v97.2 | Protocol rules fixed at framework level (§3); worker tests forbid microtask-instant mocks; Nth-load recovery test |
| 9 | Restore/backup semantics silently lose or hide events | v78.0, v85.0, v99.7, v112.0 | Merge-not-replace + cursor invalidation specified pre-Phase-3; restore audited; unreadable-during-backup fails the backup |
| 10 | New risk this design introduces: `mutate(decide)` re-invocation makes non-idempotent decision functions dangerous (side effects inside `decide` run per retry) | New; analog of v59.9's non-idempotent replay guard | `decide` contractually pure (lint: no awaits/IO inside); side effects keyed off `CommitResult` only; kernel tests re-invoke every `decide` at least twice |

**Files referenced:** `/home/user/XQAP-XRay-Quality-Assurance-Platform/docs/architecture/DATA_ARCHITECTURE_AND_LESSONS_LEARNED_2026-08-25.md`; proposal and critique at `/tmp/claude-0/-home-user-XQAP-XRay-Quality-Assurance-Platform/10575ad5-8dba-5f39-af56-f532ebeee366/scratchpad/static-html-shared-folder-proposal.md` and `.../proposal-critique.md`.