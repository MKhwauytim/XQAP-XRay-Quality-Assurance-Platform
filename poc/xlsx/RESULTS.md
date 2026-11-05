# T8: report workbook with native Excel tables and pivot tables

Spike on branch `claude/pptx-poc`. Nothing in `src/` or `poc/port-pptx/` was written.

**Verdict: T8 PASS.** SheetJS (vendored community build) writes the cells; a JSZip post-process adds table parts, pivot cache definitions, pivot tables, RTL sheet views and frozen panes. Excel opens the file with no repair, and the pivots fill themselves on open.

## Data

- Base set (المجتمع): the workload cache the T2 model was built from, one row per port x month (587 rows, filtered to months up to 2026-09, canonical port names, same group assignment as `buildModel.mjs`). This is the exact set the model's population figures sum; the 318 MB row-level population was not needed and was not loaded as rows.
- Derived set (العينة): every studied image in the report period (165,301 rows), parsed by the source worktree's own `portReportInputFromSheets` through Vite SSR, read only. Staff codes and names are dropped; the sheet keeps port, group, year, month, image status and the 0/1 match flag.
- `extract.mjs` rebuilds both sets (42 s, mostly reading the 318 MB workbook); `build.mjs` writes the workbook; `verify.ps1` checks it in Excel through COM; `opencheck.ps1` is the open-only probe used for bisecting.

## Layout

| Order | Sheet | Content |
|---|---|---|
| 0 | الفهرس | One row per sheet: an internal hyperlink and a one-line description |
| 1 | المجتمع | Table `tblPopulation` at A1:F588 (filters, frozen header), pivot «مجموع الصور لكل منفذ» at H3 |
| 2 | العينة | Table `tblSample` at A1:F165302 (filters, frozen header), pivot «الدراسات ونسبة التوائم لكل منفذ» at H3 |
| 3 | الإحصائيات | Five pivots side by side (A, E, I, M, R), each titled and labelled «يغذي الشريحة: ...» with the slide heading it feeds |
| 4 | المصدر | 23 report figures: value, sheet, field, filter, measure and the pivot that reproduces it |

Column placement: every sheet has `rightToLeft="1"`, so column A is drawn at the right edge. The table starts at A (read first), G is an empty spacer, and the pivot starts at H, which puts it visually to the LEFT of the table. Pivots on الإحصائيات are spread across columns rather than stacked, so a refresh that grows one can never overlap the next.

## Checks (Excel 365 through COM, `out/verify.json`)

| Check | Result | Evidence |
|---|---|---|
| Opens with no repair | **PASS** | `CorruptLoad=0`, `DisplayAlerts=false`: workbook opened, 0 new recovery logs (`%TEMP%\error*.xml`), caption has no "[Repaired]" |
| ListObjects on data sheets | **PASS** | `tblPopulation` A1:F588 and `tblSample` A1:F165302, both with AutoFilter |
| Frozen header | **PASS** | FreezePanes true on المجتمع, العينة, المصدر |
| PivotTables exist | **PASS** | 7 pivots (1 + 1 + 5) |
| Refresh on open | **PASS** | `refreshOnLoad="1"`, `saveData="0"`, no records part; RefreshDate set at open and all 23 figures already correct before any explicit refresh |
| `RefreshTable` | **PASS** | True for all 7 pivots |
| Pivot values = report figures | **PASS** | 23 figures from `model.json` (populations, studied counts, the four outcome counts, match rates by port, group and year) equal `GetPivotData`, 46/46 (on open and after refresh), tolerance 1e-9 |
| Index hyperlinks navigate | **PASS** | 4/4 `Follow()` land on the named sheet |
| RTL | **PASS** | `DisplayRightToLeft` true on all 5 sheets |
| No long dashes, emojis, staff names | **PASS** | No staff columns in the workbook; committed files hold none |

Screenshots: `out/sheet-0.png` to `out/sheet-4.png` (Range.CopyPicture pasted into a chart and exported); viewed, pivots render with values and sit to the left of the tables.

## Size and timings

| Item | Value |
|---|---|
| Workbook size | 3,798 KB (165,888 data rows) |
| SheetJS write | about 3.5 s |
| JSZip post-process | about 1.7 s |
| Excel open to ready (incl. pivot refresh on load) | 1.8 s |
| Explicit RefreshTable of all 7 pivots | 4.4 s |

## Findings

- No pivot records part is needed: a cache definition with `saveData="0" refreshOnLoad="1"` plus shared items only for the axis and page fields is accepted, and Excel builds the cache on open. This keeps the file small and avoids writing 165k cache records.
- The cache source is the table name (`worksheetSource name="tblSample"`), so pivots follow the table if rows are added.
- COM gotcha, not a file problem: `Workbooks.Open` can return before a refreshing workbook is ready, and `Workbooks.Count` reads 0 or calls fail with `RPC_E_CALL_REJECTED`. Early bisect runs looked like rejected files for this reason. The scripts now poll `Workbooks.Count` and `Application.Ready` before checking.
- The Excel-COM fallback (let Excel create the pivots) was not needed.
- Not covered: Excel for the web, LibreOffice, and Excel versions older than 2016 (`minRefreshableVersion="3"`). A pivot opened with macros or protected view off is assumed; protected view (file from the internet) would block refresh until the user enables editing.
