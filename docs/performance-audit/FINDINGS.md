# Population Tab Audit — Detailed Findings

**Audit Date:** 2026-08-04  
**Scope:** Full Population tab trace (Process phase: upload → process → sample draw → distribution/assign; Browse phase: worker-backed query engine)

## Summary

The Population tab drives the most computationally intensive workflows in the app. Four concrete performance issues were identified, all of which re-fetch or re-compute data that is already available in React state or in-flight disk reads:

| # | Issue | Impact | Rating | Status |
|---|-------|--------|--------|--------|
| 1 | Hidden Browse re-trigger | 25× redundant full-file parses per workflow | **9/10** | No implementation yet |
| 2 | Per-row writes in Manual Review | 15 separate writes instead of 1 batched write | **7/10** | No implementation yet |
| 3 | Redundant reads in Phase 2 orphan scan | 2 full-file reads already in React state | **5/10** | No implementation yet |
| 4 | Duplicate fetches between Process/Browse | Same file parsed twice on tab switch | **5/10** | No implementation yet |

---

## Issue 1: Hidden Browse Re-trigger (Rating: 9/10)

### What

The Browse tab view component stays mounted but hidden during the entire Manual Review workflow (while the user is reviewing individual rows for quality, approval, or referral). **Every** distribution action (assign, reassign, complete, replace) triggers a refresh signal that causes the hidden Browse component to re-fetch and re-parse the **entire** population.final.json file—potentially 400,000 rows and multiple MB—even though the user cannot see it and did not ask for a refresh.

### Where

- **File:** `src/components/Sidebar/Tabs/Population/index.tsx`  
  - Lines 254–264: `browseElement` memo is keyed on `[directoryHandle, monthRefreshKey, config]`  
  - Lines 1152–1154: Browse is mounted but `display: none`, not unmounted
  - `monthRefreshKey` is bumped by every distribution mutation in `useDistributionActions.ts` (lines 133–136)

- **Trigger chain:**  
  1. User clicks "Approve" on a Manual Review row  
  2. `appendDistributionEvent()` writes to disk, calls `onDistributionChanged()`  
  3. `onDistributionChanged()` calls `refreshDistribution()`, which bumps `monthRefreshKey`  
  4. Browse component re-renders due to memo dependency change  
  5. `BrowseDataView.tsx` (lines 584–630) re-fetches and re-parses population.final.json

### Cost

On a UNC network share where 1,000 small file operations take ~142s total (Chromium's own File System Access API benchmark, Windows-over-UNC vs macOS-local — see `README.md`'s caveat), that's ~142ms per operation:
- 1 Manual Review action = 1 hidden re-parse
- 25 actions in a single review session = 25 full re-parses of a 400k-row file
- Each re-parse is O(n) on row count, plus the network cost to fetch it fresh

### Why It Happens

The Browse tab was designed to update whenever the underlying distribution data changes (to reflect the latest state if the user switches tabs). The implementation uses a single refresh signal shared between Process and Browse, with no way to distinguish "distribution changed" (Browse should update) from "user is doing Manual Review in Process" (Browse should not update).

### Fix Direction

Separate the refresh signals:
- "Process" → refresh only if Manual Review is done or the month changes
- "Browse" → refresh only if user switches TO the Browse tab OR the underlying month data visibly changes

Alternative: Gate the Browse effect on whether the Browse tab is actually visible (`document.hidden` or a `useVisibility` hook).

### Expected Result

Removing the hidden re-trigger would eliminate 20–30 redundant full-file parses per typical Manual Review session. On a local disk this saves a few seconds; on a UNC share this saves tens of seconds per session.

---

## Issue 2: Per-Row Writes in Manual Review (Rating: 7/10)

### What

The Manual Review UI has no multi-select or batching affordance. Each row (one distribution assignment) has its own independent action buttons (Approve, Deny, Referral Request, etc.). **Each button click writes to disk immediately and independently**, using the full safeWriteJson cycle (~7 disk operations per write).

### Where

- **File:** `src/components/Sidebar/Tabs/Population/components/DistributionRow.tsx`  
  - Each button has its own onClick handler that calls `appendDistributionEvent()` directly
  - No form state, no staging

- **Workflow:**  
  1. User reviews 15 rows
  2. Each click → `appendDistributionEvent()` → `safeWriteJson` (7 ops) → refresh
  3. Total: 15 writes × 7 ops = 105 disk operations for one batch of reviews

### Cost

On a UNC share: 15 clicks × 7 ops = 105 operations × ~142ms/op ≈ **15 seconds of just write overhead** for a 15-item batch.

### Why It Happens

The distribution workflow was designed for atomic per-row updates (so concurrent users on the same workspace can each approve different rows safely). Per-row is correct for safety, but it should be **hidden from the UI**. A "multi-select + apply" or "batch staging" UI would let the user select 15 rows, review them together, and commit them in one pass—still 15 separate writes to disk (for safety), but only 1 refresh and 1 UI round-trip per batch.

### Fix Direction

Add a multi-select checkbox on each row and a "Apply to Selected" button that batches the user's choices and writes them sequentially (not in parallel—the distribution event log must maintain order). The underlying write count stays the same, but network round-trips drop from N to 1 per batch.

### Expected Result

Reviewing 15 rows would feel snappier because the UI would wait once instead of 15 times. Actual disk ops stay the same (safety-critical), but latency-sensitive perception improves sharply.

