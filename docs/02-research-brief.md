# Research Brief — How Government & Enterprise QC Systems Solve These Problems

_Generated 2026-06-14. Scope: government audit & sampling standards, enterprise quality-management / case-management patterns, and the architecture that supports them. Findings are mapped to concrete recommendations for the X-Ray QC app._

## 0. The one-line takeaway

The app's current "6250 floor + 40/30/30 split" is an **operational quota**, not a **statistically defensible sample**. Mature government and enterprise QC systems all separate two ideas the spec currently blends: (a) _how many_ records you must review to make a defensible statement about quality at a stated confidence level, and (b) _how you allocate_ that review across strata and reviewers. Adopting the standard vocabulary for (a) — confidence, tolerable/expected error rate, precision — is the single biggest "smartness" upgrade available, and it's cheap.

---

## 1. Statistical audit sampling (the core upgrade)

Government audit bodies (IRS, GAO, PCAOB, bank examiners) don't pick round-number sample sizes. They derive sample size from three inputs and report results with a measurable margin of error.

**Attribute sampling** — used when each item is judged pass/fail (exactly the "سليمة / اشتباه" + "studyable / unstudyable" judgments here). Sample size is driven by:

- **Confidence level** — statistical assurance the sample reflects the population, typically **90–99%**. 95% means ≤5% chance the sample is unrepresentative.
- **Tolerable exception rate** — the highest error rate you'd still accept.
- **Expected exception rate** — your prior estimate of errors.

Worked reference points from IRS/HUD-OIG guidance: at **90% confidence, 5% tolerable, 0 expected → n ≈ 48**; at 10% tolerable → n ≈ 23. Sample size grows with confidence and shrinks with tolerance. GAO's *Using Statistical Sampling* formalizes design, selection, and **precision** (the ± band around the point estimate).

**ISO 2859-1 (acceptance sampling by attributes, AQL-indexed)** is the enterprise/manufacturing analogue. It maps lot size + inspection level (GI/GII/GIII, plus special levels S1–S4) + **Acceptable Quality Limit** to a sample size and an accept/reject number, and switches between **normal / tightened / reduced** inspection based on recent history — i.e. it samples _more_ when a supplier has been failing and _less_ when they've been reliable.

**Why this matters for the app:**

1. Replace the bare 6250 with a **defensible target**: "review enough rows that we can state, at 95% confidence, that the suspect-miss rate is ≤ X%." Keep 6250 as a **policy floor** (a contractual minimum), but compute and _display_ the statistically required `n` alongside it, and the achieved precision.
2. **Stratified sampling** is the formal name for what the stages 2–4 / 40-30-30 split is reaching for: divide the population into strata (stages, ports, CertScan vs Non), sample each, and combine with weights. The supply-aware spillover (§13.2) is a sound, pragmatic stratified-allocation heuristic — formalize it as **proportional allocation with capacity caps**, and optionally offer **Neyman allocation** (sample more where variance/risk is higher) as a "smart mode."
3. Borrow ISO 2859's **adaptive tightening**: ports or operators with higher recent suspect/error rates get a higher sampling rate next month. This turns the system from a flat quota into a **risk-based** one — exactly the WCO selectivity philosophy (§4).

> Recommendation: add a "Sampling Plan" object that records confidence, tolerable/expected rates, the derived `n`, the policy floor (6250), the stratification scheme, and the allocation method — and surface achieved precision in the KPI report.

---

## 2. Audit trail & data integrity (ALCOA+ / 21 CFR Part 11)

For a government system, the audit trail is not a nice-to-have; it is the thing that makes the records _trustworthy_. The reference framework is FDA **21 CFR Part 11** + **ALCOA+**, the de-facto global standard for electronic records even outside pharma.

**ALCOA+** = **A**ttributable, **L**egible, **C**ontemporaneous, **O**riginal, **A**ccurate, **+** Complete, Consistent, Enduring, Available. Every record must answer **who, what, when, and why** for every change, the trail must be **tamper-evident**, **enabled by default**, retained for the record's life, and **reviewable**.

Mapping to the app:

- **Attributable** — every event already can carry `actor`; enforce it everywhere (no anonymous writes).
- **Contemporaneous** — the spec's reliance on completion timestamps for working-days/pace (§12.3.1) is exactly right; capture server-free timestamps at event creation, never back-fill.
- **Original / Accurate** — the "reference never copy" rule (§11A.2) directly serves this: one master, no drifting duplicates.
- **Why** — add a `reason` field to every mutating event (reassignment, replacement, override). The spec already does this for some events; make it universal.
- **Enduring / Available** — append-only files + per-month self-containment (§6) satisfy this.

