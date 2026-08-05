# Complete Optimization Rankings — 22 Items Prioritized

**Date:** 2026-08-04  
**Source:** 7 items from Population tab audit (FINDINGS.md) + 15 from browser technologies research (BROWSER_TECHNOLOGIES.md)  
**Ranking Metric:** Impact × Feasibility (frequency of execution × actual speedup achieved)

---

## Tier 1: Do These First (Ratings 8–9)

| Rank | Item | Rating | Effort | ROI | Status |
|------|------|--------|--------|-----|--------|
| 1 | **Population: Hidden Browse re-trigger** | 9/10 | Low | Very High | Code change needed |
| 1 | **In-session directory-handle cache** | 9/10 | Low | Very High | Code change needed |
| 3 | **Cheap freshness check (stat-first)** | 8/10 | Medium | High | Code change needed |
| 3 | **Phase C: Port-partitioned population** | 8/10 | High | Very High | Proposed & sequenced, needs owner approval + build |
| 3 | **Cross-tab signaling (BroadcastChannel)** | 8/10 | Low | High | Code change needed |

### Why Start Here

These five items have the highest ROI on a UNC workspace. The two rank-1 items (hidden Browse re-trigger, directory-handle cache) are lowest-effort and would each show immediate improvement in the most commonly-hit code paths. Phase C requires more work and is not yet owner-approved, but it's already sequenced in the project's own proposal and has the highest theoretical impact.

### Implementation Order

1. **Directory-handle cache** (1 day) — Lowest risk, immediate payoff in every operation
2. **Hidden Browse de-trigger** (1–2 days) — High frequency, removes 20–30 full-file re-parses per Manual Review session
3. **Cheap freshness check** (2–3 days) — Cuts refresh-timer cost by ~90%
4. **BroadcastChannel** (1 day) — Closes a gap between documentation and code
5. **Phase C** (2–4 weeks, pending owner approval) — Structural change, highest ceiling

---

## Tier 2: Worth Doing Next (Ratings 4–7)

| Rank | Item | Rating | Effort | ROI | Dependencies |
|------|------|--------|--------|-----|--------------|
| 6 | **Population: Per-row batching in Manual Review** | 7/10 | Medium | High | Shares refresh signal with issue 1 |
| 7 | **Bounded append-only event archival** | 7/10 | Medium | Medium | Cross-machine lock infrastructure |
| 8 | **Phase D: Streaming report generation** | 6/10 | Medium | Medium | Depends on Phase C |
| 9 | **Population: Redundant Phase 2 orphan-scan reads** | 5/10 | Low | Medium | No dependencies |
| 9 | **Population: Duplicate Process/Browse fetches** | 5/10 | Medium | Medium | No dependencies |
| 9 | **Sidecar revision index** | 5/10 | Medium | Low | Useful with Phase C |
| 12 | **Light idle-time prefetch** | 4/10 | Low | Low | Can cause wrong-guess penalty |
| 12 | **Population: Fetch-but-discard mirror in Referrals** | 4/10 | Low | Low | No dependencies |

### Notes

- **Items 6 & 7** can be done together (they fix the same refresh-signal architecture)
- **Item 9 (orphan scan)** is the easiest of the redundant-read fixes and should be done first
- **Item 9 (revision index)** is only valuable paired with either the cheap freshness check (item 3) or Phase C
- **Item 12 (prefetch)** should only be done after Phase C's bounded cache exists, to avoid speculative fetches that can't be evicted
- **Item 12 (fetch-but-discard mirror)** is a one-line defer-until-needed fix, see `FINDINGS.md`'s bonus finding

---

## Tier 3: Do Not Recommend (Ratings 1–3)

### OPFS Local Mirror — Rating 3/10
**Why not:** Second copy of business data, invisible to backup and audit. Real risk is silent staleness if sync protocol diverges. Defer until Phase C is measured and proven insufficient.

### IndexedDB Read-Through Cache — Rating 3/10
**Why not:** Machine-local, evictable, never authoritative. App's own proposal already deferred this. Benefit is narrow and site-data wipe would orphan cached data.

### SharedWorker for Handles & Queue — Rating 3/10
**Why not:** Largely duplicates existing Web Locks and module-level state. Does nothing for cross-machine writes, which is what matters here.

### Gzip Compression — Rating 2/10
**Why not:** Solves bandwidth, not round-trip latency (the actual bottleneck). Loses human-readable workspace files and silently breaks backups unless backup path is rewritten.

### FileSystemObserver — Rating 2/10
**Why not:** Documented as unreliable over network shares—the exact case where we need it. Can never replace polling, so it's an optimization with almost no real payoff.

### CRDT Libraries (Automerge / Yjs) — Rating 2/10
**Why not:** Solves a problem that doesn't exist (the app already avoids concurrent multi-writer conflicts). Adds a heavy dependency and opaque file format, displacing other more valuable optimizations.

