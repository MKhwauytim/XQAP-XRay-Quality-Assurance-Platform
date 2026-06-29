# Executive Report — Data Mapping Spec

> **Purpose:** This document tells the Implementer agent exactly what TypeScript expression
> replaces every hardcoded value, `XX%`, `00`, and placeholder name in the 23-page HTML mockup
> (`xray_executive_report_preview_v4.html`). It is derived from reading the mockup in full and
> cross-referencing every field against the TypeScript types in `context.ts`,
> `executiveReportTypes.ts`, and `executiveEmployeeData.ts`.

---

## 1. Available data on `ctx` (ExecutiveRenderContext)

### `ctx.kpis` — `ExecutiveKPIs`

| Field | Type | Meaning |
|---|---|---|
| `totalPopulation` | `number` | Total rows in population |
| `totalSample` | `number` | Total rows selected in sample |
| `sampleCoverage` | `number` | `totalSample / totalPopulation * 100` |
| `studiedImages` | `number` | Rows with submitted answers (verificationCategory not null) |
| `remainingImages` | `number` | `totalSample - studiedImages` |
| `completionRate` | `number` | `studiedImages / totalSample * 100` |
| `suspiciousCount` | `number` | Rows where `imageResult === 'اشتباه'` |
| `cleanCount` | `number` | Rows where `imageResult === 'سليمة'` |
| `suspicionRate` | `number` | `suspiciousCount / totalPopulation * 100` |
| `overallAccuracy` | `number \| null` | Overall image accuracy % (null if no studied rows) |
| `suspiciousDetectionRate` | `number \| null` | % of actual suspicious correctly identified |
| `missedSuspicionRate` | `number \| null` | % of actual suspicious incorrectly marked clean |
| `suspicionPrecision` | `number \| null` | Of all "suspicious" verdicts, % that were correct |
| `cleanConfirmationRate` | `number \| null` | % of actual clean correctly confirmed |
| `excessSuspicionRate` | `number \| null` | % of employee's suspicious verdicts that were wrong (false-alarm rate) |
| `balancedQualityScore` | `number \| null` | Composite accuracy score |
| `levelOneAccuracy` | `number \| null` | % of rows where level-1 result matched expert |
| `levelTwoAccuracy` | `number \| null` | % of rows where level-2 result matched expert |
| `levelDisagreementRate` | `number \| null` | Rate at which L1 and L2 disagreed |
| `levelTwoCorrectionRate` | `number \| null` | Rate at which L2 corrected L1 correctly |
| `levelTwoRegressionRate` | `number \| null` | Rate at which L2 made L1's correct answer wrong |
| `correctSuspicious` | `number` | Count of `verificationCategory === 'correct-suspicious'` |
| `correctClean` | `number` | Count of `verificationCategory === 'correct-clean'` |
| `missedSuspicious` | `number` | Count of `verificationCategory === 'missed-suspicious'` |
| `excessSuspicious` | `number` | Count of `verificationCategory === 'excess-suspicious'` |
| `validStudied` | `number` | Rows with non-null verificationCategory |
| `imagesWithSubmittedAnswers` | `number` | Rows where answerStatus === 'submitted' |
| `imageAvailableCount` | `number` | Rows where imageAvailable === true |
| `imageMissingCount` | `number` | Rows where imageAvailable === false |
| `imageAvailabilityRate` | `number \| null` | `imageAvailableCount / studiedImages * 100` |
| `markingPresentCount` | `number` | Rows where hasMarking === true |
| `markingMissingCount` | `number` | Rows where hasMarking === false |
| `markingRate` | `number \| null` | `markingPresentCount / imageAvailableCount * 100` |
| `highQualityCount` | `number` | Rows where imageQuality === 'عالي' |
| `mediumQualityCount` | `number` | Rows where imageQuality === 'متوسط' |
| `lowQualityCount` | `number` | Rows where imageQuality === 'منخفض' |
| `imageQualityEvaluatedCount` | `number` | Rows where imageQuality is not null |
| `acceptableQualityRate` | `number \| null` | `(highQualityCount + mediumQualityCount) / imageQualityEvaluatedCount * 100` |
| `missingImageReasons` | `ReasonCount[]` | `{reason, count, percentage}[]` — reasons for missing images |
| `lowQualityReasons` | `ReasonCount[]` | `{reason, count, percentage}[]` — reasons for low quality |
| `monthlyTarget` | `number` | Configured monthly target from `ctx.input.config.monthlyTarget` |
| `portProfiles` | `PortProfile[]` | Per-port breakdown (see below) |
| `stageProfiles` | `StageProfile[]` | Per-stage (level) breakdown (see below) |

### `ctx.kpis.portProfiles` — `PortProfile[]`

**Note:** `PortProfile` does NOT have a `portType` field. Port type (land/sea) is NOT present in `PortProfile` itself. See "Unavailable Data" section for the workaround.

| Field | Type | Meaning |
|---|---|---|
| `portName` | `string` | Port name in Arabic |
| `population` | `number` | Total rows in this port |
| `clean` | `number` | Clean rows in population |
| `suspicious` | `number` | Suspicious rows in population |
| `suspicionRate` | `number` | Suspicious % |
| `sampleSize` | `number` | Rows selected in sample |
| `coverage` | `number` | `sampleSize / population * 100` |
| `studied` | `number` | Studied (submitted-answer) rows |
| `completionRate` | `number` | `studied / sampleSize * 100` |
| `accuracy` | `number \| null` | Overall accuracy % for this port |
| `suspiciousDetectionRate` | `number \| null` | Suspicious detection rate for this port |
| `missedSuspicionRate` | `number \| null` | Missed suspicion rate for this port |
| `levelOneAccuracy` | `number \| null` | L1 accuracy for this port |
| `levelTwoAccuracy` | `number \| null` | L2 accuracy for this port |
| `status` | `"excellent"\|"stable"\|"monitor"\|"priority"\|"insufficient"` | Port performance rating |

### `ctx.kpis.stageProfiles` — `StageProfile[]`

| Field | Type | Meaning |
|---|---|---|
| `stageKey` | `string` | Internal key e.g. `"stage1"` |
| `stageLabel` | `string` | Display label e.g. `"المستوى الأول"` |
| `population` | `number` | Population rows in this stage |
| `sampleSize` | `number` | Sample rows in this stage |
| `coverage` | `number` | Coverage % |
| `studied` | `number` | Studied rows |
| `completionRate` | `number` | Completion % |

**Note:** `StageProfile` has NO `accuracy`, `suspiciousDetectionRate`, or `clean`/`suspicious` fields. Stage-level accuracy must be computed from `ctx.rows` grouped by `row.stage`. See "Unavailable Data."

