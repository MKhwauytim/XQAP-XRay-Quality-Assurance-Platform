# Ad-hoc Import Rework + Historical Study Import — Implementation Plan

**Status:** proposed — needs owner approval before any code lands
**Date:** 2026-08-21
**Scope owner request (verbatim intent):**

1. Feed the page from **either a population file or an already-drawn sample**.
2. Source columns have **different or near-matching names** vs. the app's fields — detect and map them.
3. Assign the resulting rows to employees in **four different ways**.
4. Accept input as **an uploaded Excel file (A)** or **a copy-pasted block of Excel columns (B)**.
5. **Move the ad-hoc page under `إدارة بيانات الأشعة`** (the Population tab) instead of standing alone.
6. **New:** import **previously-studied samples** — map population columns *and* the study
   template's answer fields, accepting that an old study will not fill every field of a
   template that did not exist when the study was done.

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
| G4 | `certScanStatus` is **hardcoded `"NonCertscan"`**; `stage` is never validated. | Any stage-aware or CertScan-aware allocation is impossible on ad-hoc rows. |
| G5 | Both L1 and L2 are **hard-required**. | A "ready sample" that is just a list of images to review cannot be imported at all. |
| G6 | Tab is top-level under `group: "system"`. | Request 5 unmet. |
| G7 | No path to import an **already-answered** study. | Request 6 unmet. |

---

## 2. The one genuinely hard problem: assignment mode C (fan-out)

> *"or I assign it to all of them so I get 1 answer per each employee"*

This is an **inter-rater / duplicate-review** mode, and the current data model cannot express it.

`DistributionEntry` is keyed by `xrayImageId`, and `foldDistributionEvents` enforces a single
live owner per id (a second `assigned` event for the same id folds as a reassignment or is
dropped). `ItemAnswer` is *also* keyed by `xrayImageId`, but inside a per-employee answers file —
so answers are already separable per employee; **only the distribution entry is not**.

### Recommended solution: per-replica namespaced IDs

The ad-hoc path already namespaces every row: `ADHOC-{importId}-{originalId}`
(`namespacedXrayImageId`). Extend that with a replica index:

```
replicaIndex 0        → ADHOC-{importId}-{originalId}          (unchanged — back-compatible)
replicaIndex k > 0    → ADHOC-{importId}-R{k}-{originalId}
```

Each replica becomes its own `PreparedPopulationRow` in the synthetic `sample.master.json`,
carrying an identical business payload. Every downstream consumer — the event fold, the
per-employee mirrors, answers, referrals, reports, the Power BI export — then works **completely
unchanged**, and each employee gets their own row and their own answer.

Add two fields to the projected row's provenance so an agreement analysis is computable later:

- `adhocSourceRowKey` — the `{sheet}:{rowNumber}` all replicas share
- `adhocReplicaIndex` — which reviewer copy this is

**Consequences to state plainly to the owner:**

- Fan-out **multiplies row counts** in anything that counts the synthetic month. 500 rows × 6
  reviewers = 3,000 distribution entries. That is the intended semantics of the mode, but any
  report over an ad-hoc month must be read as "reviews", not "images".
- Only mode C creates replicas. Modes A, B and D always use `replicaIndex 0`, i.e. the exact
  ID scheme already on disk, so nothing written by the current build is invalidated.

**Rejected alternative:** widening `DistributionEntry` to a composite `(xrayImageId, assignedTo)`
key. That touches the fold, the derived cache, the mirrors, every report builder and every export
— a tier-3 change to a module CLAUDE.md marks *deterministic by contract*, for a feature that the
namespacing trick already delivers additively.

---

## 3. Second constraint: `xrayLevelOneResult` / `xrayLevelTwoResult` are strictly typed

```ts
// src/data/population/populationTypes.ts:47
xrayLevelOneResult: "سليمة" | "اشتباه";
xrayLevelTwoResult: "سليمة" | "اشتباه";
```

