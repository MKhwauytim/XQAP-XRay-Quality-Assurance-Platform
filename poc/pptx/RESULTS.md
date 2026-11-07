# PPTX fidelity PoC (المرحلة 0): results, 2026-11-05

This is a spike on branch `claude/pptx-poc`. Nothing in `src/` was touched. One layout model (`model.mjs`, absolute px boxes on a 1920×1080 slide) drives both renderers:

| File | Role |
|---|---|
| `model.mjs` | Fixture plus boxes (title, 4-cell KPI band, 6-port column chart, 5×4 table). Colours copied from `deck3/theme.ts` (`--v3-navy/text/muted/hair/blue/bg`). |
| `toPptx.mjs` | Writes the PPTX with pptxgenjs 4.0.1, then post-processes the zip with JSZip. Outputs `out/poc.pptx` and `out/poc.raw.pptx` (before post-processing). |
| `toHtml.mjs` | Writes `out/poc.html`: `position:absolute` boxes, `dir=rtl`, Somar via `@font-face`, SVG chart on the same axis. |
| `render.ps1` | PowerPoint COM: opens the file (P1), runs `Slides(1).Export(...,'PNG',1920,1080)` to produce `out/pptx.png`, runs the ChartData edit test (P2), then quits and releases COM. |
| `diff.mjs` | Zero-dependency PNG decode/encode (node:zlib). Writes `out/diff.png` and the diff %. |
| `check.mjs` | Zip/XML checks for P2–P4, P6 and P8. |

Rerun: `node poc/pptx/toPptx.mjs && node poc/pptx/toHtml.mjs && pwsh poc/pptx/render.ps1`, then the Edge capture `msedge --headless --hide-scrollbars --force-device-scale-factor=1 --window-size=1920,1080 --screenshot=poc/pptx/out/html.png <file:///…/poc.html>`, then `node poc/pptx/diff.mjs && node poc/pptx/check.mjs`.

## P1–P8

| # | Result | Evidence |
|---|---|---|
| P1 opens without repair | **PASS** (via COM) | `Presentations.Open` reported `P1 OPEN_OK slides=1`, and `Export` succeeded. COM does not show a repair dialog the way an interactive open does. A manual double-click check is still worth doing once. |
| P2 chart is editable through embedded data | **PASS** | The zip contains `ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx`, and `chart1.xml` has `<c:externalData>`. Through COM, `ChartData.Activate()` exposed sheet values `A2=ميناء جدة` and `B2=88.1`. Setting B2=42 changed series point 1 from `88.1` to `42`. The workbook was closed without saving, and no POWERPNT or EXCEL process was left running. |
| P3 Arabic, RTL, Latin digits | **PASS, after 2 post-processing fixes** | Counts: `rtl="1"` ×14, `lang="ar-SA"` ×28, `<a:cs typeface="Somar">` ×57, 19 Latin-digit runs, 0 Arabic-Indic digits. Shaping and RTL order look correct in `pptx.png`. Two problems had to be fixed (see "Findings" 1 and 2). Without those fixes this criterion fails: see `out/pptx-raw-charset-bug.png`. |
| P4 table geometry | **PASS (exact)** | Real `<a:tbl>`. `a:gridCol` = [1206500, 1206500, 1206500, 1714500] EMU, which equals model px × 6350 with columns mirrored for RTL. Δ = 0 EMU. Every `a:tr h` = 406400 = 64 px × 6350. |
| P5 visual match | **number reported, no threshold** | Per-channel tolerance 32: **4.14 % of all slide pixels differ** (85,830 / 2,073,600). That is about 36 % of the "ink" (non-background) pixels. At tolerance 0: 5.64 %. See `out/diff.png`. |
| P6 bundle cost | **measured** | `pptxgen.bundle.js` (includes JSZip): **450.1 KB raw / 154.0 KB gzip**. `pptxgen.min.js` (JSZip not included): 264.7 / 94.1 KB. `pptxgen.es.js` (unminified ESM, what Vite would tree-shake from): 504.8 / 137.4 KB. These are file sizes, not the Δ from `npm run build`, because the app was not wired up. |
| P7 Somar in both renders | **PARTIAL / FAIL for PowerPoint on this machine** | HTML: yes. It is loaded through `@font-face` from the installed TTFs. Edge did *not* resolve the per-user-installed "Somar" by name and fell back to Times. PowerPoint: the XML names Somar everywhere, but the rendered glyphs are clearly a substitute (Segoe-style digits and Arabic). Somar is installed **per-user** (`%LOCALAPPDATA%\Microsoft\Windows\Fonts`, HKCU registry). .NET's `InstalledFontCollection` in the same session does not list it, which suggests the GDI path PowerPoint renders through does not see it either. |
| P8 `lnSpc` / `spcPts` | **PASS** | pptxgenjs `lineSpacing` emits `<a:lnSpc><a:spcPts val=…>`: 9 of 9 text boxes, 0 `spcPct`. Source: `pptxgen.es.js:5832`. `catAxisOrientation:'maxMin'` is honoured: `<c:orientation val="maxMin">`. |