### `ctx.rows` — `ExecutiveReportRow[]`

Used via `buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize)`.
Each row represents one X-ray image with all its classification results and answer data.
Key fields used in employee analytics: `assignedTo`, `answerStatus`, `verificationCategory`,
`imageResultAccurate`, `levelOneAccurate`, `levelTwoAccurate`, `portName`, `portType`, `stage`,
`imageQuality`, `hasMarking`, `expertResult`, `suspectedTypes`, `smuggleMethod`.

### `ctx.monthLabel`
Arabic month name + year, e.g. `"مايو 2026"`. Generated from `input.monthFolderName`.

### `ctx.issueDate`
Formatted issue date e.g. `"29 / 06 / 2026"`. Generated at build time.

### `ctx.displayName(username: string)`
Returns display name for a username. When `input.config.showEmployeeNames === false`, returns
`"موظف 1"`, `"موظف 2"` etc. (stable by first-seen order). When names are shown, returns
`employeeDisplayNames[username] ?? username`.

---

## 2. Helper Expressions

| Helper | Signature | Usage |
|---|---|---|
| `esc(s)` | `(string\|null\|undefined) → string` | HTML-escape any string before insertion |
| `fmtNum(n)` | `(number) → string` | Format integer with locale grouping (Arabic locale, Latin digits) |
| `fmtPct(n, digits?)` | `(number\|null, digits=1) → string` | Returns `"XX.X%"` or `"—"` if null |
| `ctx.displayName(username)` | `(string) → string` | Anonymized or real name |
| `badgeHtml(status)` | `(string) → string` | Returns `<span class="xr-badge ...">` for port/employee status |
| `heatCell(pct)` | `(number\|null) → string` | Returns heat-colored span for accuracy values |

**Derived sub-expression helpers:**

```ts
// Safe nullable number display
const safeNum = (n: number | null) => n !== null ? fmtNum(Math.round(n)) : '—';
const safePct = (n: number | null) => fmtPct(n);

// Computed gap between two accuracy figures
const gap = (a: number | null, b: number | null) =>
  a !== null && b !== null ? fmtNum(Math.round(Math.abs(a - b))) : '—';

// Port type grouping (since portType is NOT on PortProfile, derive from ctx.rows)
// Build a portType lookup once before rendering:
const portTypeMap = new Map<string, string>();
for (const r of ctx.rows) {
  if (r.portName && r.portType) portTypeMap.set(r.portName, r.portType);
}
// Then for each PortProfile p:
// portTypeMap.get(p.portName) === 'land' → land port
// portTypeMap.get(p.portName) === 'sea'  → sea port
```

---

## 3. Page-by-Page Mapping

### Page 1 — الغلاف (Cover)

| HTML text / element | TypeScript expression |
|---|---|
| `يونيو 2026` (issue month in lead paragraph) | `esc(ctx.issueDate)` — note: mockup says "دورة التقرير: يونيو 2026"; the issue date is stored in `ctx.issueDate` as `"DD / MM / YYYY"`. If the month-name form is needed: derive from `ctx.issueDate` or compute from `new Date()` separately. |
| `مايو 2026` (population month in lead paragraph) | `esc(ctx.monthLabel)` |
| `المستوى الأول / الثاني / الثالث / الرابع` level strip | Hardcode — static labels |
| `سري داخليًا`, `نسخة تنفيذية` badges | Hardcode — static |
| Page number `01` | Hardcode `01` |

> The cover org block (هيئة الزكاة...) is **fully static**. No data substitution needed.

---

### Page 2 — الفهرس (Table of Contents)

All content is **static** — page numbers and section titles are fixed in the report structure.
No data substitution. Hardcode as-is.

---

### Page 3 — المعجم (Glossary)

All content is **static** — definitions are fixed text.
No data substitution. Hardcode as-is.

---

### Page 4 — غلاف الجزء الأول (Part 1 Divider)

**Static divider page.** No data substitution. Hardcode as-is.

---

### Page 5 — مجتمع حالات المخاطر

| HTML text / element | TypeScript expression |
|---|---|
| `386` — إجمالي المجتمع KPI card | `fmtNum(ctx.kpis.totalPopulation)` |
| `291` — المنافذ البرية KPI card | `fmtNum(ctx.kpis.portProfiles.filter(p => portTypeMap.get(p.portName) === 'land').reduce((s,p) => s + p.population, 0))` |
| `95` — المنافذ البحرية KPI card | `fmtNum(ctx.kpis.portProfiles.filter(p => portTypeMap.get(p.portName) === 'sea').reduce((s,p) => s + p.population, 0))` |
| Land ports table — each row port name | `esc(p.portName)` — loop over `ctx.kpis.portProfiles.filter(p => portTypeMap.get(p.portName) === 'land')` |
| Land ports table — each row إجمالي (population) | `fmtNum(p.population)` |
| Land ports table — each row سليمة | `fmtNum(p.clean)` (clean count IS available in PortProfile) |
| Land ports table — each row اشتباه | `fmtNum(p.suspicious)` (suspicious count IS available) |
| Land ports total row — إجمالي | sum of filtered populations, see above |
| Land ports total row — سليمة total | sum of `p.clean` for land ports |
| Land ports total row — اشتباه total | sum of `p.suspicious` for land ports |
| Sea ports table — same pattern | same, filtering `portTypeMap.get(p.portName) === 'sea'` |
| `—` shown in mockup for سليمة/اشتباه columns | Mockup shows `—` as placeholder; the actual values `p.clean` and `p.suspicious` ARE available — render them with `fmtNum()` |

**Loop template for land port rows:**
```ts
ctx.kpis.portProfiles
  .filter(p => portTypeMap.get(p.portName) === 'land')
  .map(p => `<tr>
    <td>${esc(p.portName)}</td>
    <td>${fmtNum(p.population)}</td>
    <td>${fmtNum(p.clean)}</td>
    <td>${fmtNum(p.suspicious)}</td>
  </tr>`).join('')
```

---

### Page 6 — المجتمع حسب المستويات

