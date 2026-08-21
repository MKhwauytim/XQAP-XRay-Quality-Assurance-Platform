# Ad-hoc Import Rework + Historical Study Import — Implementation Plan

**Status:** proposed — needs owner approval before any code lands
**Date:** 2026-08-21 · **Revision 2** (owner feedback incorporated)
**Scope owner request:**

1. Feed the page from **either a population file or an already-drawn sample**.
2. Source columns have **different or near-matching names** vs. the app's fields — detect and map them.
3. Assign the resulting rows to employees in **four different ways**.
4. Accept input as **an uploaded Excel file (A)** or **a copy-pasted block of Excel columns (B)**.
5. **Move the ad-hoc page under `إدارة بيانات الأشعة`** (the Population tab) instead of standing alone.
6. **New:** import **previously-studied samples** — map population columns *and* the study
   template's answer fields, accepting that an old study will not fill every field of a
   template that did not exist when the study was done.

### Owner corrections folded into revision 2

| # | Correction | Where it lands |
|---|---|---|
| C1 | Ad-hoc **must not run through the established Population pipeline**. It owns its own mapping/validation/projection functions and **links into the existing distribution machinery**, reusing most of it. | §4 — module layout inverted; `normalizeRiskRow` dependency cut; new `adhocDistributionBridge.ts` is the single declared seam |
| C2 | The mapping UX is **CertScan's**: pick a target, click the column, the column tints (blue / red). Auto-map first from the app's existing mapping, then let me correct it. | §5.2 — modeled directly on `CertScanGrid`'s `activeHL` → `handleColClick` interaction |
| C3 | **Isolated by default**, but I can bind an import to a study month (`شهر الفحص`) — either from a mapped date column, or (preferred) by uploading one file per month and picking the month. | §4.6 — `monthBinding` tagged union; `studyMonth` is a *mappable field*, never a hardcoded column name |
| C4 | Confirms §8 Q5: "same as CertScan" meant the **column-picking interaction**, not CertScan reference matching. | Q5 closed |

Still open: **Q1 (fan-out semantics)** and **Q2 (count-mode shortfall)** — see §8.

---

## 1. What exists today

| Piece | File | What it does |
|---|---|---|
| Tab | `src/components/Sidebar/Tabs/AdhocImport/index.tsx` | Top-level admin tab, `order: 97`, `group: "system"` |
| Types | `src/data/adhocImport/adhocImportTypes.ts` | `AdhocImportRecord` / `AdhocImportRow` / index entry |
| Parse+map | `src/data/adhocImport/adhocImportMapping.ts` | Reads every sheet, maps with `normalizeRiskRow`, validates |
| Storage | `src/data/adhocImport/adhocImportStorage.ts` | CAS read-modify-write of `5-system/adhoc-imports/{importId}.json` + shared index |
| Assign | `src/data/adhocImport/adhocImportAssignment.ts` | Projects to `PreparedPopulationRow`, writes synthetic `sample.master.json`, appends `assigned` events |
| Employee read | `src/data/adhocImport/adhocImportEmployeeView.ts` | Surfaces ad-hoc rows in EmployeeWorkspace and routes writes back to the right store |

Current flow:

```
.xlsx → worksheetToSourceRows() per sheet
      → normalizeRiskRow(row, columnMappings = config.mappingTemplates[0].columnMappings)
      → validate: xrayImageId present AND L1 ∈ {سليمة, اشتباه} AND L2 ∈ {سليمة, اشتباه}
      → save 5-system/adhoc-imports/{importId}.json
      → ensureAdhocSampleMaster → 2-samples/adhoc-{importId}/1-main/sample.master.json
      → admin ticks rows + picks ONE employee
      → buildAssignEvent + appendDistributionEvents (synthetic month `adhoc-{importId}`)
```

### Gaps against the request

| # | Gap | Consequence today |
|---|---|---|
| G1 | Mapping is **implicit and invisible**. Aliases come from `mappingTemplates[0]`; there is no UI. | A file whose header reads `Image ID` or `رقم الصورة` (not in the alias list) yields **0 valid rows** with no in-page remedy. This exact failure already burned the team once on 2026-08-12 (246,627 parsed / 0 accepted). |
| G2 | No paste input — file only. | Request 4B unmet. |
| G3 | Assignment is **manual row-tick → one employee**. | Requests 3A (count per employee), 3C (fan-out to all), 3D (percentage) unmet. |
| G4 | `certScanStatus` is **hardcoded `"NonCertscan"`**; `stage` is never validated. | No stage-aware or CertScan-aware allocation is possible on ad-hoc rows. |
| G5 | Both L1 and L2 are **hard-required**. | A "ready sample" that is just a list of images to review cannot be imported at all. |
| G6 | Tab is top-level under `group: "system"`. | Request 5 unmet. |
| G7 | No path to import an **already-answered** study. | Request 6 unmet. |
| **G8** | **`src/data/adhocImport/` imports four symbols out of `src/components/Sidebar/Tabs/Population/**`** and reads the live Population mapping template. | **C1's concrete defect.** A data-layer module depends on a component subtree, and an admin editing Population's column aliases silently changes how ad-hoc files parse. |