The gap (see gap-analysis §4.6): the `.system/audit/` folder exists but **nothing writes to it**, and saves are not tamper-evident.

---

## 3. Event sourcing (the right backbone for §9–§11A)

The spec's instincts here are correct and align with mainstream **event-sourcing / CQRS** practice:

- **Append-only event store** — never update or delete; only append. This is the immutability ALCOA+ wants and the corruption-immunity §11A wants.
- **Projections / read models** — `distribution.current.json` is exactly a *projection*: a denormalized read model rebuilt by replaying events. The "overall system view computed at read time" (§11A.4) is a projection too.
- **Snapshots** — replaying thousands of events is slow. Standard practice: snapshot state every ~100–500 events and replay only events after the snapshot. For this app, a cached `distribution.current.json` _is_ the snapshot; add a `lastEventId`/sequence number so a reader can verify the snapshot is current and replay only the tail.
- **Idempotency** — projectors must tolerate duplicate/at-least-once delivery via a checkpoint keyed by `(projector, position)`. On a flaky network drive where a save might be retried, give every event a **deterministic `eventId`** and have the projection dedupe on it.

**CQRS separation** — commands (place/reassign/replace) validate business rules then emit events; queries read projections. This maps cleanly onto "supervisors/admins write the distribution log; employees only read current ownership" (§9, §11A.6).

> Recommendation: make the event envelope uniform across all three logs (distribution, per-employee answers, audit): `{eventId, seq, type, ts, actor, reason?, payload, prevHash}`. One replay engine, one dedupe rule, one verifier.

---

## 4. Customs / WCO risk-based selectivity (domain context)

The WCO frames X-ray scanning as **Non-Intrusive Inspection (NII)** governed by **risk-based selectivity**: you don't inspect everything, you inspect by risk score built from importer/exporter history, origin, routing, and prohibitions. National programs run a centralized **Image Control Centre** where officers review radioscopic images to strict standards, and re-scan when environmental conditions degrade image quality. The frontier (per recent WCO News and Indian Customs' IRMS) is **AI/ML image analytics** layered on top of human review.

Implications for this app, which is the **QC layer over that review**:

- The QC sample should be **risk-weighted**, not uniform — over-sample high-risk ports/importers and operators with weak recent performance (ties back to §1's adaptive tightening). This is the difference between "smart government system" and "spreadsheet with extra steps."
- Capture **re-scan / unstudyable reasons** in a controlled vocabulary (image quality, environmental, equipment, data error) so the Findings/Management reports can show _why_ rows fail, not just that they did. This also feeds back into selectivity.
- There is a natural future hook for an **AI pre-screen** that flags likely-suspect images for prioritized human QC — design the study-layer schema so a model-produced layer could slot in alongside human layers later.

---

## 5. Tamper-evidence without a backend (the hard constraint)

The app has **no server**, and the workspace lives on a shared network drive that any user with file access could edit directly. Standard file permissions are therefore _not_ a sufficient integrity control. The established answer is **hash-chained, tamper-evident logs**:

- Each event stores the **SHA-256 hash of the previous event** (`prevHash`), forming a chain. Altering, deleting, or reordering any event breaks the chain at that point and is **detectable by recomputation** — you don't have to trust the storage medium, you verify the chain. (The app already has `hashText` in `fileSystemAccess.ts`; extend it from per-file hashing to per-event chaining.)
- **Merkle trees** improve on plain chains when you want efficient *proof of inclusion* and partial verification of a large log; a per-month Merkle root is a compact integrity fingerprint for that month.
- **Anchoring** the periodic root somewhere outside the file (e.g. a signed, append-only `.system/integrity.json`, or read into a supervisor's exported report) defends against an insider who edits both the log and its checksum. Full external/blockchain anchoring is overkill here, but a **monthly signed root exported into the management report** is a cheap, strong control.

> Recommendation: add `prevHash` to every event and a per-month `integrity.json` holding the head hash / Merkle root, plus a one-click "Verify integrity" action that recomputes and flags any break. This is the feature that lets a government auditor _trust_ a browser-only, server-less system.

---

## 6. Access control & separation of duties

Enterprise QMS practice layers two controls the app should make explicit:

- **RBAC** (role→action matrix) — already present and good.
- **Separation of duties (SoD)** — the same person shouldn't both _do_ work and _approve_ their own exception. The spec already gets the key case right: employee-initiated reassignment needs supervisor approval, supervisor-initiated does not (§4). Extend the principle: an operator shouldn't approve their own replacement justifications, and the monthly-run actor should be recorded distinctly from the reviewers. Record these as **events with actor + approver**, so the audit trail can prove SoD was honored.

---

## 7. Summary of recommended upgrades

| # | Upgrade | Source | Effort | Payoff |
|---|---|---|---|---|
| 1 | Confidence/precision-based sample size beside the 6250 floor | IRS/GAO/PCAOB attribute sampling | Low | Defensible numbers; audit-proof |
| 2 | Formalize spillover as stratified proportional allocation; add risk-weighted "smart mode" | ISO 2859 / Neyman / WCO | Med | Smarter, risk-aware sampling |
| 3 | Adaptive tightening by port/operator history | ISO 2859 normal/tightened | Med | Self-improving QC |
| 4 | Universal event envelope + replay/snapshot/idempotency | Event sourcing / CQRS | Med | Correctness + the §11A guarantee |
| 5 | Write the audit trail (who/what/when/why) for every mutation | 21 CFR 11 / ALCOA+ | Low | Compliance baseline |
| 6 | Hash-chain events + per-month integrity root + verify button | Tamper-evident logging | Med | Trust on a server-less shared drive |
| 7 | Controlled-vocabulary unstudyable/re-scan reasons | WCO NII | Low | Better findings + selectivity feedback |
| 8 | Explicit separation-of-duties on approvals | Enterprise QMS / SoD | Low | Defensible governance |
| 9 | Design study-layer schema to admit a future AI pre-screen layer | WCO AI analytics | Low (design-only) | Future-proofing |

## Sources

- [IRS IRM 4.47.3 — Statistical Sampling Auditing Techniques](https://www.irs.gov/irm/part4/irm_04-047-003)
- [HUD-OIG — Attribute Sampling appendix (sample-size worked examples)](https://www.hudoig.gov/sites/default/files/documents/audit-guides/appendix.pdf)
- [U.S. GAO — Using Statistical Sampling (PEMD-10.1.6)](https://www.gao.gov/products/pemd-10.1.6)
- [PCAOB AS 2315 — Audit Sampling](https://pcaobus.org/oversight/standards/auditing-standards/details/AS2315)
- [OCC Comptroller's Handbook — Sampling Methodologies](https://www.occ.gov/publications-and-resources/publications/comptrollers-handbook/files/sampling-methodologies/pub-ch-sampling-methodologies.pdf)
- [ISO 2859-1:1999 — Sampling by attributes, AQL-indexed](https://www.iso.org/obp/ui/#iso:std:iso:2859:-1:ed-2:v1:en)
- [QIMA — Acceptable Quality Limit (AQL) explainer](https://www.qima.com/aql-acceptable-quality-limit)
- [FDA ALCOA / ALCOA+ data integrity (Beckman summary)](https://www.beckman.com/resources/industry-standards/alcoa)
- [21 CFR Part 11 audit-trail requirements (Assyro)](https://www.assyro.com/blog/audit-trail-requirements-guide)
- [Event Sourcing & CQRS — append-only events, projections, snapshots](https://letsbuildsolutions.com/blog/system-design/event-sourcing-in-practice-building-an-append-only-event-store-with-projections-and-snapshots/)
- [WCO News — AI-based X-ray image analytics (India IRMS)](https://mag.wcoomd.org/magazine/wco-news-109-issue-1-2026/artificial-intelligence-based-x-ray-image-analytics-solution-indias-experience-and-key-takeaways/)
- [WCO RKC General Annex Ch.6 Guidelines (risk management / selectivity)](https://www.wcoomd.org/-/media/wco/public/global/pdf/topics/wto-atf/dev/rkc-guidelines-ch-6.pdf)
- [Crosby & Wallach — Efficient Data Structures for Tamper-Evident Logging (USENIX)](https://static.usenix.org/event/sec09/tech/full_papers/crosby.pdf)
- [Design tamper-evident audit logs (Merkle trees, hash chaining)](https://www.designgurus.io/answers/detail/how-do-you-design-tamperevident-audit-logs-merkle-trees-hashing)
- [Chrome — File System Access API (capabilities & security)](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