| HTML text / element | TypeScript expression |
|---|---|
| `386` — إجمالي المجتمع top KPI | `fmtNum(ctx.kpis.totalPopulation)` |
| `143` — المستوى الأول | `fmtNum(ctx.kpis.stageProfiles.find(s => s.stageKey === 'stage1')?.population ?? 0)` |
| `11` — المستوى الثاني | `fmtNum(ctx.kpis.stageProfiles.find(s => s.stageKey === 'stage2')?.population ?? 0)` |
| `213` — المستوى الثالث | `fmtNum(ctx.kpis.stageProfiles.find(s => s.stageKey === 'stage3')?.population ?? 0)` |
| `19` — المستوى الرابع | `fmtNum(ctx.kpis.stageProfiles.find(s => s.stageKey === 'stage4')?.population ?? 0)` |
| Per-stage tables (المستوى الأول card, etc.) — port rows | Loop over `ctx.kpis.portProfiles` filtered by `rows` that belong to that stage. **Caveat:** PortProfile does not carry a `stageKey`. Must group `ctx.rows` by `(portName, stage)` to build a per-stage-per-port count. See note below. |
| Per-stage table — سليمة / اشتباه / إجمالي cells | Compute from `ctx.rows` grouped by `(stage, portName)`: count rows where `levelOneResult === 'سليمة'` vs `'اشتباه'` (or use `imageResult` — use the same field the KPI builder uses for `clean`/`suspicious` on `PortProfile`) |

**Stage × port group helper (build once):**
```ts
// Map<stageKey, Map<portName, {clean: number, suspicious: number, total: number}>>
const stagePortMap = new Map<string, Map<string, {clean:number, suspicious:number, total:number}>>();
for (const r of ctx.rows) {
  const stageKey = r.stage ?? 'unknown';
  const port = r.portName ?? 'غير محدد';
  if (!stagePortMap.has(stageKey)) stagePortMap.set(stageKey, new Map());
  const portMap = stagePortMap.get(stageKey)!;
  const rec = portMap.get(port) ?? {clean:0, suspicious:0, total:0};
  rec.total++;
  if (r.imageResult === 'سليمة') rec.clean++; else rec.suspicious++;
  portMap.set(port, rec);
}
```

The mockup shows only the top 2 ports per stage (compact layout). Render all, truncate to available space or show all.

---

### Page 7 — العينة

| HTML text / element | TypeScript expression |
|---|---|
| `386` — إجمالي المجتمع | `fmtNum(ctx.kpis.totalPopulation)` |
| `386` — إجمالي العينة | `fmtNum(ctx.kpis.totalSample)` |
| `100%` — نسبة التغطية | `fmtPct(ctx.kpis.sampleCoverage)` |
| `0` — CertScan count | **Unavailable directly** — `StageProfile` and `PortProfile` do not expose a `certScanCount`. Compute from `ctx.rows` where `selectedInSample === true` and some certScan flag. If no certScan distinction is tracked, show `'—'` or `'0'`. See "Unavailable Data." |
| Stage-1 card title `المستوى الأول — 143/143` | `\`${sp.stageLabel} — ${fmtNum(sp.sampleSize)}/${fmtNum(sp.population)}\`` for each `StageProfile sp` |
| Stage-1 population column `143` | `fmtNum(sp.population)` |
| Stage-1 sample column `143` | `fmtNum(sp.sampleSize)` |
| Stage-1 coverage `100%` | `fmtPct(sp.coverage)` |
| Per-stage single "جميع المنافذ" row | Render one summary row per stage (the mockup aggregates all ports into one row per stage card) |
| Stage-2 card: same pattern | `stageProfiles.find(s => s.stageKey === 'stage2')` |
| Stage-3 card: same pattern | `stageProfiles.find(s => s.stageKey === 'stage3')` |
| Stage-4 card: same pattern | `stageProfiles.find(s => s.stageKey === 'stage4')` |
| Info box note about 100% coverage | Conditionally rendered: if `ctx.kpis.sampleCoverage >= 99.9` → show that message, else a generic coverage note |

---

### Page 8 — غلاف الجزء الثاني (Part 2 Divider)

**Static divider page.** No data substitution. Hardcode as-is.

---

### Page 9 — نتائج الدقة حسب المنفذ

| HTML text / element | TypeScript expression |
|---|---|
| `XX%` — دقة الفحص الكلية | `fmtPct(ctx.kpis.overallAccuracy)` |
| `XX%` — دقة الاشتباه الكلية | `fmtPct(ctx.kpis.suspiciousDetectionRate)` |
| `00` — حالات الاشتباه المفحوصة | `fmtNum(ctx.kpis.correctSuspicious + ctx.kpis.missedSuspicious)` (total actual suspicious rows that were studied) |
| `XX` — الفجوة (gap between overall accuracy and suspicion detection rate) | `gap(ctx.kpis.overallAccuracy, ctx.kpis.suspiciousDetectionRate)` (absolute difference, in percentage points) |
| Port table — per-row port name | `esc(p.portName)` — loop all `ctx.kpis.portProfiles` |
| Port table — الحالات المفحوصة | `fmtNum(p.studied)` |
| Port table — حالات الاشتباه | Compute from `ctx.rows` filtered by portName where `imageResult === 'اشتباه'` and studied. Or: **Unavailable directly on PortProfile** — compute from `ctx.rows`. See "Unavailable Data." |
| Port table — دقة الاشتباه | `p.suspiciousDetectionRate !== null ? fmtPct(p.suspiciousDetectionRate) : '—'` |
| Port table — دقة الفحص | `p.accuracy !== null ? fmtPct(p.accuracy) : '—'` |
| Port table — الفجوة | `gap(p.accuracy, p.suspiciousDetectionRate)` |

---

### Page 10 — نتائج الدقة حسب المستويات

| HTML text / element | TypeScript expression |
|---|---|
| المستوى الأول card — دقة الفحص `XX%` | **Unavailable directly** — `StageProfile` has no accuracy field. Must compute per-stage accuracy from `ctx.rows`. See "Unavailable Data." Use computed `stageAccuracyMap.get('stage1')?.accuracy ?? null` |
| المستوى الأول card — دقة الاشتباه `XX%` | Similarly computed from `ctx.rows` per stage |
| المستوى الثاني card — same | `stageAccuracyMap.get('stage2')` |
| المستوى الثالث card — same | `stageAccuracyMap.get('stage3')` |
| المستوى الرابع card — same | `stageAccuracyMap.get('stage4')` |
| Summary table — المستوى | `esc(sp.stageLabel)` |
| Summary table — الحالات المفحوصة | `fmtNum(sp.studied)` |
| Summary table — حالات الاشتباه | Compute from `ctx.rows` per stage |
| Summary table — دقة الاشتباه | Computed per stage |
| Summary table — دقة الفحص | Computed per stage |
| Summary table — أبرز ملاحظة | Show `'—'` (no source for free-text observations in the data model) |