---

## 2. C1 — "its own functions, linked to distribution"

Today's coupling, all of it wrong-way:

```
src/data/adhocImport/adhocImportMapping.ts
  → components/Sidebar/Tabs/Population/riskData/riskDataNormalizer  (normalizeRiskRow)
  → components/Sidebar/Tabs/Population/riskData/riskDataTypes       (NormalizedRiskRow, RiskSourceRow)
  → components/Sidebar/Tabs/Population/workbook/worksheetRows       (worksheetToSourceRows)
  → data/population/populationConfig                                (mappingTemplates[0], read LIVE)
```

`AdhocImportRow.mapped` is even *typed* as `NormalizedRiskRow` — the ad-hoc record's on-disk shape
is defined by the Population tab's risk-ingest type. That is the pipeline coupling to cut.

**What ad-hoc owns after this change**

| Concern | New module | Note |
|---|---|---|
| Reading a source table | `adhocSourceTable.ts` | file **and** paste |
| Which fields exist, and their seed aliases | `adhocFieldCatalog.ts` | **snapshotted** into the import record, not read live |
| The mapping model + auto-detect | `adhocMappingModel.ts` | |
| Row projection + validation + value coercion | `adhocRowProjection.ts` | replaces the `normalizeRiskRow` call |
| Assignment planning | `adhocAssignmentPlan.ts` | pure, no I/O |
| **Everything that touches distribution** | `adhocDistributionBridge.ts` | the single declared seam |

**What ad-hoc keeps reusing — deliberately, because it *is* the distribution machinery:**

```
data/distribution/distributionLog       buildAssignEvent, buildCompletedEvent
data/distribution/distributionStorage   appendDistributionEvents,
                                        loadOrDeriveDistributionCurrent,
                                        refreshDistributionCacheAfterWrite
data/distribution/bulkAssignment        findAssignableEmployee, isAssignableSampleRole
data/sampling/sampleStorage             loadSampleMaster, saveSampleMaster
data/sampling/apportionment             hamiltonApportionment      (percentage mode)
data/sampling/rng                       createRng, shuffleInPlace  (unbiased allocation)
data/answers/answerStorage              upsertItemAnswer           (historical import)
data/population/monthFolder             formatMonthFolderName, parseMonthFolderName
data/storage/*                          safeWrite, casLoop, webLocks, jsonEnvelope
```

Confining all of those to `adhocDistributionBridge.ts` means the coupling is one file wide,
reviewable in one sitting, and the rest of the ad-hoc module is pure and testable without I/O.

**One shared utility should move rather than be duplicated.**
`worksheetRows.ts` (`worksheetToSourceRows`) is not pipeline logic — it is a battle-tested Excel
reader carrying two hard-won fixes: large-integer IDs preserved as strings (SheetJS stores ≥16-digit
IDs as floats), and `blankrows: true` so `sourceRowNumber` points at the user's real spreadsheet
line. Re-implementing that in ad-hoc would reintroduce both bugs. Move it to
`src/data/workbook/worksheetRows.ts` and have Population and ad-hoc both import from there. That is
sharing a utility, not routing through a pipeline.

**Ad-hoc still emits `PreparedPopulationRow`** — not because it goes through the Population
pipeline, but because that is the row shape `sample.master.json` and `foldDistributionEvents`
consume. The bridge is where the projection happens, and it is ad-hoc's own function
(`projectToDistributionRow`), not a Population import.

---

## 3. The one genuinely hard problem: assignment mode C (fan-out)

> *"or I assign it to all of them so I get 1 answer per each employee"*

`DistributionEntry` is keyed by `xrayImageId`, and `foldDistributionEvents` enforces a single live
owner per id (a second `assigned` event for the same id folds as a reassignment or is dropped).
`ItemAnswer` is *also* keyed by `xrayImageId`, but inside a per-employee answers file — so answers
are already separable per employee; **only the distribution entry is not**.

### Recommended solution: per-replica namespaced IDs

The ad-hoc path already namespaces every row: `ADHOC-{importId}-{originalId}`
(`namespacedXrayImageId`). Extend that with a replica index:

```
replicaIndex 0        → ADHOC-{importId}-{originalId}          (unchanged — back-compatible)
replicaIndex k > 0    → ADHOC-{importId}-R{k}-{originalId}
```

