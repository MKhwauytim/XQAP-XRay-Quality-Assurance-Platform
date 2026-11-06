# T8: the report workbook (raw data, processing sheets, processed sets, statistics)

Spike on branch `claude/pptx-poc`. Nothing in `src/` or `poc/port-pptx/` was written; both, the source worktree and the raw source workbook were only read. Generated files (the workbook, its row data, screenshots) stay in `out/`, which is git-ignored.

**Verdict: T8 PASS, with one size finding.** The full workbook carries every raw row exactly as uploaded and opens in Excel without repair, but it is large: 693 MB on disk, about 2 to 4 minutes to open, about 4.5 GB of Excel memory (numbers below).

## Pipeline

| Script | Does |
|---|---|
| `stage.mjs` | Streams the raw workbook once and applies the source's own rules (population: `scripts/lib/workloadSheets.mjs`; study: `portReportSource.ts`; names: `portNameCanonical.ts`; cutoff and groups: `poc/port-pptx/buildModel.mjs`). Writes the processed rows and every step's tables. About 2.5 min. |
| `build.mjs` | Builds the package on top of the raw workbook itself (JSZip), so the raw sheets, shared strings, tables, printer settings and external link keep their exact bytes. SheetJS writes all other cells; the post-process adds styles, theme fonts, tables, pivots, charts, shape buttons, slicers, separators and views, then runs the M15 name check. About 2.6 min. |
| `verify.ps1` | Opens the result in Excel through COM and runs every check below. |
| `sourcecounts.ps1` | Records the raw workbook's own sheet sizes and open time, the reference for the raw-sheet check. |
| `shots.ps1` | Screenshots of every sheet, taken from a build with the same layout and the first 2,000 processed rows (Excel refuses `CopyPicture` while it holds the full file). |
| `opencheck.ps1` | Open-only probe, used to bisect package problems. |

`extract.mjs` is the round 1 extractor, kept for reference; the current build does not use it.

## Sheet order (36 sheets)

الفهرس, `|`, 11 raw sheets (Q4B, 2024, 2025-Q1 to 2026-Q4, نتائج الدراسة), `||`, 12 processing sheets in the order applied (ربط أعمدة المجتمع، حذف الصور المكررة، استبعاد بلا منفذ أو تاريخ، تطبيق فترة التقرير، اشتقاق حقول المجتمع، توحيد أسماء المنافذ، تحديد مجموعة المنفذ، تجميع المجتمع حسب المنفذ، ربط أعمدة العينة، استبعاد خارج فترة العينة، اشتقاق حقول العينة، استبعاد غير الموظفين), `|||`, المجتمع 1 to 4 and العينة, `||||`, الإحصائيات, `|||||`, المصدر.

- Raw sheets are byte-identical to the upload. The source's own separator sheet `|` (one row, not used by the report) is not carried; its name would also clash with the first separator.
- The processed population is 3,895,357 rows, more than one sheet holds, so it is split into four sheets of up to 1,048,565 rows. Each processed row keeps every raw cell (same value, style and shared-string index; formulas dropped, cached value kept) under the union of all population sheets' headers, then the source sheet, source row and the derived fields.
- Headers that differ only in the hamza on alef («الأشعة» / «الاشعة») share one column. Excel compares table column names ignoring that hamza, and a table holding both will not open. The first processing sheet lists every original header and the column it went to.
- Every sheet except the raw ones opens with the same header block: title, a one-sentence purpose, «يقرأ من», «القاعدة» and «الصفوف» (before and after), plus a back button. Raw sheets stay exactly as uploaded.
- Buttons are rounded-rectangle shapes with `a:hlinkClick`; no cell text is used as a button. Fact cards and every المصدر row link to the pivot cell they come from, and the cover indexes every sheet.
- Names follow M15: Arabic sheet, table, pivot, slicer, shape and chart names; statistics named by meaning, with the slide they feed. `build.mjs` refuses to write the file if any visible name matches an id pattern (`latin_snake`, `camelCase`, a `tbl` prefix, short ids like `s1`, `pivot`/`Slicer`/`Chart`/`Button` with a number, or «خطوة N»).
- Somar is the Normal style font, the theme's major and minor fonts (so slicers and pivots use it), and the font of every chart and shape text. The raw sheets' cell fonts are also set to Somar; their values are untouched.