**Stage accuracy helper (build once):**
```ts
// Map<stageKey, {accuracy: number|null, suspiciousDetectionRate: number|null, studiedSuspicious: number}>
const stageAccuracyMap = new Map<string, {accuracy:number|null, suspiciousDetectionRate:number|null, studiedSuspicious:number}>();
const stageGroups = new Map<string, ExecutiveReportRow[]>();
for (const r of ctx.rows) {
  if (r.verificationCategory === null) continue;
  const key = r.stage ?? 'unknown';
  if (!stageGroups.has(key)) stageGroups.set(key, []);
  stageGroups.get(key)!.push(r);
}
for (const [key, rows] of stageGroups) {
  const correct = rows.filter(r => r.imageResultAccurate).length;
  const suspRows = rows.filter(r => ['correct-suspicious','missed-suspicious'].includes(r.verificationCategory!));
  const detected = rows.filter(r => r.verificationCategory === 'correct-suspicious').length;
  stageAccuracyMap.set(key, {
    accuracy: rows.length ? (correct / rows.length) * 100 : null,
    suspiciousDetectionRate: suspRows.length ? (detected / suspRows.length) * 100 : null,
    studiedSuspicious: suspRows.length,
  });
}
```

---

### Page 11 — نتائج جودة الصور

| HTML text / element | TypeScript expression |
|---|---|
| `XX%` — الصور عالية الجودة | `fmtPct(ctx.kpis.imageQualityEvaluatedCount > 0 ? ctx.kpis.highQualityCount / ctx.kpis.imageQualityEvaluatedCount * 100 : null)` |
| `XX%` — وجود تحديد | `fmtPct(ctx.kpis.markingRate)` |
| `XX%` — الصور منخفضة الجودة | `fmtPct(ctx.kpis.imageQualityEvaluatedCount > 0 ? ctx.kpis.lowQualityCount / ctx.kpis.imageQualityEvaluatedCount * 100 : null)` |
| `XX%` — الدقة دون تحديد | **Unavailable directly** — compute from `ctx.rows` where `hasMarking === false` and `verificationCategory !== null`. See "Unavailable Data." |
| Port quality table — per-row port | `esc(p.portName)` |
| Port quality table — إجمالي الصور | `fmtNum(p.studied)` (studied = images reviewed) |
| Port quality table — جودة مرتفعة % | **Unavailable on PortProfile** — compute from `ctx.rows` per port. See "Unavailable Data." |
| Port quality table — وجود تحديد % | **Unavailable on PortProfile** — compute from `ctx.rows` per port. |
| Port quality table — دقة الفحص | `p.accuracy !== null ? fmtPct(p.accuracy) : '—'` |
| Port quality table — ملاحظة | Show `'—'` |
| "أدنى 5 منافذ في جودة الصور" bar list | Compute from ctx.rows: group by portName, calc highQuality%, sort ascending, take top 5. Show bar with `p.highQualityPct` width and `esc(p.portName) + ' — ' + fmtPct(p.highQualityPct)` |
| "مقارنة الدقة حسب التحديد" bars | With-marking bar width: from computed `markingAccuracy`; without-marking: `noMarkingAccuracy`. Both computed from `ctx.rows`. |
| "أسباب انخفاض الجودة" list | `ctx.kpis.lowQualityReasons.map(r => esc(r.reason)).join('<br>')` — or show each as a paragraph. If empty, show note. |

**Per-port quality helper (build once):**
```ts
const portQualityMap = new Map<string, {total:number, high:number, marked:number}>();
for (const r of ctx.rows) {
  if (r.answerStatus !== 'submitted') continue;
  const port = r.portName ?? 'غير محدد';
  const rec = portQualityMap.get(port) ?? {total:0, high:0, marked:0};
  rec.total++;
  if (r.imageQuality === 'عالي') rec.high++;
  if (r.hasMarking === true) rec.marked++;
  portQualityMap.set(port, rec);
}
// highQualityPct = rec.high / rec.total * 100
// markingPct = rec.marked / rec.total * 100
```

**Marking accuracy helper:**
```ts
const markedRows = ctx.rows.filter(r => r.hasMarking === true && r.verificationCategory !== null);
const unmarkedRows = ctx.rows.filter(r => r.hasMarking === false && r.verificationCategory !== null);
const markingAccuracy = markedRows.length ? markedRows.filter(r => r.imageResultAccurate).length / markedRows.length * 100 : null;
const noMarkingAccuracy = unmarkedRows.length ? unmarkedRows.filter(r => r.imageResultAccurate).length / unmarkedRows.length * 100 : null;
```

---

### Page 12 — الأصناف وآليات التهريب

| HTML text / element | TypeScript expression |
|---|---|
| `00` — حالات الاشتباه المؤكدة | `fmtNum(ctx.kpis.correctSuspicious)` |
| `00` — الأصناف المصنفة | **Unavailable as a KPI** — compute from `ctx.rows`: distinct non-empty `suspectedTypes` values. Count distinct categories after splitting comma-separated values. See "Unavailable Data." |
| `00` — آليات التهريب المحتملة | **Unavailable as a KPI** — compute from `ctx.rows`: distinct non-empty `smuggleMethod` values. |
| `[اسم الصنف]` — أعلى صنف تكرارًا | Compute top `suspectedTypes` value from `ctx.rows`. |
| "الأصناف الأكثر تكرارًا" bar rows | Build frequency map from `ctx.rows.map(r => r.suspectedTypes).filter(Boolean)`, split by comma/semicolon, count, sort desc, take top 3. For each: `esc(categoryName)` + bar width `(count/maxCount*100).toFixed(0)+'%'` |
| "آليات التهريب الأكثر تكرارًا" bar rows | Same pattern for `smuggleMethod` field |
| Heatmap cells `XX` | Cross-tabulate top smuggle categories × top methods from `ctx.rows`. Each cell = count of rows matching both. |
| "أبرز الملاحظات" bullet points | **Static text** — hardcode the 4 observation bullets as they are analytical meta-commentary, not driven by data fields |

**Type/method frequency helper:**
```ts
function buildFreqMap(rows: ExecutiveReportRow[], field: 'suspectedTypes' | 'smuggleMethod'): {label:string, count:number}[] {
  const freq = new Map<string, number>();
  for (const r of rows) {
    const val = r[field];
    if (!val) continue;
    val.split(/[,،;]/).map(s => s.trim()).filter(Boolean).forEach(v => {
      freq.set(v, (freq.get(v) ?? 0) + 1);
    });
  }
  return [...freq.entries()].map(([label, count]) => ({label, count})).sort((a,b) => b.count - a.count);
}
const typeFreq = buildFreqMap(ctx.rows, 'suspectedTypes');
const methodFreq = buildFreqMap(ctx.rows, 'smuggleMethod');
```

---

### Page 13 — غلاف التحاليل المتقدمة (Part 3 Divider)

**Static divider page.** No data substitution. Hardcode as-is.

---

### Page 14 — خريطة التحليلات المتقدمة

All content is **static** — it describes the report structure, not actual data.
No data substitution. Hardcode as-is.

---

