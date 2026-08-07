# App Walkthrough Feedback — 2026-08-07

**Status:** IN PROGRESS — the owner is walking the app end to end as a first-time user. This
document is the running record. Only the Population tab's four phases and the mapping/export
settings screen are covered so far; the owner has explicitly said there is substantially more to
come.

**Test conditions.** Fresh workspace on a local machine (not a network share). Real data: BI +
risk workbooks totalling **500,000+ rows**. Source Excel ≈ **29,129 KB (~28.4 MB)**. Resulting
workspace JSON ≈ **319,165 KB (~312 MB)** — roughly **11× amplification**, possibly more.

## Status — what has shipped

**v60.0 → v63.0 (2026-08-07)**, all on branch `rework/p0-fixes`. Full detail per version in
`docs/edit logs/2026-08-07.md`.

### Measured on the owner's real data (Risk.xlsx + BI.xlsx → 8,000-event month)

| | Before | After |
|---|---|---|
| Distribution save — filesystem ops | **192,063** | **78** |
| Cold load (page reload) — ops | **32,023** | **30** |
| Files on disk | **16,046** | **49** |
| Workspace size | **384.9 MB** | **184 MB** |
| `replacement-index` bucket | 137.7 MB | 15.4 MB |
| Test suite | 1,619 | 1,667 |

> Operation counts are faithful. **Absolute wall-clock is not a browser prediction** — the
> benchmark uses `node:fs`, which has no equivalent of Chromium's `createWritable()` swap-file
> pipeline. That pipeline is where the 3–6 hours actually went, and the op-count collapse is what
> translates.

### Still open

| Item | Why |
|---|---|
| **W7 (CertScan ~30 vs ~30,000)** | Needs the owner's CertScan paste + port names. Code reading cannot resolve a data-shape mismatch |
| **C6 backfill policy** | Product decision, not implementation. Recommendation: **under-fill and report** — silent substitution would misrepresent stratum composition in an audit context |
| **R1 remainder** | Narrower than first reported: per-risk-level counts already existed. Gap is coarse manifest totals instead of the granular risk-vs-BI split already in `ProcessingSummary` |
| **R4, R5** | Not started. R4 was correctly gated behind R1–R3 |
| **W37** | Deferred by the owner: *"this is advanced stuff leave it for last thing"* |

| Item | Status |
|---|---|
| **W17** comma cannot be typed (blocking) | ✅ Fixed — all 10 affected inputs, not just aliases |
| **W20** stage-alias corruption | ✅ Validation added — but see the refutation below |
| **W21** `نوع الحركة` false "no match" | ✅ Fixed |
| **W18** export columns incomplete | ✅ Fixed — 8 fields added |
| **W19** inspector columns | ✅ Resolved — they were always ingested, only unexportable |
| **W26** modal backdrop half-viewport | ✅ Fixed — all 9 modals |
| **W29** approvals page inconsistencies | ✅ Fixed |
| **W40** customizer ~30 min to open | ✅ Fixed — opens immediately |
| **W12** sample total exceeded request | ✅ Cause fixed (config floor + no running total) — **not** the algorithm |
| **W13** CertScan 25% "within not above" | ✅ Verified correct + regression test added |
| **W5** progress 100% then long save | ✅ Fixed — write phases now reported |
| **W34** sign-in not remembered | ✅ Fixed — owner accepted the risk |
| **W2** risk/BI false mismatches | ⚠️ **Refuted** — already canonicalizes `1`↔`سليمة`. Needs a concrete repro |
| **W7** CertScan ~30 vs ~30,000 | ⏳ Needs the owner's CertScan paste + port names |
| **W15/W16** 3–6hr save, 11× disk | ⏳ Phase 3 workstream W3/W4 — specified, not yet built |
| **W24/W27/W28/W30/W38/W39** app-wide slowness | ⏳ Same root cause as W15; W3 fixes both |
| **R1–R5** report requirements | ⏳ Phase 3 workstream W7 |
| **W25** oversight bulk reassign | ⏳ Confirmed a **capability gap**, not performance |
| **W37** ad-hoc upload subsystem | ⏸ Deferred by owner |

> **Two refutations worth keeping visible.** W12's overshoot was **not** the CertScan percentage being
> added on top — the algorithm is provably correct. And W20's alias overlap does **not** exist in
> source; a first attempt at validation flagged the shipped defaults, which was a false positive
> caught before shipping. Both are recorded in full below rather than quietly amended.

---

## How to read this

Every item has three layers, in this order:

1. **Original** — the owner's own words, quoted verbatim, typos and all. This is the primary
   record. If the restatement or the analysis below it turns out to be wrong, **this is what
   survives.**
2. **Restated** — the same complaint in cleaner terms, so it can be acted on.
3. **Analysis** — my diagnosis, marked **[CONFIRMED]** where the mechanism is already established
   in `DATA_SYSTEM_FULL_MAP.md`, or **[HYPOTHESIS]** where it still needs the code read.

Nothing here has been fixed and nothing has been designed. Observation and diagnosis only, per the
owner's instruction.

---

## Root causes (the through-lines)

Most items below are symptoms of four underlying causes rather than independent defects.

| # | Root cause | Symptoms it explains |
|---|---|---|
| **RC1** | **Rows are copied, never referenced** | W6 (30MB population), W16 (312MB total) |
| **RC2** | **Write amplification — verify-by-read-back on every write** | W5 (progress hits 100%, save continues 10–15 min) |
| **RC3** | **One file per distribution event — slow to write *and* slow to read** | W15 (3–6hr save), W24, W27, W28, W30, W38, W39 |
| **RC4** | **CertScan matching failure** | W7 (30 matches vs ~30,000 expected), W13 (CertScan sample shortfall) |
| **RC5** | **Derived state is recomputed per session, never cached across sessions** | W32, W35, W38, W40, W41 |

**RC3 was under-weighted in the first pass.** It was logged as a *write* problem (the 3–6 hour
save). The employee-workspace and reports feedback shows it is equally a *read* problem: rebuilding
current distribution state means folding every event file, so ~9,000 individual file reads. That
single fact explains most of the app-wide slowness the owner reports, and it means W15 and W24/W27/
W28/W38 are **the same defect seen from two directions**, not separate issues.

**Critical items — these produce wrong output, not slow output:** W7, W12, and W20 (if confirmed).
Everything else is speed, size, or UX.

---

# Phase 1 — Import

## W1. Import speed on 500k+ rows — acceptable

**Original:**
> "I ran the app as a new app where my workspace in my loca machine
> first thing i saw was upload BI and risk data and i did
> it took abit to read thats ok they are heavy after all together they come more than 500k row"

**Restated:** Import of both workbooks took noticeable time, which the owner considers reasonable
given 500k+ rows.

**Analysis:** [CONFIRMED] Working as intended. Excel parsing runs in `workbookWorker.ts`, chunked
(risk 5,000 rows, BI 10,000) with yields between chunks. This is the best-behaved stage in the
pipeline. **Severity: none.**

## W2. Risk/BI comparison reports false mismatches

**Original:**
> "then went to second stage or page
> it showed me a comparison, it was great but had flaws such as there is certan process that happen
> to risk data so it match the BI for example replace 1 with سليمة which is what reflect in bi, the
> app didnt do that so it said risk data do not match bi data since bi say سليمة and risk say 1
> minor each no problem"

**Restated:** The comparison flags risk and BI as disagreeing when risk holds a raw code (`1`) and
BI holds its normalized equivalent (`سليمة`). The app knows how to normalize these but apparently
doesn't before comparing.

**Analysis:** [HYPOTHESIS] `normalizeResultValue` (`populationProcessor.ts:305-341`) maps raw L1/L2
codes to the closed set `سليمة | اشتباه | null`. The comparison view appears to run against
un-normalized values. Needs verification of which value the comparison reads.

Owner rates this minor, but it makes the comparison screen untrustworthy — its entire job is telling
you where the sources genuinely disagree, and right now it cannot be believed.
**Severity: minor per owner; moderate in effect.** Note W10 would fix this for free.

