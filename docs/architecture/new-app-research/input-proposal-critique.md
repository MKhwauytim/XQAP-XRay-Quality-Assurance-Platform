# Critique of the Static-HTML Shared-Folder Proposal (Fable review, 2026-08-25)

Verdict: adopt ~80% as-is; the Automerge bet is the one decision to challenge before committing; a few hard-won XQAP lessons are underweighted.

## Agreed strengths
- Core diagnosis correct: design around contention (immutable / single-writer / merged) instead of retrying through it — XQAP's most-repeated fix, designed in from day one.
- Immutable IDs fix XQAP's username-keyed-filename identity hazard (rename-orphan problem).
- Four data classes, partitioned compressed datasets (22.7× measured), content-addressed blobs, disposable derived caches — all carry proven results.
- Targeted subscriptions, bounded single-writer segments, Phase 0 environment proof, failure-injection list, browser-wipe acceptance test — excellent.
- Tri-state reads as non-negotiable — the single most important rule.

## Main concern: Automerge presented as settled when it is a hypothesis
1. Complexity moved, not removed: SharedFolderSyncAdapter (file-based CRDT transport over SMB, no server) is the same KIND of component as XQAP's distribution event store + fold + checkpoint — the most bug-prone module in the entire codebase. Replaces a battle-understood home-grown event log with a home-grown transport for someone else's binary format.
2. For the decisions that matter most (approve vs reject), the proposal itself falls back to append-only decision events with derived effective decision — literally XQAP's model. Automerge's real payoff is silent merging of concurrent edits to different fields of the same record. In XQAP, nearly every record had one natural owner, and the genuine same-record conflicts (ownership theft v90.0, stale-tab regressions v98.4/98.5) were bugs we WANTED blocked with fresh re-reads and guards, not silently merged. Silent merge can be wrong for audit-grade systems.
3. Greppability lost: XQAP's plain-JSON share enabled Notepad inspection and grep-based incident forensics (v90.0 ADHOC- grep). Automerge binary changes are opaque; in a no-backend deployment the human admin IS ops.
4. Compaction (§49) hand-waves a genuinely hard distributed-GC problem (shared folder, concurrent readers, stale clients, no coordinator). XQAP dodged this class with rebuildable projections + archived immutable raws. Base64 WASM also adds real megabytes where raw bytes are what users wait on (file:// + SMB lesson).

Recommendation: make Phase 2 a bake-off — Automerge docs vs XQAP-style per-writer append-only signed segments with rebuildable projections — against the same failure-injection list. Decision hinge: how much genuine same-record co-editing does the domain actually have?

## Gaps / underweighted XQAP lessons
1. Antivirus/DLP file-extension interference (v98.3: .tmp allowlisted, .ndjson not — probe always lied). Phase 0 must probe with production extensions; error classifier needs a scanner-interference category.
2. Windows 260-char path limits (v99.4; feedback thread IDs). Sharded dirs + ULIDs + UNC roots + .crswap siblings stack up. Need an explicit total-path budget rule.
3. Cross-machine clock skew: time-boundary rotation, UUIDv7 ordering, "sealed at time X" assume comparable clocks. Use clock-derived IDs for uniqueness, never for correctness-bearing cross-machine ordering.
4. Restore semantics for the sync area: restore must MERGE, not replace (v78.0/v85.0), and invalidate any checkpoint/cursor-like state, or changes are silently lost. Must be specified for CRDT segments before Phase 3.
5. FileSystemObserver almost certainly will not fire for OTHER machines' SMB writes (local FS events only). Plan as if polling is the only mechanism; observer is local-echo bonus.
6. §53 over-corrects on .bak/.tmp: the few remaining small single-writer MUTABLE files (writer heads, bootstrap) still need stage-verify-commit — a torn write there is the v43.4 bricked-workspace scenario.