### Page 15 — النظرة العامة لأداء الموظفين

```ts
const profiles = buildEmployeeProfiles(ctx.rows, ctx.input.config.minimumReliableSampleSize);
const minSample = ctx.input.config.minimumReliableSampleSize;
```

| HTML text / element | TypeScript expression |
|---|---|
| `6` — الموظفون المقيمون | `fmtNum(profiles.length)` |
| `00` — إجمالي القرارات | `fmtNum(profiles.reduce((s,p) => s + p.workload, 0))` |
| `XX%` — متوسط الدقة | `fmtPct(profiles.filter(p=>p.reliable).reduce((s,p,_,arr) => s + (p.overallAccuracy ?? 0)/arr.length, 0) \|\| null)` — or compute as: `safeAvg(profiles.filter(p=>p.reliable).map(p=>p.overallAccuracy))` |
| `XX%` — أفضل دقة | `fmtPct(profiles.filter(p=>p.reliable&&p.overallAccuracy!==null).reduce((best,p)=>Math.max(best,p.overallAccuracy!), 0) \|\| null)` |
| `XX%` — أعلى تفاوت (highest variability) | `fmtPct(profiles.filter(p=>p.reliable&&p.stabilityIndex!==null).reduce((max,p)=>Math.max(max,p.stabilityIndex!), 0) \|\| null)` — stabilityIndex is stdev of per-port accuracy |
| Employee table — per row — الموظف name | `esc(ctx.displayName(p.username))` |
| Employee table — القرارات | `fmtNum(p.workload)` |
| Employee table — المستوى الأول | `p.levelOneAccuracy !== null ? fmtPct(p.levelOneAccuracy) : '—'` |
| Employee table — المستوى الثاني | `p.levelTwoAccuracy !== null ? fmtPct(p.levelTwoAccuracy) : '—'` |
| Employee table — دقة الفحص | `p.reliable ? fmtPct(p.overallAccuracy) : '—'` |
| Employee table — دقة الاشتباه | `p.reliable && p.suspiciousDetectionRate !== null ? fmtPct(p.suspiciousDetectionRate) : '—'` |
| Employee table — معدل الاكتشاف | Same as دقة الاشتباه: `p.suspiciousDetectionRate` |
| Employee table — المنافذ (port count) | `fmtNum(p.byPort.size)` |
| Employee table — التصنيف chip | `!p.reliable ? '<span class="chip red">بيانات غير كافية</span>' : badgeForScore(p)` — derive chip class from `p.riskScore` or map from a port-like status. **Unavailable directly** — EmployeeProfile has no `status` field like PortProfile. Map from `p.recommendedAction` or compute from riskScore. See "Unavailable Data." |
| "أفضل 5 موظفين" bar list | `profiles.filter(p=>p.reliable).slice(0,5).map(p => esc(ctx.displayName(p.username)) + ' bar at ' + fmtPct(p.overallAccuracy))` |

**Employee chip mapping (derive from riskScore / recommendedAction):**
```ts
function employeeChip(p: EmployeeProfile): string {
  if (!p.reliable) return '<span class="chip red">بيانات غير كافية</span>';
  if (p.riskScore >= 30) return '<span class="chip red">أولوية تدخل</span>';
  if (p.riskScore >= 15) return '<span class="chip orange">يحتاج متابعة</span>';
  if ((p.overallAccuracy ?? 0) >= 90) return '<span class="chip green">متميز</span>';
  return '<span class="chip blue">مستقر</span>';
}
```

---

### Page 16 — دقة الموظفين حسب القرار

| HTML text / element | TypeScript expression |
|---|---|
| `XX%` — الدقة الكلية | `fmtPct(ctx.kpis.overallAccuracy)` |
| `XX%` — اكتشاف الاشتباه | `fmtPct(ctx.kpis.suspiciousDetectionRate)` |
| `XX%` — الاشتباه الفائت | `fmtPct(ctx.kpis.missedSuspicionRate)` |
| `XX%` — الاشتباه الخاطئ | `fmtPct(ctx.kpis.excessSuspicionRate)` |
| Quadrant panel | Static layout — labels hardcoded |
| Decision-type summary table — الموظف | `esc(ctx.displayName(p.username))` — loop `profiles` |
| Summary table — السليمة count | Count of rows where `expertResult === 'سليمة'` for this employee. Compute from `ctx.rows` filtered by `assignedTo === p.username`. Or from `p.byDecision.onClean` which is the accuracy on clean rows — not the count. **The count is not directly on EmployeeProfile.** Compute: `ctx.rows.filter(r => r.assignedTo === p.username && r.expertResult === 'سليمة' && r.verificationCategory !== null).length` |
| Summary table — دقة السليمة | `p.byDecision.onClean !== null ? fmtPct(p.byDecision.onClean) : '—'` |
| Summary table — الاشتباه count | `ctx.rows.filter(r => r.assignedTo === p.username && r.expertResult === 'اشتباه' && r.verificationCategory !== null).length` |
| Summary table — الاكتشاف % | `p.suspiciousDetectionRate !== null ? fmtPct(p.suspiciousDetectionRate) : '—'` |
| Summary table — الخاطئ % | `p.excessSuspicionRate !== null ? fmtPct(p.excessSuspicionRate) : '—'` |

---

### Page 17 — أداء الموظفين حسب المنفذ (example port: الوديعة)

This page is a **per-port drill-down**. In the implemented report, there should be one such page per major port, or a loop that selects the top ports. The mockup shows الوديعة as the example.

| HTML text / element | TypeScript expression |
|---|---|
| `00` — الحالات المفحوصة (for this port) | `fmtNum(portProfile.studied)` where `portProfile = ctx.kpis.portProfiles.find(p => p.portName === portName)` |
| `6` — عدد الموظفين (in this port) | `fmtNum(portEmployees.length)` where `portEmployees = profiles.filter(p => p.byPort.has(portName))` |
| `XX%` — دقة الفحص (port overall) | `fmtPct(portProfile.accuracy)` |
| `XX%` — دقة الاشتباه (port overall) | `fmtPct(portProfile.suspiciousDetectionRate)` |
| `00` — الاشتباه الفائت count | Compute from `ctx.rows.filter(r => r.portName === portName && r.verificationCategory === 'missed-suspicious').length` |
| Employee table — الموظف | `esc(ctx.displayName(p.username))` |
| Employee table — القرارات | `fmtNum(p.byPort.get(portName)?.studied ?? 0)` |
| Employee table — المستوى الأول | `p.levelOneAccuracy !== null ? fmtPct(p.levelOneAccuracy) : '—'` (note: EmployeeProfile.levelOneAccuracy is global, not per-port. Per-port L1 accuracy is **Unavailable**.) |
| Employee table — المستوى الثاني | Same caveat as above |
| Employee table — دقة الفحص | `fmtPct(p.byPort.get(portName)?.accuracy ?? null)` |
| Employee table — دقة الاشتباه | **Unavailable per port on EmployeeProfile** — `p.byPort` only has `{studied, accuracy}`. No per-port suspiciousDetectionRate. Show `'—'` or compute from `ctx.rows`. |
| Employee table — مقارنة بالمتوسط | `portAccuracyDiff = (p.byPort.get(portName)?.accuracy ?? null) - (portProfile.accuracy ?? 0)` — format with sign: `(diff >= 0 ? '+' : '') + fmtNum(Math.round(diff))` |
| Employee table — التصنيف chip | Use `employeeChip(p)` |
| "أفضل 3 موظفين" list | Sort `portEmployees` by `p.byPort.get(portName)?.accuracy` desc, take top 3, display `ctx.displayName(p.username)` |
| "أقل 3 موظفين" list | Same, ascending, take top 3 |
| "ملاحظات المنفذ" panel | **Static labels** — no direct data source for free-text observations |