## W3. CertScan input sits outside إعدادات المعالجة

**Original:**
> "i go below the comparison i see Certscan instead of having it inside إعدادات المعالجة its outside
> which add extra useless step we can have add it to إعدادات المعالجة minor each"

**Restated:** CertScan port/snippet entry is a separate step below the comparison rather than part
of processing settings, adding a step with no benefit.

**Analysis:** UX placement. CertScan config is workspace-global (`certscan.global.json`), so it
belongs with the other processing configuration. **Severity: minor.**

## W4. Raw-data summary appears at the wrong step

**Original:** *(see W10 — the owner raised this as part of the flow restructure)*

**Restated:** The data/information card shows in Phase 2. The owner wants it on the upload page,
directly beneath the sources.

**Analysis:** Flow ordering; absorbed by W10. **Severity: minor individually.**

---

# Phase 2 — Processing

## W5. Progress reaches 100%, then saving continues for 10–15 minutes

**Original:**
> "it take forever to save the data i see above in the corner it saying saving which is unnessoary
> and i see the loading bar saying 100% complete but it still take forever to save so i go check
> what is happening […] after seeing the bar saying 100% and still it take extra 10-15 minute"

**Restated:** The progress bar completes and a corner indicator says "saving" (which the owner
considers unnecessary), but the operation continues 10–15 minutes past 100%.

**Analysis:** [CONFIRMED] **RC2.** The progress bar measures the *parse*, which does finish. The
*write* is the long pole and is entirely unmeasured. `safeWriteJson` performs: snapshot old →
`.bak`, write `.tmp`, **read `.tmp` back and verify**, write live file, **read live back and
verify**, delete `.tmp`. That is four to five full passes over a 30MB+ file, and the progress model
has visibility into none of them.

So "100%" is honest about the wrong phase. **Severity: high** — it reads as a hang, with no signal
that anything is still healthy.

## W6. 30MB+ population JSON from a much smaller Excel input

**Original:**
> "i see my excel file perfect no edits on it 20kb its size
> and i see json file getting written that is more than 30mb from my 20kb excel why is it that heavy
> even more than the excel thats crazy"

**Later correction from the owner:**
> "last thing i remember was my excel was 29,129kb my json 319,165kb or something like that or way
> more"

**Restated:** The written JSON is far larger than the source workbook. Final figures ~28.4 MB in,
~312 MB out (~11×). The earlier "20kb" was a misremembering, corrected by the owner.

**Analysis:** [CONFIRMED] **RC1.** Contributing factors, in rough order of impact:
- Every processed row carries a `rawRow` field holding **the entire original source row**,
  duplicating the input inside the output.
- JSON repeats every field name on every row; Excel stores columnar, zip-compressed XML.
- The envelope adds per-file metadata (small).

Files ≤512KB are pretty-printed; at this size that path is *not* taken, so indentation is not a
contributor. **Severity: high** — drives W16 and every downstream read cost.

## W7. Only ~30 CertScan matches where ~30,000 were expected

**Original:**
> "finaly i see the data card or information in which it say there is only 30 certscan sample while
> if i do the process myself i get more than 30k"

**Restated:** After processing, the summary reported ~30 CertScan rows. The owner's own manual
process yields more than 30,000.

**Analysis:** [HYPOTHESIS] **RC4.** `matchCertScan` (`populationProcessor.ts:581-633`) buckets
CertScan entries by *normalized port name*, then substring-matches generated snippets against the
cleaned X-ray ID. A three-orders-of-magnitude miss points at the **grouping key** rather than the
matching itself — most likely port-name normalization not agreeing between the pasted CertScan table
and the population rows. Requires reading `groupCertScanByPort` and the normalization applied on
each side.

**Severity: CRITICAL** — wrong output, not slow output, and it cascades directly into W13.

## W8. Three unwanted buttons

**Original:**
> "i see 3 buttons إعادة معالجة المجتمع
> تقرير المعالجة
> تصدير Excel which are totally useless"

**Restated:** These three controls are not useful at this step.

**Analysis:** UX. **One dependency to check before removing:** `تقرير المعالجة` may be the only
surface exposing the processing summary's *dropped-row* counts — the rows silently excluded for
unrecognized L1/L2 values (map Finding 18). If so, removing it hides a real signal.
**Severity: minor.**

## W9. Processing must be triggered manually

**Original:**
> "plus isnt it suppose to automaticly process in phase 2 why i have to initiate it"

**Restated:** Phase 2 should process automatically on arrival rather than requiring a button press.

**Analysis:** [CONFIRMED as behavior] `processPopulation` is invoked from a handler
(`Population/index.tsx:782`). Separately and more importantly: that call runs on the **main thread**,
unlike Phase 1 parsing which is in a worker — already documented as map Finding 3.
**Severity: minor as UX; the main-thread issue behind it is larger.**

## W10. Proposed flow restructure

**Original:**
> "and the data card its suppose to show it in the first page when i upload the sources below it i
> am suppose to see general informtaion from the raw files and in when i press next page its suppose
> to process the data then do comparison in it"

**Restated:** Owner's proposed flow —
1. Upload page shows the sources *and*, below them, general information from the raw files.
2. Pressing "next" triggers processing.
3. The comparison is shown *after* processing.

**Analysis:** A coherent alternative flow, not a set of tweaks. It absorbs W4 and W9, and resolves
**W2 for free** — a comparison run after processing would compare normalized values on both sides.
**Severity: moderate** — a design conversation, not a fix.

## W11. معاينة المجتمع النهائي is unwanted

**Original:**
> "and in phase 2 it show me معاينة المجتمع النهائي which show me some samples its useless to me i
> dont want to see them its not useful for me to see them directly like this"

**Restated:** The final-population preview showing sample rows isn't useful at this step.

**Analysis:** UX. Worth checking whether the preview forces a read the step wouldn't otherwise need
— if so, removing it is also a small performance win. **Severity: minor.**

---

# Phase 3 — Sample selection (المرحلة 3: اختيار العينة حسب المستويات)

**Owner's overall verdict on this phase: "Great."** The level-based structure works. The items below
are specific defects within a phase the owner otherwise likes — worth preserving when changes are
made.

## W12. Requested 7,000, received 9,000

**Original:**
> "i go to next page
> which is Great the المرحلة 3: اختيار العينة (حسب المستويات) on issue i have my numbers ready what
> i want or whatever for example i put sample my total is 7000 sample
> i have for example for each level i want to have 25% certscan
> […]
> i press سحب العينات وحفظها i get the resoult which is 9000 how the hell it became 9000 i dont know
> i wanted 7000"

**Restated:** With a requested total of 7,000 and 25% CertScan per level, the draw returned ~9,000 —
about 2,000 over the request.

**Analysis:** [HYPOTHESIS] Hamilton apportionment distributes a *fixed* total, so exceeding the
request shouldn't be possible on that path alone. **The owner's own hypothesis is the strongest
available** (see W13): the CertScan percentage is being applied **additively on top of** the
requested total rather than as a split *within* it. 25% of 7,000 = 1,750, in the right neighbourhood
for a ~2,000 overshoot.

The legacy draw path uses `splitCertScanQuota` (a genuine nested split); the stage-based path uses a
different `exactCertTarget` routine that has **not** been traced.

**Severity: CRITICAL** — a sampling engine returning a different size than requested undermines
every statistical claim built on the sample. Unlike the performance items, this produces wrong
output.

## W13. CertScan drawn was 20 and 10 despite a 25% request

**Original:**
> "and i see certscan its 20 10 sample only, i want 25% yes but if its not availabel it backfil i am
> not sure its applied here or no, and the 25% is suppose to be part of the number i require not
> Above it"

**Restated:** Requested 25% CertScan per level, received 20 and 10. Two distinct points raised:
(a) does backfill from NonCertScan happen when CertScan is short? (b) **the CertScan percentage
should be part of the requested total, never additional to it.**