25 non-test files read these fields. Widening the union to `| null` is a tier-3 refactor across
sampling, reporting, exports and browse — out of proportion to this request.

**Recommended solution: a constant-valued mapping source.** A field's mapping is not just
"which column"; it is a small tagged union:

```ts
type FieldSource =
  | { kind: "column";   header: string }
  | { kind: "constant"; value: string }   // admin explicitly declares the value for the whole file
  | { kind: "none" };
```

An admin importing a bare image list explicitly declares *"every row in this file is سليمة"* —
recorded in the import record, visible in the review table, attributable to a person. That is a
documented human decision, not the app fabricating data. It also solves "this whole file is
المستوى الثاني" and "this whole file is Certscan" for free.

`kind: "none"` on a required field keeps the row **invalid and visible**, exactly as today.

---

## 4. Target architecture

```
                 ┌── A. file (.xlsx)  → readWorkbookTables()
   source input ─┤                                            ┐
                 └── B. paste (TSV)   → parsePastedTable()    ├→ SourceTable[]
                                                              ┘   { sheetName, headers[], rows[] }
                                   │
                    ┌──────────────┴──────────────┐
                    │  STEP 2 — mapping workbench │
                    │  auto-detect + manual pick  │
                    └──────────────┬──────────────┘
                                   │  ImportMapping
                    ┌──────────────┴──────────────┐
                    │  STEP 3 — project + validate│
                    └──────────────┬──────────────┘
                                   │  AdhocImportRow[]
              ┌────────────────────┴────────────────────┐
              │                                         │
     STEP 4a — assignment plan               STEP 4b — historical answers
     (4 modes, pure function)                (template field mapping)
              │                                         │
      assign events → existing              assign + completed events
      distribution machinery                + upsertItemAnswer()
```

### 4.1 Source layer (new: `adhocSourceTable.ts`)

```ts
export type SourceTable = {
  sheetName: string;               // "لصق" for pasted input
  headers: string[];
  rows: Array<{ sourceRowNumber: number; values: Record<string, unknown> }>;
};

export function readWorkbookTables(file: File): Promise<SourceTable[]>;
export function parsePastedTable(text: string, sheetName?: string): SourceTable;
```

`readWorkbookTables` is the first half of today's `parseAdhocImportFile`, split out verbatim —
it keeps `worksheetToSourceRows`, which already handles the large-integer-ID precision fix, the
blank-row `sourceRowNumber` fix, and duplicate-header uniquification.

`parsePastedTable` follows `CertScanGrid.parsePaste` (`split("\n")` → `split("\t")`), first row =
headers, reusing `makeUniqueHeaders` semantics. Tab-separated is what Excel puts on the clipboard.

**Sheet selection:** today *every* sheet is treated as data and concatenated. With an explicit
mapping step that becomes wrong (different sheets, different headers). Step 1 gains a sheet
picker; default = all sheets whose header set matches the first sheet's.

### 4.2 Mapping layer (new: `adhocMappingModel.ts`)

```ts
export type FieldSource =
  | { kind: "column"; header: string }
  | { kind: "constant"; value: string }
  | { kind: "none" };

export type ValueMapping = Record<string, string>;   // raw source value → canonical value

export type ImportMapping = {
  fields: Record<string, FieldSource>;               // populationConfig field key → source
  valueMappings: Record<string, ValueMapping>;       // field key → per-value normalization
  templateFields?: Record<string, FieldSource>;      // TemplateField.fieldId → source (feature 2)
};
```

**Auto-detection** generalizes the existing `buildColumnHintsFromRows`
(`Population/components/columnMappingHints.ts`), which already does alias + substring +
Arabic-normalization matching and is already unit-tested. Refactor its signature from
`(rows, config: PopulationConfig)` to `(headers: string[], targets: Array<{key, labels: string[]}>)`,
then call it from three places: the existing Population wizard (with `config.systemFields`), the
ad-hoc mapping step, and the template-field mapping step. Keep the old export as a thin adapter so
the Population wizard's behavior and tests are untouched.

