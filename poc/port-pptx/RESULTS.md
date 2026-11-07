# T2: Jeddah port business report as an editable PPTX, results 2026-11-05

Spike on branch `claude/pptx-poc`. Nothing in `src/` was touched. The source report code lives as uncommitted work in the `relaxed-thompson-5f82b6` worktree and was only read.

## Input and model

- Input: the workbook the report's author last used for this report (318 MB, study sheet «نتائج الدراسة» plus the year/quarter population sheets), and the workload cache JSON that `export-port-report-static.mjs --workload-cache` wrote from it. Both sit in the source session's scratchpad, not in git. They hold staff names and codes and are not committed.
- Flags, same as the source script's workload mode: `--port=ميناء جده الاسلامي --name=ميناء جدة الإسلامي --last-month=2026-09 --period=من 1 يناير 2024 إلى 30 سبتمبر 2026`.
- `buildModel.mjs` loads the source worktree's `portReportSource`, `portReportModel`, `portWorkloadModel`, `portNameCanonical` and `portReportHtml` through Vite SSR (Vite cache redirected into `out/`), repeats the script's workload branch step for step, and writes `out/model.json` and `out/report.html`.
- Identity check: the source script itself was run on the same input with its output written to `out/source-script.html`. `out/report.html` is **byte-identical** to it, and also byte-identical to the source worktree's latest `dist-preview/pr-check.html`. So the model behind the PPTX is the model behind the HTML report.
- Headline figures: 44,523 studied images, نسبة التوائم 82.95%, 177 employees.

## Pipeline

| File | Role |
|---|---|
| `buildModel.mjs` | Model + reference HTML from the source code (above). |
| `geometry.mjs` | Opens `report.html` in headless Edge with every slide forced visible, walks each slide and dumps boxes in 1920x1080 slide px: filled boxes and border rules, text blocks with styled runs, tables (cells, fills, rules, column widths, row heights), deck3 CSS bar charts (bar values from their labels, tones, categories, reference lines), the timeline svg, the logo, and every visible text node for the parity check. |
| `toPptx.mjs` | `geometry.json` (+ `model.json` for the timeline) to `out/port-report.pptx` with pptxgenjs, then zip post-processing. |
| `verify.ps1` | PowerPoint COM: open, slide count, per-slide shape counts, PNG export, Edit Data on two charts. Writes `out/com.json`. |
| `check.mjs` | Zip checks for G2, G4, G9, G10. Writes `out/check.json`. |

Rerun from the worktree root: `node poc/port-pptx/buildModel.mjs <sourceRoot> <workbook.xlsx> <workloadCache.json> <flags above>`, then `node poc/port-pptx/geometry.mjs`, `node poc/port-pptx/toPptx.mjs`, `pwsh poc/port-pptx/verify.ps1`, `node poc/port-pptx/check.mjs`.

Conventions reused from `poc/pptx`: 6350 EMU per px, pt = px x 0.5, charset/pitchFamily stripped from every font ref, zero text insets, `spcPts` line spacing for wrapped blocks, charts with embedded workbooks. Direction (study section 5 and T1): every paragraph in slides and charts is `rtl="1" algn="r"`, master and layout defaults rewritten from `rtl="0" algn="l"` to `rtl="1" algn="r"`, every table carries `a:tblPr rtl="1"` with columns in logical order, and every Latin or digit token is its own run with `lang="en-US"` and `<a:rtl val="0"/>`. No U+200E anywhere.

How each HTML part maps:

- Text: one text box per HTML text block, one run per styled span. Single-line boxes get extra width on their left so a wider PowerPoint face cannot wrap them.
- Tables: one real table per HTML table, cell fills, top/bottom rules, padding and row heights from the layout. The 133 + 44 employee rows paginate exactly as the HTML does (12 per slide, 12 + 4 slides), because each HTML slide becomes one PPTX slide.
- KPI cells and stat stacks: text boxes plus rectangles and rule lines.
- Bar charts (9): native clustered column charts with embedded data, per-point colours, value labels with the HTML's format (`0.0"%"` or `#,##0`), axis range solved from the bar heights, categories right to left. This covers the workload bars, the yearly population/sample pair, the type and ranking charts, the L1/L2 pair, and the three tier histograms.
- Timeline: a native line chart rebuilt from `model.monthly` with the HTML's series, colours, widths and dashes; labels only on the two series the HTML labels (all ports above, the port below); points on the tick marks; the two period-average lines and the year names as shapes and text.
- Logo: the only picture (SVG with PNG fallback), on the cover and the closing slide.

## Slide count

**37 slides**, the same as the HTML (37 `section.slide.v3`, including the print-default-off L1/L2 slide).

## G1 to G10

| # | Result | Evidence |
|---|---|---|
| G1 opens without repair | **PASS (COM)** | `Presentations.Open` succeeded, `Slides.Count = 37` = HTML. A manual double-click open was not done. The first build failed to open; the cause was a second `a:pPr` inserted where pptxgenjs writes whitespace between `<a:p>` and `<a:pPr>` in chart XML. Fixed. |
| G2 no pictures except the logo | **PASS** | 2 `p:pic` in the whole file: slide 1 and slide 37, both the logo. COM counts 1 picture on each of those slides and 0 elsewhere. |
| G3 native text, tables, charts | **PASS** | COM totals: 307 text shapes, 35 tables, 10 charts, 2 pictures, 161 rectangles and rules; every chart has an embedded workbook. Per slide below. |
| G4 rtl and right alignment | **PASS** | 3,062 of 3,062 paragraphs in slides and charts have `rtl="1"` and `algn="r"`; 35 of 35 tables `rtl="1"`; master and layouts carry no `rtl="0"` or `algn="l"`. |
| G5 Latin digits, correct order | **PARTIAL** | T1 method (separate LTR runs, 2,503 of them). Correct in tables, chart labels, employee codes (`A6838`, which the U+200E build drew as `6838A`) and page numbers from 10 on (`20 / 37`). Still wrong in the PowerPoint PNGs although the XML has them as separate LTR runs: page numbers with a leading zero (`03 / 37` drawn as `37 / 03`), and some percentages inside Arabic sentences (the slide 18 header note, and two of three in each slide 15 legend line, drawn with the `%` first). Not resolved in this round. |
| G6 no clipped text | **not measured** | No overflow check in the engine yet. None seen in the 4 PNGs. The HTML clips long names with an ellipsis in the dense appendix table; the PPTX holds the full text. |
| G7 positions match HTML | **G7b PASS** | 304 text boxes and 2644 table cells: line count equal to the HTML in every one; every text box and table top-left within 2px of the HTML (wrapped boxes: see the fix-round notes). Pixel diff per slide in the fix-round section. |
| G8 Somar in PowerPoint | **FAIL on this machine** | XML names Somar everywhere, but the PowerPoint PNGs show a substitute face (compare `out/html-06.png` and `out/pptx-06.png`). P7 from `poc/pptx` (per-user install) still applies. |
| G9 figure parity | **PASS, 0 mismatches** | 2,726 numbers on the HTML side and 2,726 on the PPTX side, equal as multisets on every one of the 37 slides. See below. |
| G10 no long dashes, no emojis | **PASS** | 0 U+2013/U+2014 and 0 pictographic characters in slide text and chart caches. |

Edit Data, through COM (`ChartData.Activate`, set B2 = 42, read series point 1, close without saving):

| Chart | A2 | B2 before | Series point 1 before / after |
|---|---|---|---|
| Slide 3, workload bar chart | المستوى منخفض | 10 | 10 / 42 |
| Slide 15, monthly timeline (line) | 1 | 84.13 | 84.13 / 42 |