Each replica is its own row in the synthetic `sample.master.json`, carrying an identical business
payload. Every downstream consumer — the fold, the per-employee mirrors, answers, referrals,
reports, the Power BI export — then works **unchanged**, and each employee gets their own row and
their own answer.

Carry provenance so an agreement analysis is computable later:

- `adhocSourceRowKey` — the `{sheet}:{rowNumber}` all replicas share
- `adhocReplicaIndex` — which reviewer copy this is

**Consequences to state plainly:**

- Fan-out **multiplies row counts** in anything counting the synthetic month. 500 rows × 6
  reviewers = 3,000 entries. That is the mode's intended semantics, but a report over an ad-hoc
  month must be read as "reviews", not "images".
- Only mode C creates replicas. Modes A, B and D always use `replicaIndex 0`, i.e. the exact ID
  scheme already on disk, so nothing written by the current build is invalidated.

**Rejected alternative:** widening `DistributionEntry` to a composite `(xrayImageId, assignedTo)`
key — it touches the fold, the derived cache, the mirrors, every report builder and every export,
a tier-3 change to modules CLAUDE.md marks *deterministic by contract*, for a result the
namespacing already delivers additively.

---

## 4. Target architecture

```
   ┌─ A. file (.xlsx) → readWorkbookTables() ─┐
   │                                          ├→ SourceTable[]  { sheetName, headers[], rows[] }
   └─ B. paste  (TSV) → parsePastedTable() ───┘
                          │
        ┌─────────────────┴─────────────────┐
        │ STEP 2 — mapping workbench        │  adhocFieldCatalog + adhocMappingModel
        │ CertScan-style click-to-assign    │  auto-map first, admin corrects
        └─────────────────┬─────────────────┘
                          │  ImportMapping (snapshotted into the record)
        ┌─────────────────┴─────────────────┐
        │ STEP 3 — project + validate       │  adhocRowProjection  (ad-hoc's OWN normalizer)
        └─────────────────┬─────────────────┘
                          │  AdhocImportRow[]
        ┌─────────────────┴─────────────────┐
        │ adhocDistributionBridge           │  ← the ONLY module touching distribution
        └──────┬──────────────────────┬─────┘
               │                      │
     STEP 4a — assignment    STEP 4b — historical answers
     (4 modes, pure plan)    (template field mapping)
```

### 4.1 Source layer — `adhocSourceTable.ts`

```ts
export type SourceTable = {
  sheetName: string;               // "لصق" for pasted input
  headers: string[];
  rows: Array<{ sourceRowNumber: number; values: Record<string, unknown> }>;
};

export function readWorkbookTables(file: File): Promise<SourceTable[]>;
export function parsePastedTable(text: string, sheetName?: string): SourceTable;
```

`readWorkbookTables` uses the relocated shared `worksheetToSourceRows` (§2).
`parsePastedTable` follows `CertScanGrid.parsePaste` — `split("\n")` → `split("\t")`, first row =
headers — reusing `makeUniqueHeaders` semantics. Tab-separated is what Excel puts on the clipboard.

**Sheet selection:** today every sheet is treated as data and concatenated. With an explicit
mapping step that becomes wrong (different sheets, different headers). Step 1 gains a sheet picker;
default = all sheets whose header set matches the first sheet's.

### 4.2 Field catalog — `adhocFieldCatalog.ts` (C1's other half)

Ad-hoc declares its own target fields. Each carries seed aliases used **only** to pre-fill the
auto-mapping:

```ts
export type AdhocField = {
  key: string;
  labelAr: string;
  required: boolean;
  kind: "text" | "date" | "enum" | "month";
  options?: string[];              // enum fields: the canonical values
  seedAliases: string[];
};
```

Seeded from `DEFAULT_SYSTEM_FIELDS` + `DEFAULT_MAPPING_TEMPLATE.columnMappings` **at build time**,
plus ad-hoc's own additions (`studyMonth` / `شهر الفحص`, `certScanStatus`). At import time the
workspace's current Population aliases are merged in as *additional* seeds — a convenience, so the
admin's existing customizations still help — but the resolved `ImportMapping` is **snapshotted into
the import record**. Editing Population's mapping template afterwards can never retroactively change
how an existing ad-hoc import parses, which is the G8 defect.

### 4.3 Mapping model — `adhocMappingModel.ts`

```ts
export type FieldSource =
  | { kind: "column";   header: string }
  | { kind: "constant"; value: string }
  | { kind: "none" };

export type ValueMapping = Record<string, string>;   // raw source value → canonical value

export type ImportMapping = {
  fields: Record<string, FieldSource>;               // AdhocField.key → source
  valueMappings: Record<string, ValueMapping>;       // field key → per-value normalization
  templateFields?: Record<string, FieldSource>;      // TemplateField.fieldId → source (feature 2)
};
```

