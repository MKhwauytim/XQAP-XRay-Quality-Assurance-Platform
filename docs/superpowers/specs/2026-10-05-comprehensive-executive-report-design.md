# Comprehensive Executive Report (system + optional workbook)

Date: 2026-10-05 · Status: draft for owner review

## Goal
New Reports sub-tab "تقرير تنفيذي شامل" producing an executive report across **all months in the system**, **completed samples only**. An optional Excel workbook (e.g. `بعد التعديل.xlsx`) can be uploaded to add data the system lacks.

## Decisions (from owner)
- Workbook is optional.
- Merge rule: **system wins**. A workbook row is skipped when a system row has the same `معرف الأشعة` **and** the same month. Same ID in a different month is counted.
- Completed only: system = submitted answer (`isRowStudied`); workbook = `الاكتمال == "مكتمل"`.
- Report scope stays population-level (L1/L2 outcomes); no employee performance (existing rule).

## Source workbook facts (verified)
144 MB. Sheets: `Q1/Q2/Q3_Pop` (237k/194k/471k rows, 26 cols), `Q1/Q2/Q3_Sample` (Q1: 18,330 rows, 38 cols; 17,466 مكتمل), `بطاقة العمل` (target vs coverage per level/month), `data issue` (per-row issues), plus separator sheets (`|`, `||`, `|||`). Q2/Q3 sample columns must be verified against Q1 at implementation (assumption).

## Architecture
1. **Worker ingest** `src/data/workbookImport/` — streaming parse in a Web Worker (never whole-workbook `XLSX.read`; it exceeded 2 min on this file). Reads `*_Sample` sheets fully; `*_Pop` sheets only as aggregate counts; `بطاقة العمل` and `data issue` small sheets fully.
2. **Mapping module** `workbookColumnMap.ts` — single table, column → `ExecutiveReportRow` field:
   - `معرف الأشعة`→xrayImageId; `الشهر` (Excel serial)→period; `المستوى` FIRST/SECOND/THIRD/FORTH_STAGE→stage
   - `نتيجة المستوى الأول/الثاني`→levelOneResult/levelTwoResult; `صحة النتيجة`→expertResult
   - `هل يوجد صورة؟` (نعم/لا/معرف غير صحيح)→imageAvailable (+noImageReason); `هل يوجد تحديد؟`→hasMarking
   - `مستوى جودة الصورة`→imageQuality; `أسباب انخفاض الجودة`→lowQualityReason
   - `تقييم الاشتباه`→suspicionLevel; `الاصناف المشبوهة`→suspectedTypes; `الية التهريب المحتملة`→smuggleMethod
   - port/type/name, movement, notes (`الملاحظات العامة`) direct.
   - Unmapped or unrecognised values are counted into a visible **mapping report**; never silently dropped.
3. **Merge** `mergeWorkbookWithSystem.ts` — dedupe key `(xrayImageId, month)`; system wins; reports counts: read / incomplete / duplicate-skipped / added.
4. **Multi-period aggregator** — builds one `ExecutiveReportInput` per period (completed rows only) and an all-period rollup; reuses `buildReportModel` and existing deck2 / document / workbook builders unchanged. Snapshot existing outputs before touching shared aggregates.
5. **UI** `Tabs/Reports/ComprehensiveExecutive/` — optional drop zone, progress, mapping preview (sheets read, completed vs not, duplicates vs system, issues), "إنشاء التقرير". Strings in `DEFAULT_LABELS`. Registered as Reports sub-tab in `tabCatalog.ts` (roles: supervisor, manager, admin).
6. `بطاقة العمل` used as coverage context only when present; `data issue` rendered as a data-quality section.

## Data flow
system months → completed filter → (+ workbook rows → map → completed filter → dedupe vs system) → per-period inputs + rollup → existing builders → HTML / XLSX.

## Errors
Missing sheet/column → named error, partial report with warning. Workbook held in memory only, never written to workspace. Worker failure surfaces a typed Arabic message.

## Testing
Mapping unit tests using real value sets; merge tests (same id+month skipped, same id other month kept, system wins); completed-filter tests; worker test on a small synthetic workbook; deterministic snapshot of existing executive output unchanged. Gates: tier 3 (new feature + ingest) incl. `build`.

## Out of scope
Employee performance, writing workbook data to the workspace, editing system data.