**Analysis:** [CONFIRMED as a consequence] This is **downstream of W7, not a separate defect.** With
only ~30 CertScan rows in the population, no 25% target is reachable. Fixing the matching likely
resolves the symptom entirely.

The backfill question remains open on its own merits — spillover exists for *ports*, but whether
CertScan→NonCertScan backfill exists is not established.

> **REQUIREMENT, stated by the owner and recorded verbatim above:** the CertScan percentage is
> **part of** the requested total, never above it. This is also the likely explanation for W12.

**Severity: resolves with W7; the backfill question and the requirement both stand independently.**

## W14. RNG seed is surfaced in the main flow

**Original:**
> "i see a رمز التوزيع العشوائي - يمكن تعديله لإعادة إنتاج نفس العينة which is great but i dont which
> to see it maybe in the settings إعدادات المعالجة
> it be there and change everything it would be better"

**Restated:** The seed control is valued but belongs in إعدادات المعالجة rather than the primary
path.

**Analysis:** UX placement — same theme as W3, internals exposed at a decision step. Note the owner
explicitly values the *capability* ("which is great"); this is about location, not removal.
**Severity: minor.**

---

# Phase 4 — Distribution (توزيع العينة)

**Owner's overall verdict on this phase: "its great"** — apart from the save.

## W15. `تطبيق وحفظ التوزيع التلقائي` takes 3–6 hours

**Original:**
> "i go to next phawse توزيع العينة
> its great
> an issue is when i press تطبيق وحفظ التوزيع التلقائي
> It take about 3-6 hours saving
> it save raw by raw i dont know the issue, i had a thugh maybe since i have multiable employees it
> go to each employee file save a row and keep like that so i thought if its like this is dump why
> not go 1 employee finish it real fast go to next and like this"

**Restated:** Saving the automatic distribution runs 3–6 hours, appearing to save row by row. The
owner hypothesises it cycles per-employee per-row, and suggests completing one employee fully before
moving to the next.

**Analysis:** [CONFIRMED] **RC3.** Distribution writes **one file per event** —
`distribution.events/{eventId}.json`. For a ~9,000-row sample that is ~9,000 separate files, and
`writeImmutableDistributionEvent` (`distributionEventStore.ts:41`) reads any existing file *before*
writing and re-reads to verify *after* — roughly **three filesystem round-trips per assignment**
(~27,000 total), batched only 4 at a time.

The owner's read of the symptom is directionally correct: it is per-event, not per-employee.

> **DESIGN TENSION — preserve for discussion, do not quietly "optimize" this.** One-file-per-event
> is deliberate. Unique filenames are precisely what lets independent writers on different machines
> avoid collisions without a backend. Batching by employee would be dramatically faster and would
> trade away part of that guarantee. This is an architectural decision, not a straightforward
> optimisation.

**Severity: CRITICAL** — 3–6 hours is not a usable workflow.

## W16. Total workspace JSON ≈ 312 MB from ≈ 28.4 MB of Excel (~11×)

**Original:**
> "now finally after about 6 hours its done saving
> i go check my json files it created size more than 200mega i check my origianl excels 20mega max
> why the hell is thise 10x i dont know"

*(Figures later refined by the owner to 29,129 KB in / 319,165 KB out — see W6.)*

**Restated:** The workspace after distribution is roughly 11× the size of the source Excel.

**Analysis:** [CONFIRMED] **RC1**, compounding. A single sampled row is persisted roughly **five
times**:
1. `population.final.json` (with its embedded `rawRow`)
2. `sample.master.json` — stores `rows[]` as **full copies**, not references
3. `distribution.current.json` — each entry embeds a `row`
4. `main.samples.json` — copies those entries
5. `{username}.samples.json` — copies each employee's slice again

Plus, independent of the sample: `risk.raw.json`, `bi.raw.json`, the copied source `.xlsx` binaries,
and any `.superseded.json` archives.

**Already-established relevant finding:** the source `.xlsx` copies, the `.superseded.json` archives,
and `main.samples.json` all have **no reader anywhere in the app** (map Theme 0). Storage is being
spent on artifacts nothing can currently surface. **Severity: high.**

---

# Settings — إعدادات الربط والخرائط والتصدير (mapping & export)

**Caveat from the owner, verbatim:**
> "and way more لم يتم العثور على تطابق واضح ignroe it i didnt upload the correct files i just wanted
> to see it to tel u we have more columns and stuff"

So the widespread "no match" results are **not** defects — wrong test files were uploaded
deliberately to expose the screen. Ignore those, **except** W21, where "no match" is structurally
expected and the UI still presents it as a failure.

## W17. Commas cannot be typed into the alias field — blocking

**Original:**
> "if i want to add a new sheet or name its suppose to be in this format
> معرف الأشعة, معرف الاشعة, رقم صورة الأشعة, رقم صورة الاشعة, معرف الأشعة, معرف الاشعة, XRAY_SCAN_ID
> the thing is i cant type , at all in the filed"

**Restated:** Aliases must be entered comma-separated, but the `,` character cannot be typed into
the field at all.

**Analysis:** [CONFIRMED as reported] The input rejects the exact delimiter its own format requires,
so a multi-alias entry cannot be created through the UI. Needs the field's key/input handler read —
likely an over-broad character filter or a comma-keyed tokenizer swallowing the keystroke.

**Severity: BLOCKING** — the feature is unusable as designed. Alias configuration is how the app
absorbs new sheet/column naming, so this also blocks W22 entirely: the owner cannot test their real
column set until it's fixed.

## W18. Export column list is incomplete relative to the actual row shape

**Original:**
> "one thing in اعمدة التصدير
> it show
> تحكم في تفعيل أو تعطيل، ترتيب، وتغيير عناوين الأعمدة المخرجة عند تصدير العينات لملفات Excel."

followed by the listed columns: `stage`, `xrayImageId`, `xrayEntryDate`, `portCode`, `portType`,
`portName`, `declarationNumber`, `plateOrContainerNumber`, `chassisNumber`, `xrayLevelOneResult`,
`xrayLevelTwoResult`, `movementType`, `reportNumber`, `targetedByRiskEngine`, `riskMessage`.

**Restated:** The export column list offers 15 fields; the processed row carries more.

**Analysis:** [CONFIRMED by comparison] Missing from the export list: `declarationDate`,
`certScanStatus`, `certScanSnippet`, `originalCertScanSnippet`, `biEnrichmentStatus`, `biMatched`,
`biFilledFields`, `sourceSheetName`, `sourceRowNumber`.

Two specifics worth calling out: **`declarationDate` is missing while `declarationNumber` is
present**, and **no CertScan field is exportable at all** — awkward, given CertScan status is a
primary stratification axis for the sample. **Severity: moderate.**

## W19. موظف المستوى الأول / موظف المستوى الثاني — mapped but unaccounted for

**Original:** *(from the discovered-columns listing the owner pasted)*
> "موظف المستوى الأول
> لم يتم العثور على تطابق واضح
> موظف المستوى الثاني
> لم يتم العثور على تطابق واضح"

**Restated:** Level-1 and level-2 *inspector* columns exist as mappable risk fields, but appear
nowhere in the export column list.

**Analysis:** [HYPOTHESIS — needs verification] They also do not appear in the documented processed
row shape (`data-system-report.md`'s population dictionary, nor Part I of the full map). Three
possibilities with very different consequences:
1. Mapped, ingested, simply not exportable → the W18 fix covers it.
2. Mapped but **dropped during processing** → original inspector attribution is discarded at ingest.
3. The documented row shape is incomplete and they do survive → the map needs correcting.

**Why this matters more than it looks:** these identify *who performed the original L1/L2 inspection*
in the source system. That is distinct from the app's own QC reviewers (`reviewerKpis`,
`EmployeeProfile`), which are deliberately out of executive-report scope. If the source inspector is
dropped at ingest, the app can never attribute an original inspection decision to the person who
made it. **Severity: unknown until resolved; potentially high.**