---

### Page 18 — مقارنة الموظفين بين المنافذ

| HTML text / element | TypeScript expression |
|---|---|
| `11` — المنافذ المقارنة | `fmtNum(ctx.kpis.portProfiles.length)` |
| `[اسم المنفذ]` — أفضل منفذ | `esc(ctx.kpis.portProfiles.slice().sort((a,b) => (b.accuracy ?? -1) - (a.accuracy ?? -1))[0]?.portName ?? '—')` |
| `XX%` — أكبر فرق أداء | Max minus min accuracy across ports: `fmtPct(maxPortAccuracy - minPortAccuracy)` |
| `[اسم الموظف]` — أكثر الموظفين استقرارًا | `esc(ctx.displayName(profiles.filter(p=>p.reliable&&p.stabilityIndex!==null).sort((a,b)=>(a.stabilityIndex!-b.stabilityIndex!))[0]?.username ?? ''))` — lowest stdev = most stable |
| Matrix table — header columns (port names) | `ctx.kpis.portProfiles.map(p => \`<th>${esc(p.portName)}</th>\`).join('')` |
| Matrix table — row per employee | `profiles.map(p => ...)` — for each port column: `heatCell(p.byPort.get(portProfile.portName)?.accuracy ?? null)` |
| "أفضل منفذ لكل موظف" list | For each employee: find port with highest accuracy in `p.byPort`, display `esc(ctx.displayName(p.username)) + ' — ' + esc(bestPort)` |
| "أضعف منفذ لكل موظف" list | Same, lowest accuracy port |

---

### Page 19 — استقرار الأداء وعبء العمل

| HTML text / element | TypeScript expression |
|---|---|
| `XX%` — متوسط الدقة | `fmtPct(ctx.kpis.overallAccuracy)` |
| `XX%` — تذبذب الأداء | `fmtPct(profiles.filter(p=>p.reliable&&p.stabilityIndex!==null).reduce((s,p,_,arr)=>s+(p.stabilityIndex!)/arr.length,0) || null)` — average stdev across reliable employees |
| `00` — أعلى حمل يومي | **Unavailable** — EmployeeProfile tracks total workload, not daily breakdown. Show `fmtNum(Math.max(...profiles.map(p=>p.workload)))` (total workload, not daily). Note this in comments. |
| `+XX` — فرق الدقة (difference between high-load and low-load employees) | **Unavailable directly** — compute by splitting profiles at median workload and comparing average accuracy of top-half vs bottom-half by workload. |
| Stability table — الموظف | `esc(ctx.displayName(p.username))` |
| Stability table — متوسط الدقة | `p.reliable ? fmtPct(p.overallAccuracy) : '—'` |
| Stability table — التذبذب | `p.stabilityIndex !== null ? fmtPct(p.stabilityIndex) : '—'` |
| Stability table — الاتجاه (↗/→/↘) | **Unavailable** — EmployeeProfile has no trend field (no time-series in current data model). Show `'—'` or a static `'→'`. |
| Scatter plot bubbles | Each employee as a bubble: X = `p.workload`, Y = `p.overallAccuracy`, size = `p.workload` (relative). Position as CSS `left`/`bottom` percentages relative to max workload and 0–100% accuracy range. Color: green if reliable+high accuracy, gold if medium, coral if low. |

---

### Page 20 — أثر جودة الصورة والتحديد على الأداء

| HTML text / element | TypeScript expression |
|---|---|
| `XX%` — جودة عالية (accuracy when high quality) | Compute from `ctx.rows`: `safeRate(highQualityCorrect, highQualityStudied)` |
| `XX%` — جودة منخفضة (accuracy when low quality) | Compute from `ctx.rows` |
| `XX%` — مع تحديد (accuracy when marking present) | Use global `markingAccuracy` computed in Page 11 section |
| `XX%` — دون تحديد (accuracy when no marking) | Use global `noMarkingAccuracy` |
| Quadrant cells (high+marked, high+unmarked, low+marked, low+unmarked) | Compute 4-way cross from `ctx.rows` |
| Per-employee table — جودة عالية | `p.byImageQuality['عالي'].accuracy !== null ? fmtPct(p.byImageQuality['عالي'].accuracy) : '—'` |
| Per-employee table — جودة منخفضة | `p.byImageQuality['منخفض'].accuracy !== null ? fmtPct(p.byImageQuality['منخفض'].accuracy) : '—'` |
| Per-employee table — مع تحديد | `p.byMarking.marked.accuracy !== null ? fmtPct(p.byMarking.marked.accuracy) : '—'` |
| Per-employee table — دون تحديد | `p.byMarking.unmarked.accuracy !== null ? fmtPct(p.byMarking.unmarked.accuracy) : '—'` |
| Per-employee table — فرق الأثر | `gap(p.byMarking.marked.accuracy, p.byMarking.unmarked.accuracy)` with + sign prefix |

---

### Page 21 — تحليل أنواع الأخطاء