Default pick = highest-ranked hint; `kind: "none"` when no hint exists. **Every default is
overridable** — that is the point of the step.

**Value mapping** (the real fix for G1/G5): for each enum-ish field (`xrayLevelOneResult`,
`xrayLevelTwoResult`, `certScanStatus`, `stage`), collect the distinct values in the chosen
column, seed each with a normalized-Arabic best guess against the canonical set
(`سليم → سليمة`, `مشبوه → اشتباه`, `Clear → سليمة`, `المستوى ٢ → second`, …), and let the admin
correct any of them. Unmapped values leave the row invalid **with the offending value named in
the reason string**, instead of today's generic "missing or invalid".

**Feeding the mapping into the normalizer costs no new code.** `normalizeRiskRow` takes
`columnMappings: Record<field, string[]>` and `aliasesFor` treats a non-empty list as
authoritative, so a chosen header is passed as a single-element alias list:
`{ xrayImageId: ["Image ID"] }`. Constants and value mappings are applied as a post-pass on the
`NormalizedRiskRow`.

### 4.3 Assignment planner (new: `adhocAssignmentPlan.ts`) — pure, no I/O

```ts
export type AssignmentMode = "explicit" | "count" | "percentage" | "fanout";

export type AssignmentTarget = {
  username: string;
  weight?: number;     // percentage mode; defaults to equal
  count?: number;      // count mode
};

export type PlannedAssignment = {
  rowKey: string;
  username: string;
  replicaIndex: number;
  xrayImageId: string;   // namespaced, replica-aware
};

export function planAdhocAssignment(params: {
  rows: AdhocImportRow[];
  mode: AssignmentMode;
  targets: AssignmentTarget[];
  explicitRowKeys?: string[];    // "explicit" mode only
  importId: string;
  seed?: string;
}): { plan: PlannedAssignment[]; leftover: number; errors: string[] };
```

Eligible pool = `validation.valid && !excludedByAdmin && !assigned`, shuffled with
`shuffleInPlace(createRng(hashSeedString(seed ?? importId)))` so allocation is **deterministic
but not biased by sheet order** — reusing `src/data/sampling/rng.ts` exactly as the real draw does.

| Mode | Arabic label | Algorithm |
|---|---|---|
| `explicit` | `صفوف محددة لموظف` | Today's behavior: `explicitRowKeys` → one target. Preserved verbatim. |
| `count` | `عدد لكل موظف` | Take `target.count` rows per employee from the shuffled pool in order. Shortfall is **reported as `leftover`, never silently padded**. |
| `percentage` | `نسبة مئوية` | `hamiltonApportionment(targets.map(t => ({key: t.username, size: t.weight})), pool.length)`. Weights default to equal → an even split. **Direct reuse of `src/data/sampling/apportionment.ts`** — no new math, and its alphabetical tie-break already makes ties deterministic. |
| `fanout` | `كل الصفوف لكل موظف` | Cartesian product `pool × targets`; `replicaIndex` = index of the target. |

Pure and deterministic → straightforward to unit-test at every boundary (0 targets, 0 rows,
weights summing ≠ 100, count > pool, one employee, duplicate usernames).

### 4.4 Assignment writer — `assignAdhocPlan()`

Replaces `assignAdhocRowsToEmployee`, keeping every safety property that function earned the hard
way (read the comments on it before touching it — several are documented incident fixes):

1. **Re-read the record from disk** — never trust the caller's React state (stale-tab incident).
2. Gate on `status === "closed"`.
3. Validate **every** target through `findAssignableEmployee(username, getManagedLoginUsers())`
   against the live roster (audit finding 6).
4. `ensureAdhocSampleMaster` **must include every planned replica ID** before any event
   references it — `foldDistributionEvents` silently drops an event whose `xrayImageId` is not in
   the sample rows, which would make an assignment durably written but invisible.
