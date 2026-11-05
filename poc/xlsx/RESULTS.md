# T8: designed report workbook with native tables, pivots, charts and slicers

Spike on branch `claude/pptx-poc`. Nothing in `src/` or `poc/port-pptx/` was written; both were only read.

**Verdict: T8 PASS.** SheetJS (vendored community build) writes the cell values. A JSZip post-process writes everything else: a styles part in deck3 colours with Somar as the workbook font, Excel tables, pivot caches and pivot tables, drawings (logo picture, native charts), pivot and table slicers, separator sheets, right-to-left views and frozen panes. Excel opens it with no repair, and the pivots and charts fill themselves on open.

## Data

- Base set (المجتمع): the workload cache the T2 model was built from, one row per port and month: 587 rows, months up to 2026-09, canonical port names, groups assigned as in `buildModel.mjs`. This is the exact set the model's population figures add up, so the 318 MB row-level population was not needed.
- Derived set (العينة): every studied image in the report period, 165,301 rows, parsed by the source worktree's own `portReportInputFromSheets` through Vite SSR, read only. Staff codes and names are dropped.
- `extract.mjs` rebuilds both sets (42 s, mostly reading the 318 MB workbook). `build.mjs` writes the workbook. `verify.ps1` checks it through Excel COM. `opencheck.ps1` is the open-only probe used for bisecting.

## Design

| Order | Sheet | Content |
|---|---|---|
| 0 | الفهرس | Navy title band with the deck's logo top right, report name and period, issue date, four fact cards, and four navigation buttons with a one-line description each |
| 1 | `\|` | Separator: black tab, all cells black, gridlines and headings hidden, empty |
| 2 | المجتمع | Band, logo, back button; table `tblPopulation` at B9, pivot at I9, a pivot slicer (المجموعة) and a table slicer (السنة) at M, a bar chart at Q |
| 3 | العينة | Same layout: `tblSample` at B9, pivot at I9, slicers, a bar chart of the match rate by port |
| 4 | `\|\|` | Separator |
| 5 | الإحصائيات | Grid of 3 rows x 2 blocks; each block is a pivot titled with the slide it feeds and a chart beside it; the sixth block holds a year slicer connected to two pivots |
| 6 | `\|\|\|` | Separator |
| 7 | المصدر | Band, logo, back button; `tblSource` with the 23 report figures and their sheet, field, filter, measure and pivot |

- Colours are deck3 tokens only (`theme.ts`): background `#f9f8f5`, panel `#f2f0ea`, navy `#10304f`, text `#22303e`, muted `#5d6b7a`, hairline `#e3e0d8`, gold `#b48a3c`, gold light `#c9a45e`, blue `#3f6fa8`, green `#2e7d4f`, track `#eceae3`. Tables and pivots use one custom table style, Deck3: navy header, panel stripes, total row with a gold rule.
- Somar is the Normal style font and the font of every chart text. Numbers use Latin digits (`#,##0`, `0.00%`).
- Logo: the PNG the PPTX deck embeds (`geometry.json`, slide 1), a white logo, placed on the navy band.
- RTL placement: column A is drawn at the right edge, so A is a margin, the table starts at B, and the pivot, slicers and chart follow to its left on screen.
- Charts are bound to the pivot output cells, and their caches are filled with the same aggregation, so they show correct values before and after refresh.

## Checks (Excel 365 through COM, `out/verify.json`)

| Check | Result | Evidence |
|---|---|---|
| Opens with no repair | **PASS** | `CorruptLoad=0`, `DisplayAlerts=false`: opened, 0 new recovery logs, caption has no "[Repaired]" |
| Sheet order and names | **PASS** | الفهرس, \|, المجتمع, العينة, \|\|, الإحصائيات, \|\|\|, المصدر |
| Separators | **PASS** | Tab colour 0 (black), cells A1, M30 and AZ200 have black fill, gridlines off, headings off, CountA = 0, no shapes |
| Content sheets | **PASS** | All RTL, gridlines off, background fill `#f9f8f5`, logo picture present, frozen panes on المجتمع, العينة, المصدر |
| Font | **PASS** | Normal style font = Somar |
| Hyperlinks and back buttons | **PASS** | 8 of 8 `Follow()` land on the right sheet: 4 cover buttons and 4 back buttons |
| ListObjects | **PASS** | `tblPopulation`, `tblSample`, `tblSource` |
| PivotTables, refresh on open | **PASS** | 7 pivots; `refreshOnLoad="1"`, `saveData="0"`, no records part; `RefreshTable` True for all 7 |
| Charts exist and match the pivots | **PASS** | 7 ChartObjects (1, 1, 5); every point of every series equals the pivot's `GetPivotData` for that item and the built cache (61 points) |
| Slicers exist | **PASS** | `SlicerCaches.Count` = 5: 3 pivot slicers, 2 table slicers |
| Pivot slicer filters its pivot | **PASS** | Deselecting «منفذ بري» in `Slicer_SmpGroup`: the pivot2 total goes from 165,301 to 79,987 (minus 85,314), and back after `ClearManualFilter` |
| Table slicer filters its table | **PASS** | Deselecting 2024 in `Slicer_SmpYear`: visible `tblSample` rows go from 165,301 to 145,176 (minus the 20,125 rows for 2024) |
| Pivot values = report figures | **PASS** | 23 figures from `model.json` equal `GetPivotData`, 46 of 46 (on open and after refresh) |
| No long dashes, emojis, staff names | **PASS** | No staff columns; committed files hold none |

Screenshots (`out/sheet-0.png` to `out/sheet-7.png`, made with CopyPicture into a chart export) were reviewed by eye. The first render had the band title overlapping the logo on الفهرس and الإحصائيات; the title now starts one column further left on those two sheets. Nothing overlaps or is clipped in the final render, and every sheet keeps a margin column and spacer columns between blocks.

## Size and timings

| Item | Value |
|---|---|
| Workbook size | 3,897 KB (165,888 data rows) |
| SheetJS write | about 4 to 5 s |
| JSZip post-process | about 2 to 3 s |
| Excel open to ready (incl. pivot refresh on load) | 2.1 s |
| Explicit RefreshTable of all 7 pivots | 2.8 s |

## Findings

- A pivot cache needs no records part: a definition with `saveData="0" refreshOnLoad="1"` and shared items only for the axis, page and slicer fields is accepted. Excel builds the cache on open.
- Pivot slicers need the x14 `pivotCacheDefinition` extension in the cache (`pivotCacheId`), a `slicerCache` part with `tabular` items, a workbook-level `#N/A` defined name per slicer cache, the workbook `x14:slicerCaches` extension, a `slicers` part with its sheet extension, and the slicer frame in the drawing inside `mc:AlternateContent` (`a14`).
- Table slicers use `x15:tableSlicerCache` and the workbook `x15:slicerCaches` extension. The sheet extension `{3A4CF648-...}` must hold `x14:slicerList`, not `x15:slicerList`. With `x15:slicerList`, Excel opened the file with no repair prompt and silently dropped the two table slicers. Only checking `SlicerCaches.Count` caught it.
- COM timing: `Workbooks.Open` can return before a refreshing workbook is ready, and slicer calls can fail with `0x800AC472` while Excel recalculates. The scripts poll `Workbooks.Count` and `Application.Ready` before checking, and retry slicer calls.
- The Excel-COM fallback (let Excel create the pivots) was not needed.
- Not covered: Excel for the web, LibreOffice, and Excel versions older than 2013 (slicers on tables need 2013). Protected View on a downloaded file blocks the refresh on open until the user enables editing; the charts and caches still show the built values.