**Auto-detection.** Ad-hoc's own matcher (exact → normalized-exact → substring), using the same
Arabic folding rules that already work elsewhere (`أ/ا`, `ة/ه`, `ى/ي`, tatweel, diacritics, BOM).
`normalizeHeaderToken` in `columnMappingHints.ts` is the reference implementation; ad-hoc gets its
own copy in `adhocFieldCatalog.ts` rather than importing from the Population component tree (C1).
It is ~10 lines and fully unit-tested on both sides.

**Value mapping** — the real fix for G1/G5. For each `kind: "enum"` field (`xrayLevelOneResult`,
`xrayLevelTwoResult`, `certScanStatus`, `stage`), collect the distinct values in the chosen column,
seed each with a best guess against the canonical set (`سليم → سليمة`, `مشبوه → اشتباه`,
`Clear → سليمة`, `المستوى ٢ → second`, …), and let the admin correct any of them. An unmapped value
leaves the row invalid **with the offending value named in the reason string**, instead of today's
generic "missing or invalid".

**Constant sources solve the strict-union problem.** `xrayLevelOneResult` / `xrayLevelTwoResult` are
typed `"سليمة" | "اشتباه"` and read by 25 non-test files; widening to `| null` is a tier-3 refactor
across sampling, reporting, exports and browse. Instead, an admin importing a bare image list
explicitly declares *"every row in this file is سليمة"* — recorded in the import record, visible in
the review table, attributable to a person. That is a documented human decision, not the app
fabricating data, and it also handles "this whole file is المستوى الثاني" and "this whole file is
Certscan" for free. `kind: "none"` on a required field keeps the row **invalid and visible**.

### 4.4 Row projection — `adhocRowProjection.ts`

Ad-hoc's own normalizer, replacing the `normalizeRiskRow` call:

```ts
export function projectSourceRow(
  row: SourceTable["rows"][number],
  mapping: ImportMapping,
  catalog: AdhocField[]
): AdhocImportRow;
```

Per field: resolve `FieldSource` → raw value → trim → apply `ValueMapping` → coerce by
`AdhocField.kind` → validate. `AdhocImportRow.mapped` becomes ad-hoc's own
`AdhocMappedRow = Record<string, string | null>` instead of `NormalizedRiskRow`, cutting the last
type dependency on the Population tree.

`projectToDistributionRow(importId, mapped, replicaIndex)` — in the bridge — builds the
`PreparedPopulationRow` the distribution machinery consumes. Fields ad-hoc genuinely does not have
keep the honest documented defaults the current code already uses (`biEnrichmentStatus:
"BI Not Provided"`, null reviewer fields); `certScanStatus` stops being hardcoded and comes from
the mapping.

### 4.5 Assignment planner — `adhocAssignmentPlan.ts` — pure, no I/O

```ts
export type AssignmentMode = "explicit" | "count" | "percentage" | "fanout";

export type AssignmentTarget = { username: string; weight?: number; count?: number };

export type PlannedAssignment = {
  rowKey: string; username: string; replicaIndex: number; xrayImageId: string;
};

export function planAdhocAssignment(params: {
  rows: AdhocImportRow[];
  mode: AssignmentMode;
  targets: AssignmentTarget[];
  explicitRowKeys?: string[];
  importId: string;
  seed?: string;
}): { plan: PlannedAssignment[]; leftover: number; errors: string[] };
```

Eligible pool = `validation.valid && !excludedByAdmin && !assigned`, shuffled with
`shuffleInPlace(createRng(hashSeedString(seed ?? importId)))` — deterministic, but not biased by
sheet order.

| Mode | Arabic label | Algorithm |
|---|---|---|
| `explicit` | `صفوف محددة لموظف` | Today's behavior: `explicitRowKeys` → one target. Preserved verbatim. |
| `count` | `عدد لكل موظف` | Take `target.count` rows per employee from the shuffled pool in order. Shortfall **reported as `leftover`, never silently padded** (pending Q2). |
| `percentage` | `نسبة مئوية` | `hamiltonApportionment(targets.map(t => ({key: t.username, size: t.weight})), pool.length)`. Weights default equal → even split. Direct reuse; its alphabetical tie-break already makes ties deterministic. |
| `fanout` | `كل الصفوف لكل موظف` | Cartesian product `pool × targets`; `replicaIndex` = index of the target. |

### 4.6 Month binding (C3) — isolated by default, optionally tied to شهر الفحص