## G9 method and mismatch list

- HTML side: every visible text node of each slide in the laid-out report, except the timeline's value-axis tick labels (`30%` to `100%`). PowerPoint draws its own axis ticks, which are not stored in any cache.
- PPTX side: every `a:t` on the slide, plus for each chart on it the category labels (first series only, as every series repeats them) and the values of every series whose data labels are shown, formatted with that chart's label format code.
- Tokens: `\d[\d,]*(\.\d+)?%?`, commas removed, U+200E removed.
- The timeline's land and sea series carry 66 values (2 x 33 months) that neither the HTML nor the PPTX labels. They are in the chart's workbook for editing and are not counted.
- Chart caches store the displayed precision for bar charts (the value parsed from the HTML label, e.g. 85.3), because that is what the HTML shows. The timeline stores the model value x 100 to 2 decimals and shows it with `0"%"`.

Per-slide mismatches: **none** (0 tokens only in HTML, 0 only in PPTX, on all 37 slides).

## Per-slide shapes (COM)

`text / table / chart / picture / other`; "other" is rectangles and rules (panels, swatches, plot backgrounds, reference lines).

| Slide | Content | Counts |
|---|---|---|
| 1 | Cover | 15 / 0 / 0 / 1 / 2 |
| 2 | Workload tiers | 33 / 3 / 0 / 0 / 18 |
| 3 | Workforce distribution | 7 / 2 / 1 / 0 / 5 |
| 4 | L1/L2 by workload tier | 9 / 4 / 0 / 0 / 9 |
| 5 | Port vs tiers by year | 11 / 1 / 1 / 0 / 8 |
| 6 | Divider (appendices) | 4 / 0 / 0 / 0 / 2 |
| 7, 8 | Glossaries | 18 / 0 / 0 / 0 / 11; 11 / 0 / 0 / 0 / 6 |
| 9 | Workload of all ports | 5 / 1 / 0 / 0 / 1 |
| 10, 12, 17, 32 | Dividers | 4 / 0 / 0 / 0 / 2 each |
| 11 | Population and sample by year | 8 / 1 / 1 / 0 / 5 |
| 13 | Results by port type | 6 / 1 / 1 / 0 / 4 |
| 14 | Ranking vs all ports | 8 / 0 / 1 / 0 / 6 |
| 15 | Monthly timeline | 17 / 0 / 1 / 0 / 8 |
| 16 | L1/L2 results | 6 / 2 / 0 / 0 / 5 |
| 18 | Accuracy tiers (3 histograms) | 12 / 3 / 3 / 0 / 9 |
| 19 | Staff vs land and sea | 7 / 1 / 1 / 0 / 5 |
| 20 to 31 | Employee table, 12 pages | 7 / 1 / 0 / 0 / 3 each |
| 33 to 36 | Appendix employee table, 4 pages | 7 / 1 / 0 / 0 / 3 each |
| 37 | Closing | 2 / 0 / 0 / 1 / 1 |

## PNGs (PowerPoint COM export, 1920x1080, in `out/`, not committed)

- `out/slide-03.png`: workforce table, yearly panel table, bar chart.
- `out/slide-15.png`: monthly timeline line chart with labels, averages and year names.
- `out/slide-18.png`: three tier histograms with their tables.
- `out/slide-20.png`: first employee table page (contains staff names; keep local).

## Open items

1. G5: `20 / 37` style clusters still reorder in PowerPoint. Test variants in T1 (no spaces, U+2066/U+2069 isolates, or a separate LTR text box for page numbers).
2. Timeline chips overlap where the two labelled lines cross; the HTML has the same density but places chips by hand.
3. G6 and G7 need the engine's own overflow measurement and a pixel diff; G8 needs Somar installed machine-wide.
4. The HTML centres table figures; per the brief every paragraph is `algn="r"` here, so figures are right-aligned in their cells.

## Fix round 2026-11-05 (owner-approved)

