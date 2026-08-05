# Browser Technologies for Data Optimization — Research Report

**Research Date:** 2026-08-04  
**Methodology:** Fable-directed research categorization → Sonnet web research → Opus synthesis & rating  
**Format:** Real web research (not speculation), with honest assessment of applicability to this app

---

## Executive Summary

15 distinct browser-side and client-side technologies were researched to identify what could reduce network latency, redundant reads, or write-traffic costs in a no-backend SPA that reads/writes JSON files via the File System Access API to a user-picked workspace folder (sometimes a UNC/network share).

**Verdict:**
- **4 worth doing** (ratings 8–9): Handle cache, Phase C (port-partitioned storage, proposed and sequenced, pending owner approval), cheap stat-first freshness check, cross-tab BroadcastChannel
- **4 worth considering** (ratings 4–7): Event-log compaction, streaming reports, revision index, light prefetch
- **7 not recommended for this app** (ratings 1–3): OPFS mirror, IndexedDB, SharedWorker, gzip compression, FileSystemObserver, CRDTs, Service Worker
- **1 structurally blocked** (rating 1): Service Worker (requires serving over HTTPS or localhost; app is a file-opened standalone HTML)

---

## High Priority (Ratings 8–9)

### 1. In-Session Directory-Handle Cache  
**Rating: 9/10** | **Effort: Low** | **Risk: Low**

Every read/write today re-resolves the folder path from the workspace root. A single `read` operation walks: `2-samples` → `{month}` → `2-employees` → `{username}.samples.json`. Each segment is a separate `getDirectoryHandle()` call—four network round-trips for one logical operation.

**Fix:** Memoize resolved directory handles for the session lifetime. On error, evict the entry and re-resolve from root. No file format change, no write-protocol change.

**Expected Impact:** 2–4 fewer network round-trips per operation. Compounds in list views that touch many files.

**See:** [2-unc-performance-plan.html](2-unc-performance-plan.html), Part 3, "ذاكرة مؤقتة لمقابض المجلدات داخل الجلسة"

---

### 2. Phase C — Port-Partitioned Population Storage  
**Rating: 8/10** | **Effort: High** | **Risk: Medium**

The processed population is still one file per month (up to ~10 MB for 400k rows). Phase A (demand gating) and Phase B (worker-backed Browse) shipped and helped, but didn't shrink the file. Phase C is the proposed next step in the app's own proposal — sequenced but **not yet owner-approved** — and is the only change that **actually bounds** both bytes-read-per-request and total memory held.

**How:** Split into an index file + per-port part files, each independently verified. Readers consult the index and open only the parts they need. An LRU cache (byte-budgeted) keeps recently used parts in memory.

**Expected Impact:** Reads scale with what the screen shows, not total population size. Memory stays bounded.

**Status:** Already designed and sequenced in `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md`. Phase C/D still pending.

---

### 3. Cheap Freshness Check Before Full Re-Read  
**Rating: 8/10** | **Effort: Medium** | **Risk: Low**

The background refresh timer makes every subscribed view re-open, re-read, and re-parse files in full on a fixed interval, **whether or not anything changed**. A size + last-modified check is far cheaper than pulling bytes across the network.

**How:** On each tick, for a small list of key files (month manifest, distribution.current, notifications, sample.master), compare size and last-modified time. Only escalate to full read when something differs. Lengthen the interval while the tab is hidden.

**Expected Impact:** Most ticks cost one cheap stat call instead of one full re-read per file. Changes made by other machines still surface with the same latency.

**See:** [2-unc-performance-plan.html](2-unc-performance-plan.html), Part 3, "فحص سريع للتغيّر"

---

### 4. True Cross-Tab Refresh Signaling (BroadcastChannel)  
**Rating: 8/10** | **Effort: Low** | **Risk: Very Low when served over HTTP(S); does not apply under `file://`**

The refresh signal is documented as covering "another user, tab, or machine," but it's built on a window event that never leaves the tab. Two tabs on the same machine discover each other's writes only when their own timer happens to fire.

**How:** Add a same-origin `BroadcastChannel` alongside the existing event. Post to the channel as well as dispatch locally. Carry a small payload (source, scope, revision) so receivers know whether they need to re-read.

**Expected Impact:** Write in one tab shows up in others within ~1 second instead of after a full refresh interval. Receivers told the new revision can skip re-reading files they already hold.

