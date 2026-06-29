# Executive Report — Full Data Mapping

- **Date:** 2026-06-29
- **Companion to:** `2026-06-29-executive-report-rework-design.md`
- **Purpose:** Trace every value in the report from its on-disk source → load function → join/processing stage → derived metric → report page. **Nothing in the report is invented; this document is the proof.**

---

## 0. Data-flow overview

```
DISK (workspace folder)                 LOAD (Reports/index.tsx → loaders)        PROCESS (executive/*)            RENDER
─────────────────────────               ─────────────────────────────────        ────────────────────            ──────
1-Population/{month}/processed/          loadMonthPopulationFinal()    ┐
   population.final.json                                              │
2-Samples/{month}/1-Main/                loadSampleMaster()           │  Stage A  buildExecutiveReportRows()   per-page
   sample.master.json                                                 ├─────────► (join → ExecutiveReportRow[]) builders
2-Samples/{month}/1-Main/                loadOrDeriveDistribution     │  Stage B  calculateExecutiveKPIs()      (cover…
   distribution.current.json  ◄(derived from distribution.log.json)  │           (population/port/stage/quality) appendix)
2-Samples/{month}/{emp}.answers.json     loadAllEmployeeFiles()       │  Stage C  buildEmployeeProfiles() [NEW] ────────►
6-Templates/{id}.json + selection        loadTemplate()+selection     ┘           (per-employee analytics)
browser localStorage (xray_user_mgmt)    getPublicManagedUsers()         Stage D  displayName() resolution
```

Stages A–D run in memory at report-generation time; no new files are written.

---

## 1. Source files (where data is taken)

| # | Disk path | Type | Loaded by | Carries |
|---|-----------|------|-----------|---------|
| S1 | `1-Population/{month}/processed/population.final.json` | `PopulationFinalData.rows: PreparedPopulationRow[]` | `loadMonthPopulationFinal()` | The whole population: every x-ray, its port, stage, L1/L2 results, risk/BI/CertScan enrichment |
| S2 | `2-Samples/{month}/1-Main/sample.master.json` | `SampleMasterData` | `loadSampleMaster()` | Which rows were drawn, per-port & per-stage allocations, RNG seed, totals |
| S3 | `2-Samples/{month}/1-Main/distribution.current.json` (folded from append-only `distribution.log.json`) | `DistributionCurrentData` | `loadOrDeriveDistributionCurrent()` | Who each image is assigned to, status, assignment timestamp |
| S4 | `2-Samples/{month}/{username}.answers.json` (one per employee) | `EmployeeAnswerFile` | `loadAllEmployeeFiles()` | Each employee's submitted answers per image (`answeredBy`, `submittedAt`, field values) |
| S5 | `6-Templates/{templateId}.json` + selection pointer | `TemplateSchema` | `loadInspectionTemplateSelection()` + `loadTemplate()` | Field id ↔ label map — needed to read answer values by meaning |
| S6 | browser `localStorage: xray_user_management_v1` | `{username, displayName}[]` | `getPublicManagedUsers()` **[NEW wiring]** | username → Arabic display name |

All disk reads go through `safeReadJson` (recovers from `.bak` on corruption) and are unwrapped from `JsonEnvelope`.

---

## 2. Source field dictionary (the raw inputs)

### S1 — `PreparedPopulationRow` (population.final.json)
| Field | Used for |
|-------|----------|
| `xrayImageId` | **Join key** across S1–S4 |
| `portName`, `portType`, `portCode` | Port grouping, land/sea split (Parts 1–2, employee×port) |
| `stage` | Stage/level allocation (p.06) |
| `xrayLevelOneResult` ∈ {سليمة, اشتباه} | L1 machine result → L1 accuracy, image result |
| `xrayLevelTwoResult` ∈ {سليمة, اشتباه} | L2 machine result → L2 accuracy, image result |
| `certScanStatus` ∈ {Certscan, NonCertscan} | CertScan/NonCertScan split (sample pages) |
| `targetedByRiskEngine`, `riskMessage` | Risk context (population by risk type, p.05) |
| `biEnrichmentStatus`, `biMatched` | Data-quality context (appendix/population) |

> **`imageResult`** is derived, not stored: `اشتباه` if either L1 or L2 = `اشتباه`, else `سليمة`.

### S2 — `SampleMasterData`
| Field | Used for |
|-------|----------|
| `rows[].xrayImageId` | Set of sampled images → `selectedInSample` flag |
| `totalActual`, `totalRequested` | Sample size KPI, coverage |
| `certScanActual`, `nonCertScanActual` | CertScan split on sample pages |
| `portAllocations[]` (`populationSize`, `allocatedQuota`, `actual*Drawn`) | Per-port sample table (p.07) |
| `stageAllocations[]` (`stageLabel`, `populationSize`, `actualDrawn`) | Per-level sample allocation (p.06–07) |

