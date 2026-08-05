# X-Ray Quality App — Performance & Architecture Audit

**Date:** 2026-08-04  
**Context:** App running on UNC/network-share workspace folders experiences severe freezing and lag. Chromium's own File System Access API benchmark (Issue #40899722) measured 1,000 small file operations at 3.4s on local disk (macOS) vs 142s over a Windows-hosted UNC share — a ~40× gap, though the comparison also crosses operating systems, not just storage medium, so treat it as directional rather than a clean local-vs-UNC measurement on identical hardware.

## Deliverables

This folder contains a comprehensive audit of the app's data layer and performance characteristics, organized in two visual HTML pages and supporting markdown documentation.

### Visual Reports

- **[1-role-data-map.html](1-role-data-map.html)** — Pan/zoom diagram showing what each of the 5 roles (guest, employee, supervisor, manager, admin) loads, reads, and writes, with network-cost annotations. Updated to reflect the August 1 permission matrix resync and the new BootSplashOverlay boot-progress checklist. **Requires internet access** — its diagrams load `mermaid.js` from `cdn.jsdelivr.net`; opened offline, the diagram blocks render as plain text instead (everything else on the page still works).

- **[2-unc-performance-plan.html](2-unc-performance-plan.html)** — Arabic-language deck with three parts:
  1. **التشخيص (Diagnosis):** Local vs UNC comparison, 9-cause map showing what gets worse on network shares
  2. **خطة التحسين (Plan):** 7 concrete optimization candidates from the Population tab audit, each with rating (1–10), why/how/expected result, and old-vs-new comparison
  3. **تقنيات المتصفح (Browser Technologies):** 15 technologies researched on the web (IndexedDB, OPFS, Service Worker, CRDTs, etc.), each evaluated honestly with rating and risk/applicability notes

### Markdown Documentation

- [FINDINGS.md](FINDINGS.md) — Detailed audit findings from the Population tab, including the 4 most impactful issues discovered
- [BROWSER_TECHNOLOGIES.md](BROWSER_TECHNOLOGIES.md) — Complete research on 15 browser-side/client-side optimization techniques, with ratings and honest assessment of which apply and which don't
- [RECOMMENDATIONS.md](RECOMMENDATIONS.md) — Full ranked list of all 22 optimization candidates (7 from Population audit + 15 from browser research), prioritized by impact × feasibility

## How to Use

1. **Start with the HTML pages** — they're interactive (pannable/zoomable diagrams) and visually organized.
2. **Refer to the markdown** for detailed findings, technical reasoning, and risk assessment.
3. **The ranked list in RECOMMENDATIONS.md** shows the true priority order across all domains.

## Key Finding

The app's current architecture has **no client-side cache layer at all**—every read goes straight to the picked workspace folder on disk. This is safe and simple but becomes a bottleneck when that folder is a network share. The audit identifies:

- **7 high-impact issues in the Population tab alone** (hidden Browse re-trigger, per-row writes in Manual Review, redundant reads in Phase 2 orphan scan, duplicate fetches between Process/Browse, fetch-but-discard mirrors, plus two data-layer items surfaced during the same trace that need their own risk review: relaxing the write-verification cycle and consolidating distribution event files)
- **4 browser technologies worth pursuing** (handle cache, cheap freshness check, cross-tab signaling, event-log compaction)
- **11 technologies that don't fit this app** (OPFS/IndexedDB are low-benefit here, Service Worker requires a server, CRDTs solve a non-existent problem)

## Methodology

- **Part 1 & 2 (Population audit):** Manual code-level trace of the entire Population tab from entry to exit, plus a focused audit of the Employee Referrals view pattern
- **Part 3 (Browser technologies):** Multi-agent web research with Fable directing research categories, Sonnet researching each on the internet, and Opus synthesizing and rating against the app's current state (no cache)

**This is a plan document only.** No changes have been implemented. All recommendations are open for discussion and modification before any development begins.

---

**Related project documents:**
- `docs/superpowers/specs/2026-08-03-distribution-performance-and-workflow-design.md` — Detailed performance specifications, including UNC bottleneck breakdown
- `docs/architecture/LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` — Phase A/B/C/D proposal (Phase A & B shipped; Phase C/D still pending)
- `docs/edit logs/2026-08-04.md` — Daily edit log (if changes are made)