## Checks (Excel 365 through COM, full workbook, `out/verify.json`)

| Check | Result | Evidence |
|---|---|---|
| Opens with no repair | **PASS** | `CorruptLoad=0`, alerts off: opened, 0 new recovery logs |
| Sheet order and names | **PASS** | 36 sheets, order as above |
| Separators | **PASS** | 5 separators: black tab, black cells, no gridlines, no headings, empty, no shapes |
| Raw sheets equal the source | **PASS** | 11 of 11: used-range rows, columns and origin equal the source workbook's (e.g. 2025-Q1 614,989 x 12, نتائج الدراسة 165,335 x 31) |
| Processing reconciles | **PASS** | Per raw sheet: rows = before header + header + duplicates + no port/date + after period + kept, difference 0 on all 10 population sheets. Population: 3,958,584 rows, 63,174 duplicates, 39 after the period, 3,895,357 kept, equal to the 4 processed tables' row total. Study: 165,334 rows, 33 excluded, 165,301 kept, equal to the processed العينة table |
| Pivots equal the report | **PASS** | 23 figures from `model.json`, read with `GetPivotData` and from the linked cell, 46 of 46 on open and after `RefreshTable` |
| Charts | **PASS** | 7 of 7: every point equals its pivot item and the built cache |
| Slicers | **PASS** | 5 slicer caches (3 pivot, 2 table). Deselecting «منفذ بري» drops the العينة pivot from 165,301 to 79,987 (minus 85,314); deselecting 2024 hides exactly that year's table rows |
| Shape buttons | **PASS** | 25 of 25 navigate to their target; all rounded rectangles with Somar text |
| Cell links | **PASS** for every link this build adds | 71 of 95 navigate. The 24 that do not are links inside the raw sheets (the 2026 sheets' first-row links to sheets that were never in the uploaded file); they are kept as uploaded |
| Fonts | **PASS** | Normal style Somar, theme minor and major Somar, all 7 chart titles Somar, all 25 buttons Somar |
| Human names | **PASS** | Build check: 457 visible names, 0 id-like. Excel read-back: 279 names (sheets, tables, headers, pivots, measures, shapes, chart titles, slicer caches, slicers, captions), 0 id-like |

## Size and timings

| Item | Value |
|---|---|
| Raw source workbook | 318 MB; Excel opens it in 49 to 69 s |
| Report workbook | 693 MB, 36 sheets, about 7.4 million data rows (3.96 M raw population + 3.90 M processed population + 0.33 M study) |
| Excel open to ready | 119 to 217 s across runs, pivots refreshed on open included |
| Excel memory after open | 4.3 to 4.7 GB |
| Explicit refresh of all 7 pivots | 15 to 32 s |
| `stage.mjs` | about 2.5 min |
| `build.mjs` | about 2.6 min (almost all of it compressing the processed sheets) |

## Findings

- The size is driven by carrying the processed population at row level next to the raw population: each is about 3.9 million rows. A link-only design (processed rows as references into the raw sheets) or keeping the processed population at the port and month grain would roughly halve the file. That choice belongs to the owner, so all data is kept here.
- Excel treats table column names that differ only by the hamza on alef as the same name. A table holding both does not open, and there is no recovery log. The processing step merges such headers and shows the mapping.
- A pivot field missing from its source table makes the whole file refuse to open with no recovery log. The study's group column is «نوع المنفذ2» in this upload, so the field is taken from the alias the source parser actually matched.
- A SheetJS `metadata.xml` relationship without the part, and the `.bin` default content type (macro binary instead of printer settings), each make the package unreadable. Both are fixed in the post-process.
- `Range.CopyPicture` fails on the full 693 MB file, and Excel sometimes crashes partway through 36 screenshots. Screenshots come from the same build cut to 2,000 processed rows, resumed after a crash.
- The raw workbook's Power Query package (`customXml`) and its connection are not carried: they are a query definition, not data.
- Not covered: Excel for the web, LibreOffice, Excel older than 2013 (table slicers), and 32-bit Excel, which could not hold this file.
- Known cosmetic issue: the year column of «تجميع المجتمع حسب المنفذ» shows a thousands separator (2,024); the value is the number 2024.