1. **Timeline axis order: no change needed, verified.** The HTML timeline runs oldest on the RIGHT: in the laid-out svg, year label 2024 is at x=1389, 2025 at x=811, 2026 at x=305, and month 1 of 2024 at x=1678. The source says the same ("RTL timeline: the oldest month on the right"). The PPTX (`catAxisOrientation: maxMin`) also has 2024 on the right and 2026 on the left (`out/slide-15.png`), so it matches; no chart-level bidi setting was added. Every bar chart (slides 3, 5, 11, 13, 14, 18 x3, 19) has its first category on the right in the HTML (bar x positions from Edge) and in the PPTX (maxMin), checked in the slide 3 and 18 PNGs.
2. **Number runs.** U+200E removed (0 left). Every Latin or digit token (`[A-Za-z0-9][A-Za-z0-9.,%-/:+]*`, with ` / ` joining clusters such as `20 / 37`) is its own run with `lang="en-US"` and `<a:rtl val="0"/>`; the paragraph keeps `rtl="1" algn="r"`. One `a:pPr` per paragraph is kept. Master and layout defaults are now `rtl="1" algn="r"`. Result: G5 partial (see the table).
3. **Timeline labels.** Each series has its own `c:dLbls`: all ports `dLblPos t` (above), the port `dLblPos b` (below), each on its line colour; the land and sea series have `<c:delete val="1"/>`, as in the HTML. Overlap is much reduced; a few chips still touch where both labelled lines are within a few points of each other.
4. **G7b layout parity.** HTML line counts come from Edge range client rects (a word whose middle is below the previous word's bottom starts a new line). The first run found 71 mismatches, all with fewer lines in PowerPoint. Two causes: (a) a converter bug merged `456<br>(9.0%)` into one run and dropped the break; (b) PowerPoint fits more text per line than Chromium with the same width, so wrapped HTML text came out on fewer lines. Fix for (b): the geometry pass records where the browser wrapped each line, and the PPTX gets a soft line break (`a:br`) at exactly those points. Single-line HTML text is a box equal to the HTML text box with `wrap` off. Wrapped text is a box of the HTML line width x 1.04 (T4 safety factor), capped at the block width and anchored on its right edge, so a wrapped box's left edge sits up to 4% of its width left of the HTML text. Final: **0 mismatches** over 304 text boxes and 2644 table cells.
5. **Pixel diff, all 37 slides** (Edge PNG `out/html-NN.png` vs PowerPoint PNG `out/pptx-NN.png`, share of pixels differing by more than 32 on any channel): 1: 5.9%, 2: 6.61%, 3: 5.93%, 4: 6.95%, 5: 7.55%, 6: 1.36%, 7: 5.07%, 8: 4.29%, 9: 5.31%, 10: 4.17%, 11: 7.44%, 12: 3.08%, 13: 4.51%, 14: 4.96%, 15: 7.25%, 16: 4.32%, 17: 4.53%, 18: 5.41%, 19: 9.74%, 20: 6.24%, 21: 7%, 22: 7.14%, 23: 7.72%, 24: 8.05%, 25: 7.61%, 26: 7.72%, 27: 7.72%, 28: 7.77%, 29: 7.5%, 30: 7.51%, 31: 3.28%, 32: 4.55%, 33: 7.12%, 34: 6.91%, 35: 7.24%, 36: 6.16%, 37: 0.63%. Most of the difference is the substitute font (G8) and PowerPoint placing chart labels its own way.

Re-run after the fixes: G1 PASS (37 slides), G4 PASS, G5 PARTIAL, G9 PASS (2,726 = 2,726, 0 mismatches), Edit Data PASS on slide 3 (10 to 42) and slide 15 (84.13 to 42), G10 PASS. New files: `layout.mjs` (G7b and pixel diff); `verify.ps1` now also dumps line counts and exports all 37 slides.