**Caveat — file:// origin:** when the app is opened directly as a local file (the primary distribution mode per CLAUDE.md), each tab gets an opaque origin and `BroadcastChannel` cannot span them. This only works when the built `dist/index.html` is served statically (HTTP/HTTPS/localhost) rather than double-clicked open — the same constraint `Service Worker` fails on outright, just less totally.

---

## Medium Priority (Ratings 4–7)

### 5. Bounded Append-Only Event Files with Archival & Compaction  
**Rating: 7/10** | **Effort: Medium** | **Risk: Medium**

Distribution already writes one small immutable file per event and folds them into rebuildable current state. That pattern sidesteps write races entirely, but nothing bounds how many files accumulate. On a network share, listing/opening a directory grows more expensive with every file in it.

**How:** Add a fold-and-archive step: once derived snapshot is verified, move fully folded event files into a dated archive subfolder. Trigger on file count. Protect compaction with a CAS-locked record so only one machine compacts at a time.

**Expected Impact:** Directory listing cost stays flat. Concurrent posts to notifications and audit log stop colliding and retrying.

---

### 6. Phase D — Streaming Generation for Reports, Exports, Aggregation  
**Rating: 6/10** | **Effort: Medium** | **Risk: Medium**

Even after storage is partitioned (Phase C), consumers that read the whole population (report builders, Power BI export, KPI aggregation) will still pull everything into memory at once unless changed. Because each part is a small complete file, streaming just means processing one part, releasing it, then moving to next.

**How:** Move each consumer behind the Phase C repository/index abstraction. Accumulate results across parts instead of one big array. Emit output incrementally.

**Expected Impact:** Report generation, export, and aggregation run in bounded memory and stop freezing the interface on large months.

**Depends on:** Phase C landing first.

---

### 7. Sidecar Revision Index for Cheap Staleness Checks  
**Rating: 5/10** | **Effort: Medium** | **Risk: Low**

The only way to learn whether a file changed is to read the whole file and inspect its envelope. A small sidecar file listing every file in a month folder with its current revision and content hash turns "is anything stale?" into one small read instead of one full read per file.

**How:** Extend the month manifest or add a sibling index listing per-file revision and content hash. Treat as a hint, never as authority: if it disagrees with a file, the file wins and the index is rebuilt.

**Expected Impact:** Checking whether a month's data changed costs one small read instead of one per file. Caches can be validated without paying the cost they exist to avoid.

---

### 8. Idle-Time Speculative Prefetch of Adjacent Months (Metadata Only)  
**Rating: 4/10** | **Effort: Low** | **Risk: Medium**

In the Archive, the most likely next click is the month before or after the current one. Fetching just the small metadata while the browser is idle can make that click feel instant.

**How:** After initial load, schedule a background-priority task to fetch only metadata (manifest, summary) of neighboring months. Never fetch full population data. Discard if user moves on, because in-flight reads cannot be cancelled.

**Expected Impact:** Moving between adjacent months in Archive feels immediate.

**Risk:** A wrong guess is not free on a network share—it consumes round-trips the user's real action needs. Must never gate the boot splash.

---

## Not Recommended (Ratings 1–3)

### 9. OPFS Local Mirror of Workspace  
**Rating: 3/10**

The browser's private file system uses the same handle interface, so mirroring the workspace there would take the network out of the read path entirely. Highest theoretical speed ceiling.

**Blocker:** It's a second copy of business data, invisible to backup/audit/portability. Real danger is silent staleness: any sync-protocol gap means users see data they believe is current from a folder someone else changed. Consider only after Phase C's in-memory cache is measured and found insufficient.

---

### 10. IndexedDB Read-Through Cache  
**Rating: 3/10**

Could hold parsed data between page loads so reopening the app doesn't re-read the share. The project's own proposal already deferred this: machine-local, evictable, invisible to backup, must never be authoritative. Benefit is narrow: only same-machine re-reads of unchanged files.

---

### 11. SharedWorker for Cross-Tab Handle & Write Queue Owner  
**Rating: 3/10**

One shared script could hold directory handles and serialize writes from all tabs instead of each tab keeping its own.

**Blocker:** Largely duplicates what Web Locks API and module-level state already achieve, and does nothing for the multi-machine case that actually matters here. It also shares the same `file://` opaque-origin problem as BroadcastChannel above: a `SharedWorker` cannot actually be shared across tabs that each opened the HTML file directly, so it only "works even when opened as a file" in the narrow sense of not throwing at construction time — not in the sense of achieving cross-tab sharing.

---