## W20. `المستوى` alias list includes the L1/L2 result columns

**Original:** *(from the discovered-columns listing the owner pasted)*
> "المستوى
> نتيجة المستوى الثاني للاشعة، نتيجة المستوى الأول للاشعة، STAGE، نتيجة المستوى الثاني، نتيجة المستوى الأول"

**Restated:** The stage/level field's configured aliases include the L1/L2 *result* column names,
listed **before** `STAGE`.

**Analysis:** [HYPOTHESIS — needs verification] `المستوى` is the categorical risk level (1st–4th) —
established previously as **categorical, not a severity scale**. The L1/L2 result columns hold
`سليمة`/`اشتباه`, a different domain entirely. With first-match-wins alias resolution and the result
aliases ordered ahead of `STAGE`, a workbook containing both could populate `stage` from an
inspection result rather than the real level column.

If that happens it fails **silently**: `getStageKey` would fail to normalize the value and the row
would fall into an unmapped stage, raising nothing. Needs the resolution order and match logic read
before it's called a defect.

**Severity: unknown; potentially CRITICAL if confirmed** — stage drives the entire level-based
sampling design, so this would corrupt stratification invisibly.

## W21. "No match" reported for a field that is not column-derived

**Original:** *(from the discovered-columns listing)*
> "نوع الحركة
> لم يتم العثور على تطابق واضح"

**Restated:** `نوع الحركة` is reported as unmatched among the risk columns.

**Analysis:** [CONFIRMED] Expected, and **not** a mapping failure. `movementType` is derived from the
**sheet name**, not a column — `detectMovementType` classifies each sheet by name pattern, which is
exactly why the owner's workbook shows `بري، بحري، افراد، عبور`. The screen reports a structurally
impossible match as though it were a user problem.

**Severity: low as a defect, but actively misleading** — it invites hunting for a column that should
not exist, and it trains users to dismiss the warnings that are genuine.

## W22. Real data carries more columns than the app maps

**Original:**
> "i just wanted to see it to tel u we have more columns and stuff"

**Restated:** Production data has more columns and sheets than the current mapping covers.

**Analysis:** This is the requirement behind W17. Alias configuration is the intended mechanism for
absorbing new naming, and it is currently unusable because the delimiter cannot be typed.
**Severity: moderate; gated entirely on W17.**

---

# Employee Workspace — صور الأشعة المحالة

## W23. إدارة بيانات الأشعة overall verdict

**Original:**
> "إدارة بيانات الأشعة
> is so heavy and freeze and slow
> Now done with all notes on إدارة بيانات الأشعة for now we will return to it later"

**Restated:** Closing verdict on the Population tab before moving on — heavy, freezes, slow.

**Analysis:** Summary of W5, W6, W7, W9, W15, W16. The freeze specifically traces to W9's
main-thread `processPopulation` (map Finding 3). **Severity: high.**

## W24. Sample takes forever to load

**Original:**
> "we should sign in as an employee and start working on my sample i got from tab
> صور الأشعة المحالة
> it takes forever to load my sample"

**Restated:** Loading an employee's own sample list is very slow.

**Analysis:** [CONFIRMED] **RC3, read side.** The employee view calls
`loadOrDeriveDistributionCurrentForRead`. When the cache misses — and it misses after *any* event
append — the fold re-reads **every** file in `distribution.events/`, so ~9,000 individual file reads
before a single row renders.

Phase A gating did its job here: the employee is *not* loading the population. The cost is entirely
in rebuilding distribution state. **Severity: high.**

## W25. Cannot bulk-assign a filtered subset to another employee

**Original:**
> "once it load and i strart working for example i want to assign all my samples to another employee
> or part of it or certan catagory i filter to i am not able to do that or it take alot of time to
> open the popup"

**Restated:** Wants to filter to a category and reassign all or part of the filtered set in bulk.
Either the capability is missing or it is too slow to use.

**Analysis:** [NEEDS VERIFICATION] Two separable questions: (a) does filter-then-bulk-reassign exist
at all in this view? (b) if it exists, is it only the popup latency (W27) making it unusable? The
owner's phrasing — *"i am not able to do that **or** it take alot of time"* — suggests they could not
tell which. Must be resolved before this is scoped as either a bug or a feature.
**Severity: unknown — capability gap or performance, not yet determined.**

## W26. Modal backdrop covers only half the screen

**Original:**
> "the popup show in the middle of the screen and it put a black transpartent background which fill
> half othe screen not all of it which is a bad design"

**Restated:** The modal's translucent backdrop covers roughly half the viewport instead of all of it.

**Analysis:** [NEEDS VERIFICATION] Almost certainly a CSS containment issue — the overlay is
positioned within a scrolled or transformed ancestor rather than the viewport, so it covers the
container instead of the screen. Common cause: an ancestor with `transform`, `filter`, or
`contain` creating a containing block for `position: fixed`. Cheap to fix once located.
**Severity: low effort, visible polish.**

## W27. استبدال العينة popup takes 2–3 minutes to open

**Original:**
> "for example i want to replace my sampel i press استبدال العينة
> it take about 2-3minutes to open the popup which is at that time i forget what i want do, why its
> not the moment i click it it open"

**Restated:** The replace-sample dialog takes 2–3 minutes to appear. The owner notes they've lost
their train of thought by the time it does.

**Analysis:** [CONFIRMED] **RC3, read side — and this one is a deliberate correctness measure
colliding with an unusable cost.** The map documents that `XrayReferrals.tsx` (~line 687)
intentionally calls the **authoritative** `loadOrDeriveDistributionCurrent`, *not* the cached
`...ForRead` variant, immediately before a write-path action — with an inline comment explaining
this avoids double-assign and orphan states.

That is the right call for correctness. But "authoritative" means a full re-derive: ~9,000 file
reads before the dialog can open.

> **DESIGN TENSION — do not fix this by switching to the cached read.** The fresh read exists
> specifically to prevent double-assignment. Making the popup instant by trusting the cache would
> trade a correctness guarantee for responsiveness. The real fix is making the fold cheap (RC3), not
> skipping it.

**Severity: high** — and the naive fix is actively dangerous.

## W28. Every استبدال / احالة triggers a full sample reload

**Original:**
> "when i press استبدال or احالة it refresh my sample which takes forever to load"

**Restated:** Completing a replace or referral action reloads the whole sample, incurring the full
load wait again.

**Analysis:** [CONFIRMED] **RC3.** Appending an event invalidates the derived cache, so the next read
re-folds all ~9,000 event files. The user therefore pays the full rebuild **once per action**, not
once per session — which is why the app feels progressively worse the more work you do in it.
**Severity: high.**

## W29. اعتماد الطلبات is inconsistent or buggy

**Original:**
> "as a supervisor i am suppose to accept requests from اعتماد الطلبات
> the page is not consistatn its design or there is bugs in it"

**Restated:** The supervisor approvals page has design inconsistencies, possible bugs, or both — not
yet pinned down.

**Analysis:** [NEEDS DETAIL] Too general to diagnose. Worth noting for context that the underlying
approval *logic* is the most defensive code in the codebase (map: fresh reload, replay guard,
ownership check against freshly-derived state, cross-reviewer guard, first-wins reconciliation) — so
correctness bugs here are less likely than presentation ones. **Requires a follow-up pass with
specifics.** **Severity: unknown.**

---

# App-wide behaviour

## W30. Slowness is app-wide, not page-specific

**Original:**
> "and btw data taking forever to load is not limited to this page its for the entire app all pages
> that require data take forever to load and very slow"

**Restated:** Every page that requires data is slow, not just the ones already described.

**Analysis:** [CONFIRMED] **RC3 + RC5.** Any surface needing distribution state pays the full fold.
Any surface needing population pays a full parse. Nothing survives across sessions.
**Severity: high — this is the headline complaint.**

## W31. Owner's architectural hypothesis