### Service Worker / Cache API / Background Sync — Rating 1/10
**Why not:** Structurally blocked. App is distributed as a single file opened directly; Service Worker cannot register. Requires HTTPS/localhost server, which was a deliberate non-choice.

---

## Two Items Needing Separate Risk Review

### Relax Write Verification Cycle
**Potential Impact:** 8–9/10 (would cut disk operations by ~50% per write)  
**Status:** Deferred intentionally  

This is the highest single-operation impact available, but it touches data safety at write time. Requires its own risk review: how much safety margin do we lose? What's the probability of corruption if network drops mid-write?

**When to revisit:** After Phase C is shipped and disk I/O patterns stabilize.

### Consolidate Distribution Event Files
**Potential Impact:** 7–8/10 (reduces backup scope, directory-listing cost)  
**Status:** Deferred intentionally  

This is part of the event-archival strategy (item 7) but is large enough to need its own design review. Changes a fundamental data structure (one file per event → sharded files or compaction) that affects sampling, distribution, and backup.

**When to revisit:** As part of the Phase D streaming work, or when backup becomes a measurable bottleneck in production.

---

## Summary Table (All 22 Items)

| Rank | Item | Rating | Tier | Do? |
|------|------|--------|------|-----|
| 1 | Population: Hidden Browse re-trigger | 9/10 | 1 | YES |
| 1 | In-session directory-handle cache | 9/10 | 1 | YES |
| 3 | Phase C: Port-partitioned population | 8/10 | 1 | YES (pending owner approval) |
| 3 | Cheap freshness check | 8/10 | 1 | YES |
| 3 | Cross-tab signaling (BroadcastChannel) | 8/10 | 1 | YES (only when served, not file://) |
| 6 | Population: Per-row batching in Manual Review | 7/10 | 2 | YES (with issue 1) |
| 7 | Bounded append-only event archival | 7/10 | 2 | YES (with cross-machine locks) |
| 8 | Phase D: Streaming reports | 6/10 | 2 | YES (after Phase C) |
| 9 | Population: Redundant orphan-scan reads | 5/10 | 2 | YES |
| 9 | Population: Duplicate Process/Browse fetches | 5/10 | 2 | YES |
| 9 | Sidecar revision index | 5/10 | 2 | MAYBE (if cache layer works well) |
| 12 | Light idle-time prefetch | 4/10 | 2 | MAYBE (after Phase C) |
| 12 | Population: Fetch-but-discard mirror in Referrals | 4/10 | 2 | YES (trivial defer-until-needed fix) |
| — | OPFS local mirror | 3/10 | 3 | NO (for now) |
| — | IndexedDB cache | 3/10 | 3 | NO (for now) |
| — | SharedWorker | 3/10 | 3 | NO |
| — | Gzip compression | 2/10 | 3 | NO |
| — | FileSystemObserver | 2/10 | 3 | NO |
| — | CRDT libraries | 2/10 | 3 | NO |
| — | Service Worker / Cache API | 1/10 | 3 | NO (blocked) |
| — | Relax write verification | 8–9/10 | Special | DEFER (needs risk review) |
| — | Consolidate distribution events | 7–8/10 | Special | DEFER (needs risk review) |

---

## Effort Estimate for Tier 1 + Tier 2

| Phase | Items | Estimated Effort | Parallel Possible? |
|-------|-------|------------------|--------------------|
| Phase 1A | Handle cache, De-trigger Browse, Cheap freshness check | 4–5 days | Partially (can design cache independently) |
| Phase 1B | BroadcastChannel, Manual Review batching | 2–3 days | Yes |
| Phase 1C | Phase C (port-partitioned storage) | 2–4 weeks | Separate, large effort |
| Phase 2 | Orphan scan, duplicate fetches, event archival | 2–3 days | Yes |
| Phase 3 | Phase D (streaming), optional revision index | 1–2 weeks | After Phase C |
| **Total (excluding Phase C & D)** | **~7–11 days** | — |
| **Total (including Phase C)** | **~3–5 weeks** | — |
| **Total (including Phase C & D)** | **~4–6 weeks** | — |

---

## Next Step

**Start with the Tier 1 items:** Four are low-effort/low-risk code changes (handle cache, hidden-Browse de-trigger, freshness check, BroadcastChannel — the last needing the app served rather than opened as a file). Phase C is the fifth and requires owner approval before build. Shipping the four code changes will show measurable improvement on a UNC workspace and establish the pattern for Tier 2 work.

**Measure before moving deeper:** After Tier 1 is shipped, profile real usage on a UNC workspace. Tier 2 items can then be prioritized based on what actually remains slow.

This is a plan document. All recommendations are open for discussion before implementation begins.