## Findings that change the research doc

1. **The `pt = px × 0.75` rule in §3-b is wrong for this unit mapping.** At 6350 EMU/px the slide is 144 px/in, so **pt = px × 0.5**. With 0.75, every PowerPoint text rendered 1.5× too large. This was measured in the first run, and the boxes overflowed. After switching to 0.5, glyph heights match the HTML.
2. **pptxgenjs writes `charset="-122"` on `a:ea` and `charset="-120"` on `a:cs`** for every run. With Somar, PowerPoint then drew the Latin digits in ar-SA runs as garbage glyphs (`ÇĐÆĚDĆ` for `48,250`; see `out/pptx-raw-charset-bug.png`). The post-processing step strips `pitchFamily` and `charset` from `a:latin/ea/cs/sym` (171 refs).
3. **Omitting `rtl` is not enough for number-only text.** `85.5%` rendered as `%85.5` until the post-processing step set an explicit `rtl="0"` and `lang="en-US"` on paragraphs with no Arabic letters. This confirms R6's "numbers in separate runs" rule, and it needs to be paragraph-level.
4. pptxgenjs table cell `margin` is in **inches** when every value is < 1, and in points otherwise (`pptxgen.es.js:5328`). That is an ambiguity to pin down in the engine.

## Main visual differences (pptx.png vs html.png)

- **Font face.** This is nearly all of the 4.1 %. PowerPoint draws a substitute for Somar, so letter shapes and advance widths differ. Titles and labels end a few px apart. The KPI numerals are narrower in PowerPoint.
- **Chart value-axis labels.** They sit about 30 px further right in PowerPoint (PowerPoint places them outside the plot area itself, and the HTML guessed 12 px). Gridlines, bar x/width/height and the baseline match to within a pixel or two.
- **Chart category and data labels** use PowerPoint's own vertical offsets, which differ from the HTML by a few px.
- Rules, the KPI separators, table rules, row heights and column positions are pixel-aligned (they show grey, not red, in `diff.png`).

## Recommendation

Continue to Phase 1 with **pptxgenjs + zip post-processing**. P2 and P3, the two that would have forced a switch to hand-written OOXML, both pass. Geometry from a shared px model is exact. Before any threshold for P5 means anything:

- **Resolve P7 first.** Install Somar machine-wide (`C:\Windows\Fonts`, which needs admin) on the test and target PCs and re-measure. Or pick an Office-bundled Arabic font for both renders. Until then the diff mostly measures font substitution.
- Build the post-processing step (charset strip, `rtl="0"` for numeric paragraphs) into the engine as a tested module, not as regex in a script.
- Have the HTML chart compute the axis-label positions PowerPoint uses (outside the plot area, plus a fixed gap), or drop the PowerPoint axis labels and draw them as text boxes from the model.
- Correct §3-b of the research doc (pt = px × 0.5).