**Original:**
> "so i though it might be the json file size for everything is huge plus its very complex linking
> and not making use of features we can"

**Restated:** Owner's own diagnosis — oversized JSON, over-complex linking between files, and
unused platform capabilities.

**Analysis:** **Substantially correct on all three counts.** File size is RC1 (a sampled row is
persisted ~5×). "Complex linking" is the derived-file chain (events → log projection → current cache
→ main mirror → per-employee mirror), where three of those five have no reader at all. "Features we
can [use]" is RC5 — and notably the app's own performance proposal already reaches the same
conclusion, including IndexedDB as an acceleration cache.
**Recorded as an owner diagnosis that the code supports.**

## W32. Boot splash implies data is loaded, but tabs still load afterwards

**Original:**
> "when i sign in it show a page that tell me what data is loading and loaded then opens the app the
> thing is even after it open the app i see صور الأشعة المحالة still loading isn't it suppose to
> loaded all data once i signed in into browser memory or indexeddb?"

**Restated:** The boot progress screen reports data as loaded, but opening a tab starts a fresh load.
The owner expected sign-in to warm memory or IndexedDB.

**Analysis:** [CONFIRMED] **RC5, and partly a truthfulness problem.** `bootProgress.ts` is a pub/sub
checklist that reports on workspace connection, identity, and permission checks — **not** business
data. Tabs load their own data on mount. So the splash isn't lying about what it tracks; it's
implying a completeness it never had.

Two separable issues: **(a)** the splash communicates the wrong thing, and **(b)** the owner's
expectation — warm the data once at sign-in — is a legitimate design ask that the app currently
doesn't do at any layer. **Severity: moderate as UX; the underlying ask is RC5.**

## W33. Refresh button only refreshes the sample

**Original:**
> "the refresh button only refresh sample i want to refresh everything all data and everrything as
> if i refreshed the page"

**Restated:** Wants a true full refresh equivalent to reloading the page, not a partial one.

**Analysis:** [NEEDS VERIFICATION] The mechanism exists: `dataRefreshSignal.ts` distinguishes
`"manual"` (subscribers may discard caches wholesale) from `"periodic"` (re-read without resetting
caches). So a manual signal *should* already mean "drop everything". Needs a check of which
subscribers actually honour it — likely not all surfaces are subscribed.
**Severity: moderate; mechanism present, coverage incomplete.**

## W34. Sign-in is not remembered between sessions

**Original:**
> "and it seems indexeddb doesnt save my account sign in info so i have to sign in everytime"

**Restated:** Must sign in on every visit; the owner expected IndexedDB to persist it.

**Analysis:** [CONFIRMED — but this one is deliberate, not a defect.] IndexedDB stores **only the
workspace directory handle**. The session lives in `sessionStorage` (`xray_auth_session_v1`), which
clears when the tab or browser closes **by design** — logged as SEC-02, with a 7-day TTL as a
secondary guard.

> **This is a security decision, not an oversight.** The app has no backend, so all role and
> permission checks run client-side and are advisory. A longer-lived session widens the window in
> which an unattended machine is an authenticated one. Changing it is a **policy** conversation
> (`SECURITY_MODEL.md`), not a bug fix.

Separately, the File System Access API contributes: `WorkspaceProvider` requires
`queryPermission({mode:"readwrite"}) === "granted"` or forces a manual reconnect gesture — a browser
constraint the app cannot remove.
**Severity: real friction; requires a deliberate security-policy decision.**

---

# Population tab, revisited (إدارة بيانات الأشعة)

## W35. Every sign-in reopens the tab and reloads from zero

**Original:**
> "i as an admin who aready went through the process of uploading and processing data
> why every time i sign in it opens page إدارة بيانات الأشعة and start loading the data from 0 why
> not once its processed and finished its suppose to later on whenever i open the app to process it
> as pivot table or static information for levels and prots for example port A has this number of
> data instead of reprocessing everything and loading all raw data into the instense which make the
> app lag and slow
> everytime i sign in it reporcess everything why"

**Restated:** Once a month is processed, subsequent sessions should read precomputed summaries
(counts per level, per port) rather than reloading and reprocessing raw data.

**Analysis:** [CONFIRMED as behaviour] **RC5** — and the owner has independently arrived at the
design the app's own architecture proposal already specifies.

Two things make this more tractable than it looks:
1. **`processing.summary.json` already exists** and is already read *instead of* the population in
   some paths — the archive-status tiles use a manifest-trust shortcut for exactly this reason. The
   pattern is established; the Population tab landing just doesn't use it.
2. **Phase C's index design is literally this.** Its `PopulationPartitionIndex` carries
   `countsByPort` and `countsByPortStage`, explicitly so allocation and capacity questions can be
   answered **without reading any row file**. The owner's "port A has this number of data" is that
   field by name.

**Severity: high — and it's the single strongest argument yet for Phase C, arrived at independently
from the user side.**

### W35a. Clarified requirement — a finished month never loads raw or population again

**Owner's clarification, verbatim:**
> "إدارة بيانات الأشعة once data is processed and finished adn إدارة بيانات الأشعة it never load the
> population or raw it read the static the final output it doesnt recreate it or reprocess it since
> its already done and sit in stone as they say"

**This is stronger than W35 as originally recorded**, and it should be read as the requirement rather
than as a preference. W35 said "prefer summaries over reloading". W35a says:

> **Once a month is processed, the Population tab must NEVER read `population.final.json`,
> `risk.raw.json`, or `bi.raw.json` again. It reads the persisted static output only. It does not
> recreate, re-derive, or reprocess anything. The result is set in stone.**

**Consequences worth stating explicitly:**

- The static output must be **complete enough to render the tab with zero row access**. Whatever the
  tab displays after processing — counts by level, counts by port, status, totals — has to be *in*
  the persisted aggregate. If any displayed figure isn't captured there, the tab is forced back into
  reading rows and the requirement is broken. **Defining that field set precisely is the first
  design task**, and it is easy to under-specify.
- **Reprocessing becomes explicitly opt-in**, not something that can happen as a side effect of
  opening a tab. This aligns exactly with W36's auto-lock: locked month → aggregates immutable →
  nothing to recompute.
- Row-level access doesn't disappear; it moves behind **deliberate** actions (Browse, drawing a
  sample, generating a report), which already have or need their own paged paths.
- This makes the aggregate file **load-bearing**. If it's missing or corrupt, the tab has nothing to
  fall back on but the rows it's forbidden to read. It needs a defined recovery path — most likely
  "detect, tell the user, offer explicit reprocessing" rather than silently reloading rows, which
  would quietly reintroduce the slowness.

## W36. Month should auto-lock once distribution is done

**Original:**
> "i want once for a month i finish uploading and distubing sample usign إدارة بيانات الأشعة it get
> locked same as phase 3 in which it auto lock level required numbers and admin can unlock it if he
> wants"

**Restated:** After upload and distribution complete, the month should lock automatically — mirroring
Phase 3's auto-lock of level numbers — with an admin unlock available.

**Analysis:** [MECHANISM EXISTS, POLICY MISSING] The month-lock gate is already implemented and
enforced: `ensureMonthWritable` guards writes, and the Archive tab already has close/reopen with
`handleMonthLockConfirm`. What's missing is the *automatic* trigger on distribution completion and
the admin-unlock affordance in this tab.

This is a small change with a real safety benefit: it also closes the window in which a reprocess
could overwrite a population that a drawn sample already depends on (the TOCTOU guard exists, but
prevention beats detection). **Severity: moderate; low implementation cost.**

## W37. Separate ad-hoc population upload for assignment only

**Original:**
> "plus as admin sometimes i have differnt sampes or data i want to assing to employees for exampe i
> have excel file with different population but i want to assign ints samples to emploees i CANT so
> i want another page not إدارة بيانات الأشعة ment to upload excel datait read same column names from
> إدارة بيانات الأشعة and mapping but i can manully process it using something like univer or library
> to mimic excel or i can write conditionall columns or forumlas like powerquery or SQL or exce
> formula this is advanced stuff leave it for last thing"