```ts
export type AdhocMonthBinding =
  | { kind: "isolated" }                                   // DEFAULT
  | { kind: "month";  monthFolderName: string }            // one file per month, month picked in UI
  | { kind: "column"; fieldKey: string };                   // derived per row from a mapped column
```

**Storage never changes.** All three write to `2-samples/adhoc-{importId}/`. A binding is a
**label**, not a write target.

> **Why not write into the real month folder.** `sample.master.json` for a real month records
> `rngSeed`, `drawnAt`, `samplingAlgorithmVersion` and `portAllocations` — it is the artifact of one
> specific seeded draw. Appending rows that were never drawn makes that draw un-replayable and its
> audit trail wrong. Linking gets the rows to show up under the month without destroying what the
> month means. If it later turns out you need them physically merged, that is a separate decision
> with a migration, not a side effect of an import.

- `kind: "month"` — the path you preferred: upload one file per month, pick the month from the
  existing month list at import time. Simple and unambiguous.
- `kind: "column"` — `studyMonth` (`شهر الفحص`) is **a mappable field like any other**, never a
  hardcoded column name. Its parser accepts `5-May-2026`, `2026-05`, `05/2026`, an Excel date
  serial, or an Arabic month name, and resolves through the existing
  `formatMonthFolderName` / `parseMonthFolderName` (`src/data/population/monthFolder.ts`). Rows may
  land in several months from one file; the mapping step shows the **detected distinct months and
  their row counts before commit**, so a mis-mapped column is caught by eye rather than after the
  write. Each row carries its own resolved `linkedMonthFolder`.
- Unparseable / missing month on a `kind: "column"` import → the row stays valid but falls back to
  isolated, listed in the review table under a "شهر غير محدد" filter.

**Consumers.** `loadAdhocEntriesForEmployeeView` and `listAdhocSampleFolders` gain an optional
`monthFolderName` filter that matches an import's binding (and, for `kind: "column"`, a row's own
`linkedMonthFolder`). Month-scoped views then union linked ad-hoc rows in; isolated imports stay
invisible to them, exactly as today. The index already carries enough to keep this cheap — add
`monthBinding` and `linkedMonths: string[]` to `AdhocImportIndexEntry` so a month-scoped reader
skips irrelevant imports without opening them.

### 4.7 Record shape change (v2)

`AdhocImportRow.assignedTo: string | null` cannot represent fan-out:

```ts
export type AdhocRowAssignment = {
  username: string; replicaIndex: number; xrayImageId: string; assignedAt: string;
};

export type AdhocImportRow = {
  rowKey: string;
  mapped: AdhocMappedRow;                    // CHANGED — was NormalizedRiskRow (C1)
  validation: AdhocImportRowValidation;
  excludedByAdmin: boolean;
  assignments: AdhocRowAssignment[];         // NEW — replaces the three scalar fields
  linkedMonthFolder?: string;                // NEW — monthBinding kind:"column"
  // legacy, still written for one release so an older build stays readable:
  assigned: boolean; assignedTo: string | null; assignedAt: string | null;
  namespacedXrayImageId: string | null;
};

export type AdhocImportRecord = {
  // …existing…
  schemaVersion?: 2;
  kind: "population" | "sample" | "historical";
  sourceKind: "file" | "paste";
  mapping?: ImportMapping;                   // snapshotted (§4.2)
  fieldCatalog?: AdhocField[];               // snapshotted alongside it
  monthBinding?: AdhocMonthBinding;          // defaults to { kind: "isolated" }
  templateId?: string; templateVersion?: number;   // historical only
};
```

`normalizeAdhocRecord()` runs **on load only** — derives `assignments` from the legacy scalars for a
v1 record, and maps a v1 `NormalizedRiskRow` onto `AdhocMappedRow` (a key subset, no data loss).
Never rewrites disk unless a save happens anyway. No migration step; existing workspaces keep working.

### 4.8 Feature 2 — historical study import

Same three steps, plus a second mapping section and a different write path.

**Template source.** `loadInspectionTemplateSelection()` gives the workspace's default study
template; `loadTemplateIndex()` + `loadTemplate()` back an explicit picker. The mapping UI lists
`schema.fields` grouped by `schema.phases` (`getTemplatePhases` / `getFieldsForPhase`) with the same
click-to-assign control as the population fields.

**Value coercion per `TemplateFieldType`:**

| Type | Rule |
|---|---|
| `text`, `textarea` | trimmed string |
| `number` | `Number(...)`; non-finite → warning, value dropped |
| `date` | ISO-normalize; Excel serials already handled by the shared reader |
| `checkbox` | truthy set (`نعم`, `صح`, `true`, `1`, `✓`) vs falsy; anything else dropped with a warning |
| `dropdown` | must match `field.options` after Arabic folding; unmatched → per-value mapping UI (§4.3) |
| `combobox` | match `options`, else keep the raw string — that is what a combobox is for |
| `multiselect` | split on `,` `\|` `؛` `/`, map each part, re-serialize with `serializeMultiValue` (` \| `) so it round-trips through `parseMultiValue` |
| `empty` | not mappable — layout only |