| HTML text / element | TypeScript expression |
|---|---|
| `XX%` — اشتباه صحيح % | `fmtPct(ctx.kpis.validStudied > 0 ? ctx.kpis.correctSuspicious / ctx.kpis.validStudied * 100 : null)` |
| `XX%` — اشتباه فائت % | `fmtPct(ctx.kpis.validStudied > 0 ? ctx.kpis.missedSuspicious / ctx.kpis.validStudied * 100 : null)` |
| `XX%` — اشتباه خاطئ % | `fmtPct(ctx.kpis.validStudied > 0 ? ctx.kpis.excessSuspicious / ctx.kpis.validStudied * 100 : null)` |
| `XX%` — سليمة صحيحة % | `fmtPct(ctx.kpis.validStudied > 0 ? ctx.kpis.correctClean / ctx.kpis.validStudied * 100 : null)` |
| Confusion matrix quadrant | Static layout — the 4 quadrant labels are hardcoded. No numeric values in the quadrant cells themselves in the mockup. |
| Error type table — الموظف | `esc(ctx.displayName(p.username))` |
| Error type table — اشتباه صحيح % | Compute from `ctx.rows` for this employee: `rows.filter(r=>r.assignedTo===p.username && r.verificationCategory==='correct-suspicious').length / studied * 100` |
| Error type table — اشتباه فائت % | Same for `'missed-suspicious'` |
| Error type table — اشتباه خاطئ % | Same for `'excess-suspicious'` |
| Error type table — سليمة صحيحة % | Same for `'correct-clean'` |
| Error type table — أبرز نمط خطأ | **Unavailable** — no data field for free-text error pattern. Show `'—'` |

---

### Page 22 — مقارنة المستويين والتوافق

| HTML text / element | TypeScript expression |
|---|---|
| `XX%` — دقة المستوى الأول | `fmtPct(ctx.kpis.levelOneAccuracy)` |
| `XX%` — دقة المستوى الثاني | `fmtPct(ctx.kpis.levelTwoAccuracy)` |
| `XX%` — نسبة الاتفاق | **Unavailable directly as a single KPI** — `ctx.kpis` has `levelDisagreementRate`, so: `fmtPct(ctx.kpis.levelDisagreementRate !== null ? 100 - ctx.kpis.levelDisagreementRate : null)` |
| `000` — الحالات المعدلة | Compute from `ctx.rows` where L1 and L2 results differ: `ctx.rows.filter(r=>r.levelOneResult!==r.levelTwoResult).length` |
| L1 vs L2 comparison table — دقة الفحص row | L1: `fmtPct(ctx.kpis.levelOneAccuracy)`, L2: `fmtPct(ctx.kpis.levelTwoAccuracy)`, Diff: `gap(ctx.kpis.levelOneAccuracy, ctx.kpis.levelTwoAccuracy)` with sign |
| L1 vs L2 table — دقة الاشتباه row | L1 susp. detection from stageAccuracyMap L1 perspective; **complex to compute** — see "Unavailable Data" note. Approximate: show from port L1/L2 accuracy fields if per-stage not available |
| L1 vs L2 table — الحالات المعدلة | Same as above count |
| L1 vs L2 table — التعديلات الصحيحة | `ctx.kpis.levelTwoCorrectionRate !== null ? fmtPct(ctx.kpis.levelTwoCorrectionRate) : '—'` |
| Employee agreement matrix — header row (employee names) | `profiles.map(p => \`<th>${esc(ctx.displayName(p.username))}</th>\`).join('')` |
| Matrix cells (e.g. `82%`) | **Unavailable** — pairwise agreement between employees is not computed in any current type. This is a significant missing feature. Show `'—'` in all cells, or omit the matrix and show a notice. |

---

### Page 23 — الأولوية والإجراءات

```ts
const priorityList = buildPriorityList(profiles);
// priorityList = reliable profiles sorted by riskScore desc
```

| HTML text / element | TypeScript expression |
|---|---|
| `01` — دعم عاجل count | `fmtNum(priorityList.filter(p => p.riskScore >= 30).length)` (threshold TBD — see below) |
| `02` — تدريب موجه count | `fmtNum(priorityList.filter(p => p.riskScore >= 15 && p.riskScore < 30).length)` |
| `02` — متابعة count | `fmtNum(priorityList.filter(p => p.riskScore > 0 && p.riskScore < 15).length)` |
| `01` — متميز count | `fmtNum(priorityList.filter(p => p.riskScore === 0).length)` |
| Priority table — الموظف | `esc(ctx.displayName(p.username))` — loop `priorityList` |
| Priority table — الملاحظة الرئيسية | Derive from `p.recommendedAction` (string already in Arabic) |
| Priority table — الدليل (evidence) | **Unavailable as a formatted string** — construct from metrics: `missedSuspicionRate`, `overallAccuracy`. E.g.: `p.missedSuspicionRate !== null ? \`معدل فائت: ${fmtPct(p.missedSuspicionRate)}\` : (p.overallAccuracy !== null ? \`دقة: ${fmtPct(p.overallAccuracy)}\` : '—')` |
| Priority table — الإجراء المقترح | `esc(p.recommendedAction)` — already a well-formed Arabic string from `executiveEmployeeData.ts` |
| Priority table — الأولوية chip | Map from riskScore: `p.riskScore >= 30 ? '<span class="chip red">حرج</span>' : p.riskScore >= 15 ? '<span class="chip orange">مرتفع</span>' : '<span class="chip orange">متوسط</span>'` |
| "موظف 01", "موظف 02" labels in mockup | These are the anonymized form — replace with `esc(ctx.displayName(p.username))` |
| Intervention matrix quadrant | **Static layout** — quadrant labels hardcoded, no data |
| "أهم التوصيات التنفيذية" bullet list | **Static text** — hardcode the 5 bullet points as they are general recommendations |

**Recommended riskScore thresholds (derived from `executiveEmployeeData.ts` logic):**
- `riskScore >= 30` → حرج (urgent support needed)
- `riskScore >= 15` → مرتفع (targeted training)
- `riskScore > 0` → متوسط (monitoring)
- `riskScore === 0` → منخفض (excellent / stable)

---

## 4. Unavailable Data — Fields Missing from Current Types

The following values appear in the HTML mockup but have **no direct source** in
`ExecutiveKPIs`, `PortProfile`, `StageProfile`, or `EmployeeProfile`. Each entry
states the mockup usage and the recommended fallback.

### 4.1 Port type (land vs sea) — `portType` on PortProfile
- **Mockup:** Page 5 splits ports into land vs sea tables
- **Status:** `PortProfile` has no `portType` field
- **Fix:** Build `portTypeMap` from `ctx.rows` (each row has `portType: string | null`). Build once before rendering. Key on `portName`.
- **Expression:** `portTypeMap.get(p.portName) === 'land'`

### 4.2 CertScan count
- **Mockup:** Page 7 KPI card shows `0` for CertScan
- **Status:** No `certScanCount` field anywhere. `ExecutiveReportRow` has `selectedInSample: boolean` but no CertScan-specific marker.
- **Fix:** Show `'0'` hardcoded if not tracked, or add a computed field. For now, show `'—'` with a footnote.