**Restated:** A separate page for uploading an arbitrary Excel population and distributing its
samples to employees, reusing the existing column mapping, with manual/spreadsheet-style processing
— a grid component (Univer or similar), or conditional columns/formulas in the style of Power Query,
SQL, or Excel formulas.

> **Owner's own priority, verbatim: "this is advanced stuff leave it for last thing."**

**Analysis:** This is a **genuine new subsystem**, not a change to an existing one — a second ingest
path, an expression/formula engine, and a spreadsheet UI. It would need its own spec and its own
plan; it should not be folded into any of the fix workstreams.

Worth noting for whenever it is picked up: the *distribution* half already exists and is
population-agnostic in principle, so the real scope is ingest + manual transformation, not
assignment. **Severity: deferred by owner; scope is large.**

---

# Reports (التقارير)

## W38. Report page takes forever to load its cards

**Original:**
> "when i go to التقارير it take forever it load data and reflect it in the cards like this
> 386 صورة
> 386 عينة"

**Restated:** The reports page is slow to load the data behind its summary cards.

**Analysis:** [CONFIRMED] **RC3 + RC5.** Reports load population + sample + distribution + all
employee answer files, then build. The distribution portion pays the full event fold. Note the
figures the owner cites are small (386) — **the slowness is not proportional to what's displayed**,
it's the cost of assembling the inputs. **Severity: high.**

## W39. Report export takes ~30 minutes, then downloads

**Original:**
> "when i press تصدير for the report it keeps loading and loading for about half an hour then it
> downloads html report
> i want it once i click on it it download it"

**Restated:** Export runs ~30 minutes before producing the HTML file. The owner expects a click to
download immediately.

**Analysis:** [CONFIRMED] **RC3 + RC5**, plus map Finding 7: `buildReportModel()` is **one
synchronous, non-yielding block** — row build, decision-fact-table explosion, aggregates including an
O(rows × 15) cross-team matrix, and reviewer KPIs — all completing before any edition's slide loop
begins yielding.

On the owner's expectation: an instant download requires the model to already exist when the button
is pressed, which is precisely RC5 (persist and reuse derived state). **Severity: high.**

## W40. Customization popup takes ~30 minutes to open

**Original:**
> "when i want to customize the report i press the cusotmization button it then wait half an hour it
> open a popup"

**Restated:** The report customization dialog takes ~30 minutes to appear.

**Analysis:** [CONFIRMED as pattern] Same shape as W27: **the dialog builds its data before it
renders.** A customization dialog is choosing *options*; it should not need the built model to
display choices. Unlike W27, there is no correctness argument here — nothing about showing options
requires fresh authoritative state.

**This is the cheapest high-visibility fix in the whole walkthrough:** render the dialog first,
compute on confirm. **Severity: high impact, low effort.**

## W41. Owner's closing summary

**Original:**
> "the app is very heavy and slow and unopitmized, it loads unessoary data doesnt save it in
> indexeddb and doesnt make use of stuff like pivot table then save the output and unload the pivot
> keep the outputor any smart way to manage data and speeds"

**Restated:** The app loads unnecessary data, doesn't cache to IndexedDB, and doesn't use
compute-once-then-discard patterns (build an aggregate, keep the output, release the source).

**Analysis:** **This is RC5 stated as a design principle, and it matches the app's own architecture
proposal.** That proposal's decision summary already says: load no heavy dataset at startup; load
only for the active workflow; return pages rather than complete arrays; keep a bounded LRU of
partitions; and use **IndexedDB only as an acceleration cache, never as the source of truth**.

The owner's "pivot then save the output and unload the pivot" is the same idea as Phase C's
`countsByPort` / `countsByPortStage` index — compute aggregates once at write time, then answer
questions from the index without touching rows.

> **Recorded as convergence:** the owner reached the same architecture from usage that the proposal
> reached from analysis. That is the strongest available argument for actually scheduling Phase C
> rather than leaving it proposed.

---

# Workspace structure

## W42. Folder numbering is inconsistent

**Original:**
> "its not consistant not all folders are numbered"

**Restated:** Some folders carry numeric prefixes and some don't, with no obvious rule.