**Partial coverage is native.** `ItemAnswer.answers` is a sparse `FieldAnswer[]`, so an unmapped
template field simply produces no entry. Required-field enforcement lives in the inspection form,
not in `answerStorage`, so a partial historical answer is storable and renderable. *Verify in a real
browser* — the results view must render a submitted answer missing a required field without throwing.

**Who answered it.** `answeredBy` must resolve to a real managed user or the answer lands in a file
nothing reads. Offer a mapped column (per-row) **and** a constant fallback, and validate every
distinct resulting username through `findAssignableEmployee` as a **blocking pre-flight**, before
the write starts — not mid-write.

**Write path per row**, all through the bridge:

```
row → projectToDistributionRow  → sample.master.json (synthetic month)
    → buildAssignEvent(assignedTo = answeredBy)
    → buildCompletedEvent(...)
    → appendDistributionEvents([...]) → refreshDistributionCacheAfterWrite(...)
    → upsertItemAnswer(dir, adhocMonthFolder, answeredBy, {
        xrayImageId, templateId, templateVersion, answers,
        status: "submitted", submittedAt: <mapped or constant>,
        lastSavedAt: now, answeredBy })
```

A historical import is the primary consumer of §4.6's month binding — it is the case where
"this study was for شهر مايو" actually matters.

### 4.9 Moving the tab under `إدارة بيانات الأشعة`

Six coordinated edits. Step 4 is the subtle one — get it wrong and the feature silently becomes
un-grantable for every role.

1. **`src/auth/tabCatalog.ts`** — replace `{ id: "adhoc-import", …, group: "system" }` with
   `{ id: "population/adhoc-import", label: "استيراد بيانات مخصص", parentId: "population", allowedRoles: ADMIN_ONLY }`.
2. **`Population/index.tsx`** — add `{ id: "adhoc-import", label: "استيراد بيانات مخصص" }` to
   `tabConfig.subTabs`; extend the `SubTab` union and `KNOWN_POPULATION_SUB_TABS`; render behind
   `hidden={activeSubTab !== "adhoc-import"}` inside the existing `visitedSubTabs` mount-preservation
   pattern — it holds unsaved mapping state, and unmounting on a sub-tab switch would discard an
   in-progress mapping.
3. **`AdhocImport/index.tsx`** — **remove the `tabConfig` export.** `tabRegistry.ts` globs
   `./*/index.tsx` eagerly, so while that export exists the tab keeps registering itself at top
   level. `TemplateBuilder/index.tsx` and `ReportDesigner/index.tsx` are the precedent: sub-tab-only
   components export a default component and nothing else. `tabCatalog.test.ts` asserts
   catalog↔registry agreement, so a miss fails the suite loudly.
4. **`src/auth/userManagement.ts`** — move `adhoc-import.ingest` / `adhoc-import.assign` from
   `TAB_FEATURE_MAP["adhoc-import"]` into `TAB_FEATURE_MAP["population"]`. `FEATURE_TAB_LOOKUP` is
   derived from this map and drives `canMutate()`'s cascade against the **parent tab's** grant; left
   pointing at a tab id no longer in the catalog, both features become permanently un-grantable.
   Also drop the five `{ tabId: "adhoc-import" }` rows from `DEFAULT_TAB_PERMISSIONS`.
5. **`src/auth/subTabFeatureGate.ts`** — add
   `"population/adhoc-import": ["adhoc-import.ingest", "adhoc-import.assign"]` so a role with
   Population view access but neither feature doesn't get a dead sidebar link.
6. **Tests** — `tabCatalog.test.ts` and `permissionMatrixEffect.test.ts` assert the exact tab/feature
   lists; both need updating in the same commit.

**No workspace migration needed.** `normalizeUserManagementState` filters stored permissions through
`knownTabIds` (from `MANAGED_TABS`), so an existing `3-user-data/users.permissions.json` carrying
the old `adhoc-import` tab id drops that row silently and picks up the new defaults.

---

## 5. UI — the three-step workbench