5. `loadOrDeriveDistributionCurrent` → `ownedIds` guard for idempotency.
6. `appendDistributionEvents` → `refreshDistributionCacheAfterWrite`.
7. Rewrite `rows` from the **fresh** record so a concurrent machine's bookkeeping survives.

Keep `assignAdhocRowsToEmployee` as a thin `mode: "explicit"` wrapper during the transition, or
delete it and update its two call sites — decide at implementation time, not now.

### 4.5 Record shape change (v2)

`AdhocImportRow.assignedTo: string | null` cannot represent fan-out. Move to:

```ts
export type AdhocRowAssignment = {
  username: string;
  replicaIndex: number;
  xrayImageId: string;
  assignedAt: string;
};

export type AdhocImportRow = {
  rowKey: string;
  mapped: NormalizedRiskRow;
  validation: AdhocImportRowValidation;
  excludedByAdmin: boolean;
  assignments: AdhocRowAssignment[];        // NEW — replaces the three scalar fields
  // legacy, still written for one release so an older build stays readable:
  assigned: boolean;                         // = assignments.length > 0
  assignedTo: string | null;                 // = assignments[0]?.username ?? null
  assignedAt: string | null;
  namespacedXrayImageId: string | null;
};

export type AdhocImportRecord = {
  // …existing…
  schemaVersion?: 2;
  kind: "population" | "sample" | "historical";   // NEW — drives validation strictness
  mapping?: ImportMapping;                        // NEW — persisted so a re-map is auditable
  sourceKind: "file" | "paste";                   // NEW
  templateId?: string;                            // historical imports only
  templateVersion?: number;
};
```

Add `normalizeAdhocRecord()` applied **on load only** — it derives `assignments` from the legacy
scalars for a v1 record read from disk, and never rewrites disk unless a save happens anyway.
Existing workspaces keep working with no migration step; `AdhocImportIndexEntry.assignedRows`
becomes "assignment count", not "row count", which for non-fan-out imports is the same number.

### 4.6 Feature 2 — historical study import

Same three steps, plus a second mapping section and a different write path.

**Template source.** `loadInspectionTemplateSelection()` gives the workspace's default study
template; `loadTemplateIndex()` + `loadTemplate()` back an explicit picker. The mapping UI lists
`schema.fields` grouped by `schema.phases` (via `getTemplatePhases` / `getFieldsForPhase`) with
the same auto-detect + override control.

**Value coercion per `TemplateFieldType`:**

| Type | Rule |
|---|---|
| `text`, `textarea` | trimmed string |
| `number` | `Number(...)`; non-finite → field-level warning, value dropped |
| `date` | ISO-normalize; Excel serials already handled upstream by `worksheetToSourceRows` |
| `checkbox` | truthy set (`نعم`, `صح`, `true`, `1`, `✓`) vs falsy; anything else → dropped with a warning |
| `dropdown` | must match `field.options` after Arabic normalization; unmatched → per-value mapping UI, same widget as §4.2 |
| `combobox` | match `options`, otherwise keep the raw string (that is what a combobox is for) |
| `multiselect` | split on `,` `\|` `؛` `/`, map each part against `options`, re-serialize with `serializeMultiValue` (` \| `) so it round-trips through `parseMultiValue` |
| `empty` | not mappable — layout only |

**Partial coverage is native.** `ItemAnswer.answers` is a sparse `FieldAnswer[]`, so an unmapped
template field simply produces no entry. Required-field enforcement lives in the inspection form,
not in `answerStorage`, so a partial historical answer is storable and renderable as-is. *Verify
this on a real browser* — the results view must render a submitted answer that is missing a
required field without throwing.

**Who answered it.** `answeredBy` must resolve to a real managed user or the answer lands in a
file nothing reads. Offer a mapped column (per-row) **and** a constant fallback, and validate
every distinct resulting username through `findAssignableEmployee` *before* the write starts,
reporting unknown names as a blocking pre-flight error rather than mid-write.