### 12. On-Disk Gzip Compression  
**Rating: 2/10**

Files compress well and CompressionStream is native, so files could shrink several times over.

**Blocker:** Answers a question the app hasn't established it has—measured problem was parsing/memory, not bytes on wire. Per-file round-trip cost (which compression doesn't touch) is the dominant problem. Also loses human readability of workspace files and silently corrupts backups until the backup copier is made binary-safe.

---

### 13. FileSystemObserver Change Notifications  
**Rating: 2/10**

Tells a page when a file changes instead of polling. Sounds like the ideal answer to "another machine just changed this."

**Blocker:** Specification only promises best-effort notice. The underlying Windows mechanism is documented as unreliable over network shares—precisely the case this app needs it for. Never replaces polling, so it's an optimization that buys almost nothing for a high-reliability use case.

---

### 14. CRDT Merge Library (Automerge / Yjs)  
**Rating: 2/10**

These merge concurrent edits from several machines automatically. For this app they solve a problem that mostly doesn't exist: nearly every file has one natural writer, and the two that have many writers are already protected by compare-and-swap. The one place that genuinely needs order-independent merging (distribution event log) is already implemented correctly by hand, at zero bundle cost.

---

### 15. Service Worker, Cache API, and Background Sync  
**Rating: 1/10** — **Structurally Blocked**

Standard web answers for offline behavior and deferred work, but none of them fit here:
- **Service Worker:** Cannot be registered from a file opened directly; app is distributed as a single file.
- **Cache API:** Only stores network request/response pairs; this app never makes network requests for its data.
- **Background Sync:** Retries failed network calls once connectivity returns; a slow network folder is not a connectivity problem.

**To use any of these:** App would need to be served over HTTPS or localhost, a much bigger decision that deliberately was not taken. The project moved the opposite direction—toward a single portable file with no server.

---

## Research Methodology

Each technology was researched via:
1. **Fable (directing categories):** Defined 10 research dimensions covering the full optimization space
2. **Sonnet (web research):** Real searches on MDN, Chromium bug tracker, browser support tables, engineering posts, spec status
3. **Opus (synthesis & rating):** Evaluated each against the app's actual state (no cache layer, File System Access API, no backend, sometimes UNC share)

**Quality gates:**
- "This doesn't apply" verdicts backed by spec/browser-support evidence, not speculation
- Estimates (storage quota, throughput) tied to official docs when available
- Risk assessments grounded in actual failure modes (staleness, eviction, quota, correctness)
- No technology inflated to seem more valuable than measured reality supports

---

## Common Patterns (Why So Many "No")

**Pattern 1: Service Worker / Cache API**  
Problem: These assume serving over HTTP(S). App is a file-opened standalone HTML. Fixing this requires a backend decision that was deliberately not taken.

**Pattern 2: Local Mirror / IndexedDB / OPFS**  
Problem: All create a second copy of business data. Benefits only if the network is the bottleneck AND the second copy stays in sync. On a workspace folder edited by multiple machines, sync is hard and silent staleness is the real danger.

**Pattern 3: CRDTs / Complex Conflict Resolution**  
Problem: The app already avoids concurrent writers for nearly all files (one employee's own answers, one supervisor's own decisions). The one file with many writers (distribution events) uses an append-only + fold pattern that gives CRDT-like convergence for free, with zero bundle cost.

**Pattern 4: Optimization Without a Measured Problem**  
Problem: Gzip compression, FileSystemObserver, etc., sound good in isolation, but only matter if the actual bottleneck is what they optimize (bandwidth for gzip, file-watch latency for FSO). The measured problem here is **per-file round-trip cost**, which none of these touch.

---

## Conclusion

Browser APIs are mature and offer many options for caching and optimization. But **optimization requires a measured bottleneck**. This app's bottleneck on a UNC workspace is not bandwidth or storage quota—it's the per-file round-trip cost of the network share itself.

Technologies that reduce round-trips (handle cache, cheap freshness checks, cross-tab signaling) are genuinely valuable here. Technologies that address other problems (compression, CRDT merging, blob caching) are well-designed but solve problems this app doesn't have.

The highest-impact changes are:
1. **Not browser tech at all:** Fix the 4 findings in the Population tab (Issues 1–4 above)
2. **Implement Phase C:** Port-partitioned storage with bounded cache
3. **Add the handle cache:** Simplest code change, immediate return

Browser technologies have their place, but they work best in service of a clear understanding of what's actually slow. This audit provides that understanding.