**Analysis:** [CONFIRMED — but there is a latent rule, it's just never written down.]

Sorting the actual tree by whether it's numbered:

| Numbered | Unnumbered |
|---|---|
| `1-population` … `6-templates` (roots) | `feedback/` (root) |
| `1-raw`, `2-processed` (under `{month}`) | `designs/` (under `4-reports`) |
| `1-main`, `2-employees`, `3-approvals` | `audit/`, `backups/`, `notifications/`, `user-presets/`, `powerbi-export/` (under `5-system`) |

The pattern: **numbering appears wherever the folders represent ordered pipeline stages**
(raw → processed; main → employees → approvals), and is absent wherever they are an **unordered
collection of unrelated concerns** (audit, backups, notifications, presets, exports).

That is a defensible convention. The problem is that it is **implicit** — nothing states it, so it
reads as carelessness, and the next person adding a folder has no rule to follow.

**Two genuinely separate issues here, which should not be conflated:**

1. **`feedback/` is a real defect**, not a convention question. It sits unnumbered at the *root*,
   breaking the `1-`…`6-` sequence, and it exists only because `feedbackStorage.ts` bypasses
   `getSystemRoot()`. It was meant to live under `5-system/`. Fixing it is a bug fix.
2. **Everything else is a documentation gap**, not a structural one. Writing the rule down —
   *"numeric prefixes mark ordered stages; unordered collections stay unprefixed"* — resolves the
   inconsistency at zero risk.

**Constraint on any renaming.** Renaming existing roots is a workspace migration, and the migration
machinery (`migrateWorkspaceSchema`) is **built but wired to nothing** — no UI path invokes it
(map Theme 0). So today there is no working way to migrate an existing workspace to a renamed
layout. Any renaming proposal has to either wire that up first or accept indefinite dual-path
readers. **Renaming is therefore much more expensive than it looks; documenting the rule is nearly
free.**

**Severity: low as a defect (except `feedback/`, which is moderate); the documentation gap is worth
closing regardless of whether anything is renamed.**

---

# Report requirements (إدارة التقارير)

The owner specified the intended content of each report edition. These are **requirements**, not
defect reports — recorded here because they define what the reports are *for*, which the map only
described structurally.

**Architectural note that applies to all of them:** the six executive-family editions already share
a single `buildReportModel()`, so they *cannot* disagree on their numbers. Any restructuring should
preserve that. Conversely, the map found **three independent per-port accuracy folds** with
different denominators — directly relevant below, since several of these requirements ask for
per-port figures that must agree across reports.

## R1. تقرير العينة (Sample report)

**Original:**
> "تقرير العينة its suppose to show the population count before and after editing for each risk and
> bi
> and risk and bi in the pipline merge into the risk which sample get taken from so we have 1 page
> show bi and risk seperate
> and second page show the final which is risk
> then it show sample coutn for each port
> and then sample count for each level of risk thats it
> soem ideas are already inmplemented in التقرير التنفيذي"

**Restated — the specified structure:**
1. **Page 1** — population counts *before and after processing*, for risk and BI **separately**.
2. **Page 2** — the final merged population (BI merges into risk; the sample is drawn from this).
3. Sample count **per port**.
4. Sample count **per risk level**.
5. Nothing further — the owner marked the scope closed ("thats it").

**Analysis:** The "before and after editing" counts are the interesting requirement — this is
exactly what `processing.summary.json` already captures (excluded, deduplicated, BI-matched,
invalid-result-rows removed). So the data exists; the question is whether the report reads it or
recomputes it.

**Note for W35a:** every figure listed here is an aggregate. None of it requires row access — so
this report is a natural fit for the precomputed-static-output model, not an exception to it.

## R2. تقرير التوزيع (Distribution report)

**Original:**
> "for
> تقرير التوزيع
> it suppose to show the sample per port and each page represnt a differnt port in it i see all
> employees and how many they took
> and section 2 is per level"

**Restated:**
- **Section 1:** one page **per port**; each page lists all employees and how many samples each took.
- **Section 2:** the same, **per level**.

## R3. تقرير الإدارة (Management report)

**Original:**
> "تقرير الإدارة
> is suppose to show our progress per employee this employee finished 50% of the sample in port A
> employee B replaced 100 sample in this port and that for reason and it show reasons
> employee C reassigned this number of sample
> and all of this in 2 views per port in section 1 and per stage or level in section 2
> now thingking about it make it secton 1 per stage and 2 per port"

**Restated — per-employee progress and activity:**
- Completion progress (e.g. "finished 50% of the sample in port A")
- Replacement counts **with reasons shown**
- Reassignment counts
- **Section 1: per stage/level. Section 2: per port.** *(The owner revised this mid-sentence — the
  final instruction reverses the original order.)*

**Analysis:** The underlying data exists — replacement and reassignment are distribution event
types, and referral/replacement requests carry reasons in the employee answer files. Completion
percentage derives from answer status against assigned count.

> ⚠️ **Open question — R3 vs R2 ordering.** The owner's revision ("section 1 per stage and 2 per
> port") directly follows the **تقرير الإدارة** description, so it most likely applies there. But
> R2 was specified in the opposite order (ports first, levels second). **Either R2 and R3
> deliberately differ, or the revision was meant to apply to both.** This needs one clarifying
> question before either is built — getting it wrong means rebuilding both reports' section
> structure.

## R4. التقرير التنفيذي (Executive report)

**Original:**
> "التقرير التنفيذي
> is suppose to be the mix of جاهز
> تقرير العينة
> and تقرير التوزيع and تقرير الإدارة"

**Restated:** The executive report is a composite of R1 + R2 + R3.

**Analysis:** Structurally this is already half-true — all executive-family editions share
`buildReportModel()`, so a composite doesn't require a new data path, only new composition. The
practical question is *selection*: which parts of each constituent report appear, and at what depth.
"A mix of the other three" is not yet a spec — it needs the specific sections named.

**This is also where the three-accuracy-folds finding bites.** If the executive report shows a
per-port figure drawn from one fold and the distribution report shows one drawn from another, the
same port will carry two different numbers across two reports the owner considers views of the same
thing.

## R5. Document editions show the underlying rows

**Original:**
> "and the document version show the samples itself and information port name level answers date ETc
> per employee"

**Restated:** The document (as opposed to deck) editions list the actual sample rows — port name,
level, answers, date, etc. — grouped per employee.

**Analysis:** ⚠️ **This is the one report requirement that genuinely conflicts with W35a's
"never load rows" rule.** R1–R4 are all aggregates; R5 is explicitly row-level detail.

That's not a contradiction in the requirements — it's the boundary. W35a governs *the Population
tab opening*; R5 is a *deliberate user action* ("generate the document report"). Row access is fine
there, as long as it is paged/streamed rather than loading the month wholesale, and as long as it
never happens implicitly. Worth stating explicitly in any design so the two rules don't appear to
fight.

---

## D3. No duplicate loading across pages

**Original:**
> "the app shoudl be smart no duplication of the same data for example A data is linked for Page A
> but when we go to page B which require same Data it load it again or refresh"

**Restated:** Data already loaded for one page should be reused when another page needs the same
data, rather than reloaded.

**Analysis:** [CONFIRMED as a real gap] This is a **stronger and more general** statement of a
defect the audit already found in one place: Report Designer KPI cards each load population +
sample + distribution + all employee files **independently**, with no sharing even between sibling
tiles on the same canvas (map Finding 2). If ten tiles on one page don't share, pages certainly
don't share with each other.

D3 is the natural companion to D1: D1 keeps derived state warm *across the session*, D3 ensures
every surface reads from that one warm copy instead of its own. Neither is complete without the
other — D1 without D3 means the warm cache exists and pages ignore it.

---

## Cross-cutting theme in the UX complaints

W3, W4, W8, W9, W11 and W14 are one complaint wearing different clothes: **the wizard exposes
internals at the step where the user wants to make a decision, and defers the information they
needed until the step after.** The owner's W10 restructure is the coherent response to the theme
rather than to any single item.

---

## Open questions to resolve

Ordered by priority.

1. **W12 mechanism** — does `exactCertTarget` on the stage-based path add the CertScan quota to the
   requested total rather than splitting within it?
2. **W20 mechanism** — in what order are `المستوى`'s aliases resolved, and can an L1/L2 *result*
   column win over the real `STAGE` column? Joint highest priority with W12: both would silently
   corrupt the sample, and both sit in the sampling path.
3. **W7 mechanism** — where exactly does CertScan port-name normalization diverge?
4. **W17 cause** — why does the alias input reject `,`? Blocking, and gates W22.
5. **W19 fate** — are `موظف المستوى الأول/الثاني` ingested and merely unexportable, dropped at
   processing, or present-but-undocumented?
6. **W13 backfill** — does CertScan→NonCertScan backfill exist at all when CertScan is short?
7. **W8 dependency** — is `تقرير المعالجة` the only surface exposing dropped-row counts (map
   Finding 18)? If so, removing it hides a real signal.
8. **W2 scope** — does the comparison read pre- or post-normalization values?
9. **W25 capability** — does filter-then-bulk-reassign exist in صور الأشعة المحالة at all, or is it
   only unusable because of popup latency? Determines bug vs. feature.
10. **W33 coverage** — which surfaces actually subscribe to the `"manual"` refresh signal? The
    mechanism exists; the coverage may not.
11. **W29 specifics** — the supervisor approvals page needs a follow-up pass with concrete
    observations; "inconsistent or buggy" isn't actionable yet.
12. **R2/R3 section ordering** — does "section 1 per stage, section 2 per port" apply only to
    تقرير الإدارة, or to تقرير التوزيع as well? They were specified in opposite orders. One
    question, but it determines both reports' structure.
13. **R4 composition** — "a mix of the other three" needs the specific sections named before it can
    be built.

---

## Decisions that are policy, not bugs

- **W27 (2–3 min popup) and W15 (3–6 hr save)** — both stem from deliberate correctness machinery:
  the pre-action fresh read that prevents double-assignment, and one-file-per-event that prevents
  cross-machine write collisions. **Neither should be "fixed" by weakening the guarantee.** Make the
  fold cheap instead — see D1 below, which removes the tradeoff rather than taking a side on it.

### W34 — RESOLVED BY OWNER DECISION, 2026-08-07

**Owner's words:**
> "dont worry about attended machine its ok not a problem"

The unattended-machine risk was put to the owner explicitly and **accepted**. Session persistence
across browser restarts is therefore approved. This is a deliberate, informed relaxation of SEC-02,
not an oversight — `SECURITY_MODEL.md` should be updated to record the acceptance and its rationale
when this is implemented, rather than silently diverging from it.

Note one constraint that survives the decision and cannot be removed by the app: the File System
Access API still requires `queryPermission({mode:"readwrite"}) === "granted"`, so a **workspace**
reconnect gesture may still be needed even once the **session** persists. Those are two different
prompts; only the second is under the app's control.

---

## Owner design proposals (raised 2026-08-07, during the walkthrough)

These are the owner's own architectural suggestions, recorded with assessment. They are proposals,
not decisions.

### D0. Storage mechanism reference — reading the owner's "IndexedDB"

**Owner's note:**
> "btw whenver i said IndexedDB in our session i dont know what is the correct storage for the
> seassion so i just say IndexedDB so u revise it where it its suppose to exist and fix it smartly"

Throughout this document the owner used "IndexedDB" as a **placeholder meaning "persisted
somewhere sensible"**, not as a technical choice. Their quotes are preserved verbatim; this section
is the authoritative mapping of each need to the mechanism that actually fits.

| Need | Correct mechanism | Why not the others |
|---|---|---|
| **Session / sign-in persistence** (W34) | **`localStorage`** | Tiny record, and it must be read **synchronously at boot** to decide what to render. IndexedDB is async — it would force a flash of the login screen before the app knows you're already signed in. `sessionStorage` is what it uses today and is exactly what clears on browser close. |
| **Warm derived state** — folded distribution, working caches (D1) | **IndexedDB** | Genuinely correct here. Structured, potentially tens of MB, async is fine, survives reload. `localStorage` caps out around 5–10 MB and is synchronous (it would block the main thread). |
| **In-session working set** (the "keep it in memory" half of D1) | **Plain in-memory JS** (module state / React context) | Not a storage API at all. IndexedDB is the *reload-survival* layer beneath it, not a replacement for it. |
| **Precomputed month aggregates** (D2) | **The workspace folder on disk** — mirrored into IndexedDB as a local cache | ⚠️ **See the correction below — this is the one that matters.** |
| **Workspace directory handle** | **IndexedDB** (already so) | A `FileSystemDirectoryHandle` is not serializable to `localStorage`. IndexedDB is the *only* option; already implemented correctly. |
| **UI labels, table presets** | **`localStorage`** (already so) | Small, synchronous read is desirable, per-browser by nature. Correct as-is. |
| **Selected month** | **`sessionStorage`** (already so) | Deliberately per-tab so two tabs can view different months. Changing it to `localStorage` would couple them. |

#### ⚠️ The correction that matters: aggregates belong on disk, not (only) in IndexedDB

**IndexedDB is per-browser, per-machine, per-user.** An aggregate computed on the admin's machine is
invisible to an employee on another machine, and invisible to the same admin in a different browser.

So if D2's precomputed "static information" lived only in IndexedDB, **every user would recompute it
independently** — which is the exact problem D2 exists to solve, merely relocated.

The correct shape is two layers:

1. **Workspace disk = source of truth for aggregates.** Written once at processing time (extending
   `processing.summary.json`, or a Phase C-style index file). Shared by everyone, backed up with the
   workspace, survives machine changes. Computed **once, by whoever processed the month**.
2. **IndexedDB = local acceleration cache**, keyed by `(month, revision)`. Avoids re-reading and
   re-parsing the aggregate file on every page load, and is trivially invalidated because the key
   contains the revision.

This matches the architecture proposal's existing position — *"use IndexedDB only as an optional
acceleration cache, never as the source of truth"* — and it is the difference between computing
aggregates **once per month** and **once per user per machine**.

### D1. Load at sign-in, then silent incremental sync every 3 minutes

**Original:**
> "I was thinking once i sign in the loading page load all data keep it in memory
> every 3 minutes ti start syncing file by file silently so it doesnt effect performance
> it first of all read start a real quick check if there was any changes if not it does nothing if
> trhere is it load it to the instence so this way it doesnt sync everything and nothing is changed
> wasted processing power"

**Restated:** Warm all data into memory at sign-in. Every 3 minutes, run a cheap change check
first; sync only what actually changed, file by file, in the background.

**Assessment — the change-detection half is right and cheaper than it sounds.**
- The File System Access API exposes `lastModified` on a file handle **without reading contents**,
  so the "real quick check" is genuinely cheap.
- `distribution.events/` is append-only, so a **directory name listing** alone reveals what's new —
  no file needs opening to detect change there.
- Most of the machinery already exists: `dataRefreshSignal` already fires a 3-minute periodic tick,
  every envelope already carries a `revision`, and `readAppendOnlyDirectory` already name-diffs
  append-only folders. **What's missing is that the existing tick re-reads unconditionally** — there
  is no revision/mtime short-circuit. Much of D1 is "make the existing tick smart", not new
  infrastructure.

**Assessment — "load all data" does not survive 500k rows.**
1. It relocates the wait to sign-in rather than removing it.
2. 500k rows as live JS objects — field names repeated per row, `rawRow` duplicating the source row
   inside each — lands in the several-hundred-MB to >1GB range. That is a thrashing or crashing tab.

This is precisely why the architecture proposal's first principle is *load no heavy business dataset
at startup*.

**The workable form — split by size, not by convenience:**

| Data | Size | Strategy |
|---|---|---|
| Folded distribution state | Small (one entry per assigned image) | **Eager at sign-in, kept warm, synced incrementally** |
| Summaries / port / level aggregates | Tiny | **Eager** — this is D2 |
| Sample rows | Moderate (~9k) | Eager while it stays in this range |
| **Population rows (500k)** | **Huge** | **Never wholesale.** Paged, worker-owned, as Browse already is |

**The significant consequence — D1 dissolves the W27 and W15 tradeoffs rather than trading them
off.** If the fold is maintained incrementally in memory, "give me authoritative current state"
becomes "read the few event files added since the last check". The pre-action freshness check that
currently costs 2–3 minutes becomes near-instant **with the double-assign guarantee fully intact**.
Earlier this document warned that the naive fix for W27 was dangerous; D1 is the non-dangerous fix.

**Implementation note:** the background sync must run in a **worker**. On the main thread,
"silently" won't be silent — it will contend with rendering every three minutes.

### D2. Precompute static/pivot data at processing time

**Original:**
> "instead of building data from 0 why not make it when processing the data it save static
> information required to run the entire app or use pivot table which is way faster and efficient
> than loading all raw and processed data every single time for no usage"

**Restated:** At processing time, persist the aggregates the app actually needs, so later sessions
read summaries instead of reloading and re-deriving from raw and processed rows.

**Assessment — correct, and partly built already.** `processing.summary.json` exists and is already
read *instead of* the population on some paths (the archive-status tiles use a manifest-trust
shortcut for exactly this reason). Phase C's `PopulationPartitionIndex` formalizes it with
`countsByPort` and `countsByPortStage`, explicitly so allocation and capacity questions are
answerable **without reading any row file**.

**The caveat: precomputed aggregates only answer anticipated questions.** The Report Designer builds
arbitrary queries; not every cut can be precomputed. The workable shape is therefore *precompute the
hot, known aggregates* (KPI cards, report headline figures, port/level counts) *and keep a paged
path for arbitrary drill-down*.

**D2 and W36 reinforce each other.** Precomputed aggregates normally carry an invalidation problem —
when is a stale summary recomputed? But a **locked month cannot change**, so its aggregates are
immutable: written once to the workspace, cached indefinitely in IndexedDB, across sessions, with no
invalidation logic at all. Auto-locking the month after distribution (W36) is what makes aggressive
aggregate caching safe.

**Storage placement — see D0.** The aggregate itself belongs **on workspace disk** (shared, backed
up, computed once by whoever processed the month); IndexedDB holds only a local copy keyed by
`(month, revision)`. Putting aggregates solely in IndexedDB would make every user on every machine
recompute them independently, which is the problem D2 exists to eliminate.

**W35a raises the bar on D2.** The owner has since clarified that a finished month must *never*
touch raw or population files again — so the aggregate isn't an optimisation, it's the tab's only
data source. Its field set has to be complete enough to render the tab with zero row access.

### Convergence note

D1, D2, W35 and W41 are the owner arriving from daily use at substantially the architecture
`LARGE_POPULATION_PERFORMANCE_PROPOSAL_2026-07-22.md` reached from analysis — including its
"IndexedDB as acceleration cache, never source of truth" position. The two lines of reasoning agreeing
is the strongest available argument for scheduling Phase C rather than leaving it proposed.

---

## What the owner explicitly liked — do not break these

- **Phase 3** (level-based sample selection): *"which is Great"*
- **Phase 4** (distribution): *"its great"* — the UI, not the save
- The seed control itself: *"which is great"* — W14 is about location, not removal
- The Phase 1→2 comparison concept: *"it was great but had flaws"* — W2 is the flaw, not the feature

---

## Not yet walked

Population tab and mapping/export settings only. Still to come: Employee Workspace, Notifications,
Reports (including the Report Designer), Archive, User Management, Settings (remainder).