**Write path per row** (all through existing APIs — no new file format):

```
row → PreparedPopulationRow  → sample.master.json (synthetic month)
    → buildAssignEvent(assignedTo = answeredBy)
    → buildCompletedEvent(...)
    → appendDistributionEvents([...])
    → refreshDistributionCacheAfterWrite(...)
    → upsertItemAnswer(dir, monthFolder, answeredBy, {
        xrayImageId, templateId, templateVersion,
        answers, status: "submitted",
        submittedAt: <mapped or constant>, lastSavedAt: now, answeredBy
      })
```

**Target month folder — recommendation: synthetic only.** Write historical rows to
`2-samples/adhoc-{importId}/`, never into a real `{month}-{MonthName}-{year}` folder. Merging
them into a real month rewrites that month's `sample.master.json`, which is the deterministic
artifact of a specific seeded draw (`samplingAlgorithmVersion` + `rngSeed`); contaminating it
destroys the provenance that makes a historical draw replayable. Stamp
`linkedMonthFolder: "5-May-2026"` on the record instead, so a later report can *union* the two
without mutating either. If the owner needs these rows inside a month's report, that is a
report-level "include historical imports" toggle — a separate, smaller change.

### 4.7 Moving the tab under `إدارة بيانات الأشعة`

Six coordinated edits. The permission one (step 4) is the subtle one — get it wrong and the
feature silently becomes unusable for every role.

1. **`src/auth/tabCatalog.ts`** — replace
   `{ id: "adhoc-import", …, group: "system" }` with
   `{ id: "population/adhoc-import", label: "استيراد بيانات مخصص", parentId: "population", allowedRoles: ADMIN_ONLY }`.
2. **`Population/index.tsx`** — add `{ id: "adhoc-import", label: "استيراد بيانات مخصص" }` to
   `tabConfig.subTabs`; extend the `SubTab` union and `KNOWN_POPULATION_SUB_TABS`; render it
   behind `hidden={activeSubTab !== "adhoc-import"}` inside the existing `visitedSubTabs`
   mount-preservation pattern (it holds unsaved mapping state — unmounting on a sub-tab switch
   would discard an in-progress mapping).
3. **`AdhocImport/index.tsx`** — **remove the `tabConfig` export.** `tabRegistry.ts` globs
   `./*/index.tsx` eagerly, so as long as that export exists the tab keeps registering itself at
   top level. `TemplateBuilder/index.tsx` and `ReportDesigner/index.tsx` are the established
   precedent: sub-tab-only components export a default component and nothing else.
   `tabCatalog.test.ts` asserts catalog↔registry agreement, so a miss fails the suite loudly.
4. **`src/auth/userManagement.ts`** — move `adhoc-import.ingest` / `adhoc-import.assign` from
   `TAB_FEATURE_MAP["adhoc-import"]` into `TAB_FEATURE_MAP["population"]`. `FEATURE_TAB_LOOKUP`
   is derived from this map and drives `canMutate()`'s cascade against the **parent tab's** access
   grant; left pointing at a tab id that no longer exists in the catalog, both features become
   permanently un-grantable. Also drop the five `{ tabId: "adhoc-import" }` rows from
   `DEFAULT_TAB_PERMISSIONS`.
5. **`src/auth/subTabFeatureGate.ts`** — add
   `"population/adhoc-import": ["adhoc-import.ingest", "adhoc-import.assign"]` so a role with
   Population view access but neither feature does not get a dead sidebar link.
6. **Tests** — `tabCatalog.test.ts` and `permissionMatrixEffect.test.ts` both assert the exact
   tab/feature lists and will need updating in the same commit.

**No workspace migration needed.** `normalizeUserManagementState` filters stored permissions
through `knownTabIds` (from `MANAGED_TABS`), so an existing
`3-user-data/users.permissions.json` carrying the old `adhoc-import` tab id drops that row
silently and picks up the new defaults.