### 4.3 Stage-level accuracy, suspiciousDetectionRate
- **Mockup:** Pages 10, 6 need per-stage accuracy stats
- **Status:** `StageProfile` only has `{population, sampleSize, coverage, studied, completionRate}` — no accuracy
- **Fix:** Compute `stageAccuracyMap` from `ctx.rows` (helper provided above in Page 10 section)

### 4.4 Per-port quality metrics (highQuality%, markingRate%, etc.)
- **Mockup:** Page 11 quality table needs per-port high-quality % and marking %
- **Status:** `PortProfile` has no `highQualityCount`, `markingPresentCount`, or derived rates
- **Fix:** Compute `portQualityMap` from `ctx.rows` (helper provided above in Page 11 section)

### 4.5 Accuracy by marking presence (global)
- **Mockup:** Page 11 "مقارنة الدقة حسب التحديد" bar
- **Status:** No direct KPI field
- **Fix:** Compute `markingAccuracy` and `noMarkingAccuracy` from `ctx.rows` (helper provided above)

### 4.6 Suspected types count and top category
- **Mockup:** Page 12 — count of distinct classified types and most frequent type
- **Status:** No KPI field for this
- **Fix:** Compute from `ctx.rows.map(r=>r.suspectedTypes)` (helper provided above in Page 12 section)

### 4.7 Smuggle methods count and top method
- **Mockup:** Page 12 — count of distinct smuggle methods and most frequent
- **Status:** No KPI field
- **Fix:** Same as above with `smuggleMethod` field

### 4.8 Employee classification chip / status field
- **Mockup:** Pages 15, 17 — chips like "متميز", "مستقر", "يحتاج متابعة", "بيانات غير كافية"
- **Status:** `EmployeeProfile` has no `status` field (unlike `PortProfile` which has a `status` string enum)
- **Fix:** Use `employeeChip(p)` function mapping from `p.riskScore` and `p.reliable` (defined above in Page 15 section)

### 4.9 Per-port level-1 / level-2 accuracy for employee
- **Mockup:** Page 17 table — L1 and L2 accuracy per employee per port
- **Status:** `EmployeeProfile.byPort` only has `{studied, accuracy}` — no L1/L2 breakdown per port
- **Fix:** Show `'—'` in those columns, or compute from `ctx.rows` per `(assignedTo, portName)` pair

### 4.10 Per-port suspicious detection rate for employee
- **Mockup:** Page 17 table — دقة الاشتباه per employee per port
- **Status:** `EmployeeProfile.byPort` has no `suspiciousDetectionRate`
- **Fix:** Compute from `ctx.rows` filtered by `(assignedTo, portName)`. Or show `'—'`.

### 4.11 Performance trend (↗ / → / ↘)
- **Mockup:** Page 19 stability table — الاتجاه column
- **Status:** No time-series data in any type (all data is single-month)
- **Fix:** Show `'—'` for all rows. Note in report as "غير متاح في دورة واحدة".

### 4.12 Daily workload maximum
- **Mockup:** Page 19 — "أعلى حمل يومي"
- **Status:** `EmployeeProfile.workload` is total, not daily. No date-based grouping available.
- **Fix:** Show `fmtNum(Math.max(...profiles.map(p=>p.workload)))` labeled as "أعلى إجمالي" or show `'—'`.

### 4.13 Pairwise employee agreement matrix
- **Mockup:** Page 22 — نسبة الاتفاق between each pair of employees
- **Status:** Not computed anywhere. Would require cross-joining rows where two employees reviewed the same image.
- **Fix:** Show a notice card instead of the matrix: `"مصفوفة التوافق غير متاحة — تتطلب مراجعة نفس الصورة من موظفَين اثنين"`. The matrix cells should all show `'—'`.

### 4.14 Level-1 vs Level-2 suspicious detection rate comparison
- **Mockup:** Page 22 comparison table — دقة الاشتباه for L1 vs L2 separately
- **Status:** `ctx.kpis.levelOneAccuracy` and `ctx.kpis.levelTwoAccuracy` cover overall accuracy, not suspicious-specific
- **Fix:** Compute from `ctx.rows`: for each row, compare `levelOneResult` vs `expertResult` (for suspicious subset). Or show `'—'` with a footnote.

### 4.15 Free-text port observations (ملاحظات)
- **Mockup:** Pages 9, 11 — ملاحظة column in tables
- **Status:** No free-text observation field in any type
- **Fix:** Show `'—'` in all ملاحظة cells.

### 4.16 Quadrant placement for workload-vs-accuracy scatter (Page 19)
- The scatter plot in Page 19 shows employees as positioned bubbles
- **Fix:** Compute X as `p.workload / maxWorkload * 100`, Y as `p.overallAccuracy ?? 0`, size relative to workload. Position with CSS `left`/`bottom` percentages.

---

## 5. Issue Date vs Month Label — Important Distinction

| Variable | Meaning | Expression |
|---|---|---|
| `ctx.monthLabel` | The population month being analyzed, e.g. `"مايو 2026"` | Use for "مجتمع الحالات محل الدراسة" |
| `ctx.issueDate` | The date the report was generated, e.g. `"29 / 06 / 2026"` | Use for "دورة التقرير" / "تاريخ الإصدار" |

The mockup cover says:
- `دورة التقرير: يونيو 2026` → This is the **report cycle month** (issue month). Derive as: format `ctx.issueDate` into month name, or compute separately as `new Date()` month at build time. Suggested: add a `ctx.issueMonthLabel: string` field to `ExecutiveRenderContext`, or extract from `ctx.issueDate` string.
- `مجتمع الحالات محل الدراسة: مايو 2026` → `ctx.monthLabel`

---

## 6. fmtPct vs Raw Number — Precision Notes

- All accuracy fields (0–100 scale) use `fmtPct(n)` which shows 1 decimal place
- All count fields use `fmtNum(n)` — integer, no decimals
- The `gap` / difference values shown in the mockup as `XX` (no %) represent percentage-point gaps — use `fmtNum(Math.round(Math.abs(a - b)))` followed by " نقطة" if needed
- For bar widths: `style="width:${Math.min(100, value).toFixed(1)}%"` — clamp at 100

---

## 7. Loop Order Conventions

| Page | Array | Sort order |
|---|---|---|
| Pages 5, 9 | `portProfiles` | By `population` desc (largest first), then land before sea for grouped tables |
| Page 6 | `stageProfiles` | By stageKey (`stage1` → `stage4`) |
| Page 7 | `stageProfiles` | Same |
| Pages 15, 16, 21 | `buildEmployeeProfiles(...)` | Already sorted by `overallAccuracy` desc |
| Page 23 | `buildPriorityList(profiles)` | Already sorted by `riskScore` desc, reliable-only |
| Page 18 matrix | `profiles` (rows) × `portProfiles` (columns) | Employees by accuracy desc; ports by population desc |