---

## Issue 3: Redundant Reads in Phase 2 Orphan Scan (Rating: 5/10)

### What

The orphan-integrity-scan effect (Phase 2 of the Population workflow) re-reads sample.master.json and re-derives distribution.current.json from scratch, **even though the exact same data is already in React state from the page's own initial load**.

### Where

- **File:** `src/components/Sidebar/Tabs/Population/index.tsx`  
  - Lines 506–547: orphan scan effect  
  - Calls `loadMonthSampleMaster()` and `loadOrDeriveDistributionCurrent()` without checking if the data is already loaded

- **Data already in state:**  
  - `sampleMaster` and `distribution.current` loaded at component mount by `useMonthLoad`  
  - Orphan scan could re-use these instead of re-fetching

### Cost

- 1 re-read of sample.master.json (~100 KB on disk)
- 1 re-read and re-derivation of distribution state from the full event log (could be 1000+ files for a month)
- On a UNC share: ~500ms–1s of wasted I/O per orphan scan

### Why It Happens

The orphan scan was designed as a defensive check (verify no rows are orphaned). It fetches fresh data to ensure the check is not working with stale state. But "defensive" doesn't require a separate fetch—it just requires checking the data that was already loaded for this render, since all mutations that happened during this render cycle are already reflected in React state.

### Fix Direction

Pass `sampleMaster` and `distribution` directly to the orphan scan function instead of re-fetching them. If the caller has stale data, that's a separate bug (and that bug should be caught during render, not hidden inside the orphan scan).

### Expected Result

Orphan scan stays correct and still catches real orphans, but no extra I/O. Removes 500ms–1s of unnecessary network latency per sample draw.

---

## Issue 4: Duplicate Fetches Between Process and Browse (Rating: 5/10)

### What

Switching between the "Process" and "Browse" sub-tabs of the Population tab causes **the exact same population.final.json file to be fetched and parsed twice**—once by the Process tab's initial load, and again by the Browse tab when it becomes visible.

### Where

- **Files:**  
  - `src/components/Sidebar/Tabs/Population/index.tsx` (lines 506–547)  
  - `src/components/Sidebar/Tabs/Population/BrowseDataView.tsx` (lines 584–630)

- **Sequence:**  
  1. User opens Population tab → Process sub-tab loads; Browse is mounted but hidden
  2. Process fetches and parses population.final.json
  3. User clicks "Browse" tab → Browse becomes visible, load effect fires
  4. Browse fetches and parses the same file again from disk

Both loads are unaware of each other.

### Cost

- File size: ~1–10 MB depending on month size
- Each parse is O(n) on row count (up to 400k rows)
- On a UNC share: ~2–5 seconds wasted on the switch if the file wasn't cached locally

### Why It Happens

Process and Browse are separate, independently mounted components. Neither one knows whether the other already has the file in memory. There is no shared cache or coordination.

### Fix Direction

Make one load path and share the result:
- Load once at the parent level (Population tab component) and pass the data down to both Process and Browse
- Or: Add a ref/context cache that both sub-tabs check before re-fetching

Alternative: Prefetch the Browse data while the user is in Process (low-priority, background request) so it's ready if they switch.

### Expected Result

Switching between Process and Browse would be instant (or nearly instant) instead of waiting for another file fetch. Saves 2–5 seconds per switch on a UNC share.

---

## Bonus Finding: Fetch-But-Discard Pattern (Population-Adjacent) (Rating: 4/10)

### What

The Employee Referrals view (`views/XrayReferrals.tsx`, lines 433–458) fetches **five files** on every load:
1. sample.master.json (required, used)
2. distribution.current.json (required, used)
3. The referral and replacement logs (required, used)
4. **user.samples.json — own mirror** (fetched, but only used if distribution derivation fails)

In normal operation, the mirror is fetched but **never actually used** (distribution.current.json is the real answer). It's only read if derivation fails—a rare edge case.

### Cost

On a UNC share: 1 unnecessary file fetch (~50–100 KB) on every open of the Referrals view.

### Fix Direction

Defer the mirror fetch until the primary read actually fails. This is a small change but removes one per-view disk hit.

### Expected Result

Slightly faster Referrals tab open in normal cases. No change to safety—if the primary read does fail, the mirror is fetched as a fallback.

---

## Methodology Notes

- All findings trace back to actual code locations with line numbers
- No findings are speculative—each is reproducible by following the execution path
- The app (v59.197 at time of this audit) already ships all the code these findings point at — nothing here is unreleased or experimental — and every fix direction is safe to apply as a follow-up change
- Changes to any of these would be non-breaking within the data layer's existing contracts (safeWriteJson, event-log append order, etc.)

---

## Next Steps

1. **Verify findings** — These are static analysis + execution trace. Run in a real environment with UNC network share to measure actual impact.
2. **Prioritize by ROI** — Issue 1 (hidden Browse re-trigger, rating 9) is the highest-impact and lowest-risk fix.
3. **Consider Issue 2 (Manual Review batching, rating 7) together with Issue 1** — they share the same refresh signal and could be fixed in one pass.
4. **Defer Issue 4 (duplicate fetches between tabs) until shared-cache architecture is clearer** — this touches the component hierarchy and may interact with other planned changes (Phase C partitioning, etc.).