---

## 5. UI — the three-step workbench

Replaces today's single upload button. Renders inside the Population tab's sub-tab shell, RTL,
all strings via `DEFAULT_LABELS` (the page already owns ~50 `adhoc_import_*` keys; extend, do not
inline Arabic).

**Step 1 — المصدر (source)**
Two tabs: `رفع ملف` (file input, `.xlsx,.xls`) and `لصق من إكسل` (a `<textarea>`/paste target
modeled on `CertScanGrid`, with a live parsed preview grid). Then: sheet picker, `نوع الاستيراد`
(population / ready sample / historical study), and for historical, the template picker.

**Step 2 — مطابقة الأعمدة (mapping)**
A grid — one row per system field:

| الحقل | العمود المصدر | القيمة الثابتة | عيّنة | الحالة |
|---|---|---|---|---|
| معرف الأشعة `*` | `<select>` of detected headers | — | `4417829` | تلقائي |
| نتيجة المستوى الأول `*` | `<select>` | or `سليمة` | `سليم` → `سليمة` | يدوي |
| المستوى | `<select>` | or `المستوى الثاني` | … | لم يُطابق |

Rows for required fields with `kind:"none"` render a blocking warning. A `مطابقة القيم` expander
under any enum field opens the per-value mapping table. For a historical import, a second grid
below repeats this for the template's fields, grouped by phase.

**Step 3 — المراجعة والتعيين (review + assign)**
The existing `DataTable` review grid (keep `resetToken`, the exclude checkbox, the validation
column with its reason text), plus a new assignment panel:

```
وضع التوزيع:  ( ) صفوف محددة لموظف     ( ) عدد لكل موظف
              ( ) نسبة مئوية (متساوية افتراضياً)   ( ) كل الصفوف لكل موظف

[ employee multi-select with per-row count / % input ]
[ live preview: "سيتم إنشاء 3,000 تعيين لـ 6 موظفين (500 صف × 6 نسخ)" ]
[ تعيين ]
```

The preview is `planAdhocAssignment` run client-side before the write — the same pure function
that performs the assignment, so the number shown is the number written. Fan-out mode shows an
explicit confirmation (`ConfirmDialog`, `danger`) naming the total, because it is the one mode
that multiplies workload.

---

## 6. Work breakdown

| # | Deliverable | Files | Tier | Depends on |
|---|---|---|---|---|
| 1 | Split source layer; add paste parser | `adhocSourceTable.ts` (new), `adhocImportMapping.ts` | 2 | — |
| 2 | Generalize `buildColumnHintsFromRows` to arbitrary targets, keep old export as adapter | `columnMappingHints.ts` | 2 | — |
| 3 | `ImportMapping` model + apply-mapping + value mappings | `adhocMappingModel.ts` (new) | 2 | 1, 2 |
| 4 | Relax validation; `kind`-aware strictness; constant sources; map `certScanStatus`/`stage` | `adhocImportMapping.ts`, `adhocImportAssignment.ts` | 2 | 3 |
| 5 | Record v2 + `normalizeAdhocRecord()` on load | `adhocImportTypes.ts`, `adhocImportStorage.ts` | 3 | — |
| 6 | `planAdhocAssignment` (4 modes, pure) | `adhocAssignmentPlan.ts` (new) | 2 | 5 |
| 7 | `assignAdhocPlan` writer + replica IDs in `ensureAdhocSampleMaster` | `adhocImportAssignment.ts` | 3 | 5, 6 |
| 8 | Three-step UI | `AdhocImport/` (several components) | 2 | 1–7 |
| 9 | Move tab under Population (6 edits of §4.7) | `tabCatalog.ts`, `Population/index.tsx`, `AdhocImport/index.tsx`, `userManagement.ts`, `subTabFeatureGate.ts`, 2 test files | 3 | 8 |
| 10 | Template-field mapping + coercion | `adhocTemplateMapping.ts` (new) | 2 | 3 |
| 11 | Historical write path (assign + complete + `upsertItemAnswer`) | `adhocHistoricalImport.ts` (new) | 3 | 7, 10 |
| 12 | Labels for every new string | `labelsStore.ts` | 1 | 8 |