Replaces today's single upload button. Renders inside the Population tab's sub-tab shell, RTL, all
strings via `DEFAULT_LABELS` (the page already owns ~50 `adhoc_import_*` keys; extend, don't inline).

### 5.1 Step 1 — المصدر

Two source tabs: `رفع ملف` (`.xlsx,.xls`) and `لصق من إكسل` (paste target modeled on
`CertScanGrid`'s drop zone). Then: sheet picker, `نوع الاستيراد` (population / ready sample /
historical study), the template picker for historical, and the **month binding** control —
`معزول` (default) / `شهر محدد` (month dropdown) / `من عمود شهر الفحص`.

### 5.2 Step 2 — مطابقة الأعمدة (C2 — the CertScan interaction)

Modeled directly on `CertScanGrid`. Its mechanic: a toolbar of highlighter buttons (Port Name in
red `--c-danger`, System S/N in sky `--c-sky`), click one to arm (`activeHL`), click a column
**header** to assign it (`handleColClick`), the column tints in that color, and the button shows a
check plus `عمود N`. Auto-detect (`applyPaste`) pre-fills the picks. Same idea here:

- **Field rail** (right, RTL): every `AdhocField` as a row — Arabic label, a required marker, the
  currently assigned column or `غير مطابق`, and a status chip (`تلقائي` / `يدوي` / `ثابت`).
  Clicking a field **arms** it, exactly like `activeHL`.
- **Data grid** (left): the parsed table with real headers and the first ~50 rows. While a field is
  armed, clicking a column header assigns it; the cursor-hint strip (`انقر على عنوان العمود لتحديده`)
  is lifted verbatim from `CertScanGrid`.
- **Color rule.** CertScan has 2 targets so it gives each its own color. Ad-hoc has ~17 population
  fields plus N template fields, and 17 distinct colors is unreadable. Proposed instead:
  **assigned = sky tint** (`--c-sky`), **armed target = amber ring**, **required-and-unmapped =
  red** (`--c-danger`). This keeps the blue/red vocabulary meaning something. *Flagged as a
  decision* — if you want per-field colors, an 8-color cycling palette is the alternative, and it
  gets ambiguous past 8 mapped fields.
- **Constant instead of a column**: each field row has a `قيمة ثابتة` toggle that swaps the column
  picker for a value input (§4.3).
- **Value mapping**: a `مطابقة القيم` expander on any enum field opens the per-value table.
- Historical imports render a second rail below, grouped by template phase.

### 5.3 Step 3 — المراجعة والتعيين

The existing `DataTable` review grid (keep `resetToken`, the exclude checkbox, the validation column
with its reason text), plus the assignment panel:

```
وضع التوزيع:  ( ) صفوف محددة لموظف     ( ) عدد لكل موظف
              ( ) نسبة مئوية (متساوية افتراضياً)   ( ) كل الصفوف لكل موظف

[ employee multi-select with per-row count / % input ]
[ live preview: "سيتم إنشاء 3,000 تعيين لـ 6 موظفين (500 صف × 6 نسخ)" ]
[ تعيين ]
```

The preview runs `planAdhocAssignment` client-side — the same pure function that performs the
assignment, so the number shown is the number written. Fan-out shows an explicit `ConfirmDialog`
(`danger`) naming the total, because it is the one mode that multiplies workload.

---

## 6. Work breakdown

| # | Deliverable | Files | Tier | Depends on |
|---|---|---|---|---|
| 0 | Move `worksheetRows.ts` to `src/data/workbook/`, repoint Population + ad-hoc | 3 files | 2 | — |
| 1 | Source layer: `readWorkbookTables` + `parsePastedTable` | `adhocSourceTable.ts` (new) | 2 | 0 |
| 2 | `adhocFieldCatalog.ts` — own fields, seed aliases, own header folding | new | 2 | — |
| 3 | `ImportMapping` model, auto-detect, value mappings | `adhocMappingModel.ts` (new) | 2 | 1, 2 |
| 4 | `adhocRowProjection.ts` — own normalizer; **cut the 4 Population-tree imports** | new + `adhocImportTypes.ts` | 3 | 3 |
| 5 | `adhocDistributionBridge.ts` — consolidate every distribution/sampling/answers call | new, from `adhocImportAssignment.ts` | 3 | 4 |
| 6 | Record v2 + `normalizeAdhocRecord()` on load | `adhocImportTypes.ts`, `adhocImportStorage.ts` | 3 | 4 |
| 7 | `planAdhocAssignment` (4 modes, pure) | `adhocAssignmentPlan.ts` (new) | 2 | 6 |
| 8 | `assignAdhocPlan` writer + replica IDs in the sample-master write | `adhocDistributionBridge.ts` | 3 | 5, 6, 7 |
| 9 | Month binding + index fields + month-filtered employee-view reads | `adhocImportEmployeeView.ts`, storage, types | 2 | 6 |
| 10 | Three-step UI (source / mapping workbench / review+assign) | `AdhocImport/` (several components) | 2 | 1–9 |
| 11 | Move tab under Population (the 6 edits of §4.9) | `tabCatalog.ts`, `Population/index.tsx`, `AdhocImport/index.tsx`, `userManagement.ts`, `subTabFeatureGate.ts`, 2 tests | 3 | 10 |
| 12 | Template-field mapping + coercion | `adhocTemplateMapping.ts` (new) | 2 | 3 |
| 13 | Historical write path (assign + complete + `upsertItemAnswer`) | `adhocHistoricalImport.ts` (new) | 3 | 8, 9, 12 |
| 14 | Labels for every new string | `labelsStore.ts` | 1 | 10 |

**Suggested landing order:** 0–4 (decoupling + mapping engine — fixes G1 and G8 on its own, no
assignment change) → 5–9 (bridge, record v2, modes, month binding) → 10 → 11 (tab move) → 12–14
(historical import as its own release).

Items 4, 5, 6, 8, 11 and 13 are **tier 3**: they change a persisted format, a
deterministic-by-contract module, or the permission matrix. Each needs full before/after snippets,
migration/rollback notes, and the complete gate sweep.

---

## 7. Test plan

**Pure units (`node` env)**
- `parsePastedTable`: CRLF, trailing blank line, ragged rows, duplicate headers, single column.
- Auto-detect: exact, substring, Arabic folding (`أ/ا`, `ة/ه`, `ى/ي`, tatweel, diacritics, BOM),
  no-match, two headers colliding onto one field.
- Value mapping: `سليم → سليمة`; an unknown value stays invalid **and names the value**.
- Constant sources: a required field satisfied by a constant projects; `kind:"none"` does not.
- `studyMonth` parsing: `5-May-2026`, `2026-05`, `05/2026`, Excel serial, Arabic month name,
  garbage → isolated fallback.
- `planAdhocAssignment`: every mode × {0 targets, 0 rows, count > pool, weights ≠ 100, single
  employee, duplicate username}; determinism (same seed → same plan); fan-out replica-ID uniqueness
  across the whole plan.
- `normalizeAdhocRecord`: a v1 record round-trips to `assignments` + `AdhocMappedRow` without loss.
- Template coercion: one case per `TemplateFieldType`; multiselect round-trip through
  `parseMultiValue` / `serializeMultiValue`.
- **Layering guard**: an assertion that no file under `src/data/adhocImport/` imports from
  `src/components/**` — cheap, and it keeps C1 from silently regressing.

**Storage/integration (`createMemoryDirectory()`)**
- Fan-out: 3 rows × 3 employees → 9 entries, 9 distinct IDs, each employee's mirror holds their 3.
- Idempotency: running the same plan twice appends no second `assigned` event.
- Closed-import gate; deactivated-target rejection; stale-record re-read.
- Month binding: a `kind:"month"` import surfaces in that month's employee view and **not** in
  another's; an isolated import surfaces in neither; a `kind:"column"` import splits across months.
- Historical: assign + completed + `ItemAnswer` all land, and `loadAdhocEntriesForEmployeeView`
  surfaces the row as completed with its answers.

**Component (`jsdom`, `/* @vitest-environment jsdom */` line 1)**
- Mapping rail renders every field, defaults to the auto-detected column, and a manual override
  survives a re-render.
- Arm-a-field → click-a-column assigns it and tints the column; clicking a column with nothing
  armed is a no-op (CertScan's `if (!activeHL) return`).
- Required-field-unmapped blocks the assign action.
- Sub-tab switch away and back preserves in-progress mapping state.

**Real browser (`npm run dev`, Chrome/Edge)** — mandatory before claiming done. CLAUDE.md records
that this area's effect-timing and state-machine bugs have survived self-review repeatedly.
Exercise: paste → map by clicking columns → fan-out assign → log in as two targets → both see their
own copy → both answer independently → both persist across a reload.

---

## 8. Open questions

**Q1 — Fan-out semantics.** Confirmed as inter-rater duplicate review (every selected employee
reviews *every* row)? Or "split the rows, one per employee, everyone gets at least one"? The plan
assumes the former — it is what "1 answer per each employee" reads as, and it is the expensive one
to get wrong, since it is the only requirement driving the replica-ID scheme (§3).

**Q2 — Count-mode shortfall.** When the requested counts exceed the pool, report the shortfall and
assign what exists (planned), or refuse the whole operation?

**Q3 — Mapping color scheme (§5.2).** Sky = assigned / amber = armed / red = required-unmapped, or a
cycling per-field palette?

~~Q4 — historical imports and reports~~ — **answered (C3):** isolated by default, optionally bound
to a month, never physically merged into a real month's `sample.master.json`.

~~Q5 — certScanStatus~~ — **answered (C4):** the CertScan reference was about the column-picking
interaction, not reference matching. `certScanStatus` becomes an ordinary mappable field.