### S3 — `DistributionCurrentData`
| Field | Used for |
|-------|----------|
| `entries[].xrayImageId` | Join to population |
| `entries[].assignedTo` | Fallback evaluator id (employee analytics) |
| `entries[].status` ∈ {pending, completed, replacement-requested, replaced} | Completion state |
| `entries[].lastEventAt` | Assignment timestamp → turnaround |
| `quotas[username]` | Workload/daily-quota context (p.19) |

### S4 — `EmployeeAnswerFile.items[]` (`ItemAnswer`)
| Field | Used for |
|-------|----------|
| `xrayImageId` | Join key |
| `answeredBy` (username) | **Primary evaluator id** for all employee analytics |
| `status` ∈ {draft, submitted} | Only `submitted` counts toward accuracy |
| `submittedAt` | Completion timing, turnaround |
| `answers[]: {fieldId, value}` | Expert verdict + image-quality / marking / suspicion fields |

### S5 — `TemplateSchema.fields[]` (`{fieldId, label}`)
Builds a normalized `label → fieldId` map (`createFieldResolver`) so answers can be read by **meaning** rather than brittle field ids. Label normalization strips Arabic orthographic variants (أإآ→ا, ى→ي, ة→ه). Mappings configured in `DEFAULT_EXEC_FIELD_MAPPINGS`:

| Concept | Mapped label (config) | Answer value domain |
|---------|----------------------|---------------------|
| Expert verdict | `صحة النتيجة` (fallback fieldId `qualityImageResult`) | سليمة / اشتباه |
| Image present | `هل يوجد صورة` | نعم / لا |
| No-image reason | `سبب عدم وجود الصورة` | free text |
| Marking present | `هل يوجد تحديد` | نعم / لا |
| Image quality | `مستوى جودة الصورة` | عالي / متوسط / منخفض |
| Low-quality reason | `اسباب انخفاض جودة الصورة` | free text |
| Suspicion level | `تقييم الاشتباه` | عالي / متوسط / منخفض |
| Suspected types | `الاصناف المشبوهة` | free text |
| Smuggle method | `الية التهريب المحتملة` | free text |

---

## 3. Stage A — Join into `ExecutiveReportRow` (`buildExecutiveReportRows`)

One row **per population image**, enriched by left-joining sample/distribution/answers on `xrayImageId`:

```
for each population row p:
  selectedInSample  = sampleIds.has(p.xrayImageId)                      // from S2
  dist              = distMap.get(p.xrayImageId)                        // from S3
  assignedTo        = dist?.assignedTo
  distributionStatus= dist?.status
  assignedAt        = dist?.lastEventAt
  answer            = answerMap.get(p.xrayImageId)                      // from S4, submitted wins over draft
  answeredBy        = answer?.answeredBy            // [NEW: surfaced onto the row for employee analytics]
  answerStatus      = answer?.answerStatus
  submittedAt       = answer?.submittedAt
  expertResult      = asSuspicionResult(answerValue(..., resultValidityLabel))   // via S5 resolver
  imageAvailable / hasMarking / imageQuality / suspicionLevel / suspectedTypes / smuggleMethod / *Reason
                    = answerValue(...) for each mapped concept
  imageResult       = (L1=اشتباه || L2=اشتباه) ? اشتباه : سليمة
```

**Answer precedence:** a submitted answer always overrides a draft for the same image (`answerMap` build loop). Draft answers never count toward accuracy.

### Accuracy classification (only when `expertResult !== null`)
```
imageResultAccurate = imageResult === expertResult
levelOneAccurate    = L1 === expertResult
levelTwoAccurate    = L2 === expertResult
verificationCategory:
  imageResult=اشتباه & expert=اشتباه → correct-suspicious   (true positive)
  imageResult=سليمة  & expert=سليمة  → correct-clean        (true negative)
  imageResult=اشتباه & expert=سليمة  → excess-suspicion     (false positive)
  imageResult=سليمة  & expert=اشتباه → missed-suspicion     (false negative)
```