**Suggested landing order:** 1–4 (mapping engine, immediately useful on its own — it fixes G1
without touching assignment) → 5–7 (assignment modes) → 8 → 9 (tab move) → 10–12 (historical
import as its own release).

Items 5, 7, 9 and 11 are **tier 3** under CLAUDE.md's ladder: they change a persisted data format,
a deterministic-by-contract module, or the permission matrix. Each needs full before/after
snippets, migration/rollback notes, and the complete gate sweep.

---

## 7. Test plan

**Pure units (`node` env)**
- `parsePastedTable`: CRLF, trailing blank line, ragged rows, duplicate headers, a single column.
- Auto-detect: exact match, substring, Arabic normalization (`أ/ا`, `ة/ه`, `ى/ي`, tatweel,
  diacritics, BOM), no-match, two headers colliding onto one field.
- Value mapping: `سليم → سليمة`, unknown value stays invalid **and names the value**.
- `planAdhocAssignment`: every mode × {0 targets, 0 rows, count > pool, weights ≠ 100, single
  employee, duplicate username}; determinism (same seed → same plan); fan-out replica-ID
  uniqueness across the whole plan.
- `normalizeAdhocRecord`: a v1 record round-trips to `assignments` and back without loss.
- Template coercion: one case per `TemplateFieldType`, plus multiselect round-trip through
  `parseMultiValue`/`serializeMultiValue`.

**Storage/integration (`createMemoryDirectory()`)**
- Fan-out: 3 rows × 3 employees → 9 distribution entries, 9 distinct IDs, each employee's mirror
  holds exactly their 3.
- Idempotency: running the same plan twice appends no second `assigned` event.
- Closed-import gate; deactivated-target rejection; stale-record re-read.
- Historical: assign + completed + `ItemAnswer` all land, and `loadAdhocEntriesForEmployeeView`
  surfaces the row as completed with its answers.

**Component (`jsdom`, `/* @vitest-environment jsdom */` line 1)**
- Mapping grid renders every system field, defaults to the auto-detected header, and a manual
  override survives a re-render.
- Required-field-unmapped blocks the "assign" action.
- Sub-tab switch away and back preserves in-progress mapping state.

**Real browser (`npm run dev`, Chrome/Edge)** — mandatory before claiming done. CLAUDE.md records
that this area's effect-timing and state-machine bugs have survived self-review repeatedly.
Exercise: paste → map → fan-out assign → log in as two of the targets → both see their own copy →
both answer independently → both answers persist across a reload.

---

## 8. Open questions for the owner

1. **Fan-out semantics.** Confirmed as inter-rater duplicate review (every selected employee
   reviews *every* row)? Or "split the rows, one per employee, everyone gets at least one"?
   The plan assumes the former — it is what "1 answer per each employee" reads as, and it is the
   expensive one to get wrong.
2. **Count-mode shortfall.** When counts exceed the pool, report the shortfall and assign what
   exists (planned), or refuse the whole operation?
3. **Historical imports and reports.** Should a historical import ever appear in a real month's
   report, or stay isolated until an explicit "include historical" toggle is built?
4. **Ready-sample imports without L1/L2.** Is the constant-value declaration (§3) acceptable, or
   do these rows genuinely need a null L1/L2 — which means the tier-3, 25-file union widening?
5. **`certScanStatus`.** Read as "let me map this field from a dropdown of detected columns, the
   way CertScan mapping already works". If instead you want the full CertScan port+S/N reference
   matching applied to ad-hoc rows, that is a separate item — the real pipeline's matcher needs
   the population's CertScan reference list, which an ad-hoc file does not carry.