> **[NEW] change to Stage A:** add `answeredBy` to `ExecutiveReportRow`. The evaluator used for employee analytics is `answeredBy ?? assignedTo` (answer's real author preferred; distribution assignment as fallback).

---

## 4. Stage B — Population / port / stage / quality KPIs (`calculateExecutiveKPIs`)

All from `ExecutiveReportRow[]` + `SampleMasterData`. Definitions of every derived metric:

### Volume & coverage
| Metric | Formula |
|--------|---------|
| `totalPopulation` | count(rows) |
| `totalSample` | `sample.totalActual` (fallback: count selectedInSample) |
| `sampleCoverage` | totalSample / totalPopulation × 100 |
| `suspiciousCount` / `cleanCount` | count(imageResult = اشتباه / سليمة) |
| `suspicionRate` | suspiciousCount / totalPopulation × 100 |
| `studiedImages` | count(selectedInSample & answerStatus=submitted) |
| `remainingImages` | max(0, totalSample − studiedImages) |
| `completionRate` | studiedImages / totalSample × 100 |

### Accuracy (denominator = `validStudied` = sum of the four verification categories)
| Metric | Formula |
|--------|---------|
| `overallAccuracy` | (correctSuspicious + correctClean) / validStudied × 100 |
| `suspiciousDetectionRate` | correctSuspicious / (correctSuspicious + missedSuspicious) × 100 |
| `missedSuspicionRate` | missedSuspicious / (correctSuspicious + missedSuspicious) × 100 |
| `suspicionPrecision` | correctSuspicious / (correctSuspicious + excessSuspicious) × 100 |
| `cleanConfirmationRate` | correctClean / (correctClean + excessSuspicious) × 100 |
| `excessSuspicionRate` | excessSuspicious / (correctSuspicious + excessSuspicious) × 100 |
| `balancedQualityScore` | (suspiciousDetectionRate + cleanConfirmationRate) / 2 |

### Level (L1/L2)
| Metric | Formula |
|--------|---------|
| `levelOneAccuracy` / `levelTwoAccuracy` | levelN-correct / validStudied × 100 |
| `levelDisagreementRate` | count(L1≠L2) / totalPopulation × 100 (whole population) |
| `levelTwoCorrectionRate` | of images where L1 wrong: share L2 corrected |
| `levelTwoRegressionRate` | of images where L1 right: share L2 broke |

### Image quality / marking (denominator = submitted rows)
| Metric | Formula |
|--------|---------|
| `imageAvailabilityRate` | available / (available + missing) × 100 |
| `markingRate` | marked / (marked + unmarked) × 100 |
| `acceptableQualityRate` | (high + medium) / (high+medium+low) × 100 |
| `missingImageReasons[]` / `lowQualityReasons[]` | counted & ranked from free-text answers |

### Port profiles (`portProfiles[]`, grouped by `portName`)
Per port: population, clean, suspicious, suspicionRate, sampleSize, coverage, studied, completionRate, and — **only when `studied ≥ minimumReliableSampleSize` (30)** — accuracy, suspiciousDetectionRate, missedSuspicionRate, L1/L2 accuracy. `status` ∈ {excellent, stable, monitor, priority, insufficient} from accuracy vs `accuracyTarget` and missed-suspicion vs `maximumMissedSuspicionRate`.

### Stage profiles (`stageProfiles[]`)
Prefers `sample.stageAllocations`; falls back to grouping rows by `stage`. Per stage: population, sampleSize, coverage, studied, completionRate.

---

## 5. Stage C — Employee analytics [NEW] (`executiveEmployeeData.ts`)

Group `ExecutiveReportRow[]` by **evaluator** = `answeredBy ?? assignedTo`, submitted rows only. Per `EmployeeProfile`:

| Metric | Source / formula |
|--------|------------------|
| `studied` | count(rows for employee, submitted) |
| `workload` | count(rows where assignedTo/answeredBy = employee) |
| `turnaroundHoursAvg` | mean(submittedAt − assignedAt) over employee's rows |
| `overallAccuracy` | employee's (correctSuspicious+correctClean) / validStudied × 100 |
| `suspiciousDetectionRate`, `missedSuspicionRate`, `excessSuspicionRate` | same formulas as §4, scoped to employee |
| `levelOneAccuracy`, `levelTwoAccuracy` | scoped to employee |
| `byPort[port]` | employee's accuracy per port → matrix (p.18) |
| `byDecision` | accuracy on expert=اشتباه vs expert=سليمة subsets (p.16) |
| `byImageQuality[عالي/متوسط/منخفض]` | accuracy bucketed by `imageQuality` (p.20) |
| `byMarking` | accuracy for marked vs unmarked (p.20) |
| `stabilityIndex` | dispersion (e.g. stdev) of per-port accuracy → lower = steadier (p.19) |
| `reliable` | studied ≥ `minimumReliableSampleSize` |
| `riskScore` / `recommendedAction` | composite of low accuracy + high missed-suspicion + workload → priority list (p.23) |

Aggregate builders: `buildEmployeePortMatrix`, `buildDecisionQuadrant`, `buildStabilityScatter`, `buildPriorityList`, `buildLevelAgreement` (L1-vs-L2 always; employee-pair agreement only when an image has ≥2 distinct `answeredBy` — otherwise that panel is hidden, never faked).

Unreliable employees (studied < 30) are shown but their rate cells render "بيانات غير كافية".

---

## 6. Stage D — Display-name resolution

`displayName(username, ctx)`:
- `config.anonymizeEmployees = true` → `موظف ١`, `موظف ٢`, … assigned by accuracy rank (stable).
- else → `employeeDisplayNames[username] ?? username` (S6 map; falls back to username only if a user was deleted).

The S6 map is built in `Reports/index.tsx` from `getPublicManagedUsers()` and injected into `ExecutiveReportInput.employeeDisplayNames`, so `src/data/` never imports `src/auth/`.

---

## 7. Per-page data binding (every page → its inputs)

| Page | Reads | Key derived values |
|------|-------|--------------------|
| 01 Cover | `monthFolderName`, org branding, `new Date()` | report month, issue date |
| 02 TOC | static section list | live page numbers (assemble.ts) |
| 03 Glossary | `STUDY_LEVEL_DEFINITIONS`, term list | — |
| 05 Population by risk | KPIs, port profiles, `targetedByRiskEngine` | population, clean/suspicious, suspicionRate, land/sea split |
| 06 Population by level | `stageProfiles`, port × level | population per level/port |
| 07 Sample by level | `sample.portAllocations`, `stageAllocations`, CertScan split | sampleSize, coverage per port/level |
| 09 Accuracy by port | `portProfiles` (reliable only) | accuracy, detection, missedSuspicion + status |
| 10 Accuracy by level | level KPIs | L1/L2 accuracy, correction/regression → radar |
| 14 Part-3 map | static index | page anchors |
| 15 Employee overview | `EmployeeProfile[]` | ranked accuracy, studied, top-5 |
| 16 By decision type | `buildDecisionQuadrant` | per-employee suspicious-vs-clean accuracy |
| 17 Performance per port | profiles × port | per-port employee accuracy |
| 18 Employee × port | `buildEmployeePortMatrix` | heatmap, best/worst |
| 19 Stability & workload | `buildStabilityScatter`, `quotas` | workload×accuracy, stabilityIndex |
| 20 Image quality & marking | `byImageQuality`, `byMarking` | accuracy by quality/marking |
| 22 L1-vs-L2 + agreement | level KPIs + `buildLevelAgreement` | L1-vs-L2 bars; pair heatmap (conditional) |
| 23 Priority & actions | `buildPriorityList` | riskScore ranking + recommendedAction |
| 31 Appendix | `config` thresholds, methodology text | accuracyTarget, completionTarget, minimumReliableSampleSize, etc. |

---

## 8. Empty / insufficient-data behavior (no `XX%`, ever)

| Condition | Behavior |
|-----------|----------|
| No `population.final.json` | Report refuses to generate (toast: "يجب معالجة المجتمع أولاً") |
| No sample | Sample/coverage pages show population only; accuracy pages show "لم تُسحب عينة" |
| No submitted answers | Accuracy/employee pages show "بيانات غير كافية"; volume pages still render |
| Port/employee studied < 30 | Rate cells → "بيانات غير كافية"; counts still shown |
| No overlapping evaluations | Employee-pair-agreement panel (p.22 right) hidden |
| User deleted from management | Falls back to raw username for that one employee |

---

## 9. Config inputs (`DEFAULT_EXEC_CONFIG`) that shape the numbers

| Key | Default | Affects |
|-----|---------|---------|
| `monthlyTarget` | `MONTHLY_SAMPLE_TARGET` | completion context |
| `accuracyTarget` | 90 | port/employee status thresholds |
| `completionTarget` | 95 | completion findings |
| `coverageTarget` | 7.5 | coverage assessment |
| `maximumMissedSuspicionRate` | 5 | quality-risk findings, port status |
| `minimumReliableSampleSize` | 30 | reliability gate everywhere |
| `expertResultFieldId` | `qualityImageResult` | expert-verdict fallback |
| `fieldMappings` | `DEFAULT_EXEC_FIELD_MAPPINGS` | answer label resolution (S5) |
| `showEmployeeNames` → `anonymizeEmployees` [NEW] | names shown | display-name vs codes |
