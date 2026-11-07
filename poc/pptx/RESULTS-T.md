# PPTX spike: tests T1, T3, T4, T5, T6, T7

Date: 2026-11-05. Branch `claude/pptx-poc`. Requirements: `docs/research/2026-11-05-report-engine-study-v2.md` sections 1, 5, 6, 7. T2 is out of scope here (separate work in `poc/port-pptx/`).

Every claim below is either an XML count, a PowerPoint COM read-back, an Edge DOM measurement, or a PNG that was opened and looked at. All PNG paths are under `poc/pptx/out/t/`.

## How to rerun

```
node poc/pptx/tests.mjs                        # measure in Edge, build tests.pptx + embed variants + HTML + Edge PNGs
pwsh poc/pptx/renderT.ps1                      # PowerPoint COM: PNGs, structure dump (com.json), zoom crops
python poc/pptx/otf2ttf.py <Somar.ttf> <out>   # T7 only: CFF -> glyf copy into out/t/fonts/ (not committed)
pwsh poc/pptx/renderT.ps1 -WithSomar           # same, with Somar visible to PowerPoint (com-somar.json, somar-*.png)
pwsh poc/pptx/t7-office.ps1                    # T7 reference: PowerPoint embeds Somar itself, then reopen without it
node poc/pptx/checkT.mjs                       # evaluates everything into out/t/check.json
```

Files: `tests.mjs` (one measured layout model, feeds both PPTX and HTML), `edge.mjs` (Edge headless: canvas measureText with Somar, DOM dump, screenshot), `eot.mjs` (fsType reader, EOT wrapper), `renderT.ps1`, `t7-office.ps1`, `otf2ttf.py`, `checkT.mjs`. `diff.mjs` gained `DIFF_A/DIFF_B/DIFF_OUT` env overrides.

Deck: `out/t/tests.pptx`, 13 slides: 1 T1, 2 to 4 T3, 5 to 11 T4, 12 T5, 13 T6.

### Important environment fact

Somar is installed per-user only, and PowerPoint on this machine does not see it, so a plain render uses a substitute font. That makes this machine the no-Somar test for T7. For the Somar-dependent checks (line breaks, G8), `renderT.ps1 -WithSomar` loads a copy of Somar for the logon session only (`AddFontResourceEx`, removed at the end, nothing installed, no registry write). Both sets of PNGs are kept: `tests-sNN.png` (substitute) and `somar-tests-sNN.png` (real Somar).

## T1 Direction

Every slide paragraph is forced to `rtl="1" algn="r"`, every table gets `a:tblPr rtl="1"` and keeps its columns in logical order (no manual mirroring). The slide shows 4 cases x 4 number fixes.

| Check | Result | Evidence |
|---|---|---|
| Every paragraph `rtl="1"` and `algn="r"` | **PASS** | 765 of 765 slide paragraphs; 0 paragraphs with `rtl="0"` (`layout.json` counts) |
| Table `a:tblPr rtl="1"` instead of mirrored columns | **PASS** | 44 of 44 tables. First logical column renders on the right: `zoom-t1-table-somar.png`, `somar-tests-s02.png` |
| No fix | FAIL for `85.5%` (shows `%85.5`) and the date (shows `05-11-2026`) | `zoom-t1-pct-date-somar.png`, right column |
| U+200E around the number | **PARTIAL**: fixes `85.5%`, `48,250`, the sentence; **fails the date** (`05-11-2026`) | `zoom-t1-pct-date-somar.png`, second column from right |
| U+2066/U+2069 isolates | **FAIL**: PowerPoint draws LRI and PDI as visible dashed boxes, and the date is still reversed | same PNG, third column |
| Separate LTR run (run gets `lang="en-US"` and `<a:rtl val="0"/>`, the paragraph stays `rtl="1"`) | **PASS** for all four cases | same PNG, left column; table in `zoom-t1-table-somar.png` |

What works: the separate LTR run. Every Latin or digit token (regex `[A-Za-z0-9][A-Za-z0-9.,%-/:+]*`) becomes its own run, 513 runs in the deck. This is a run-level property, so the paragraph-level rule "always `rtl="1"`" still holds. It also fixed `T1` in titles, which PowerPoint had drawn as `1T`. The final deck uses it everywhere (env `NUMFIX=run`, the default). The HTML does the same thing with `<span dir="ltr">`.

The sentence case shows that "no fix" in PowerPoint matches Chromium. Both put `%` on the left of `85.5` when the number follows Arabic letters. That is standard bidi behaviour (digits after Arabic letters become Arabic numbers, so `%` is not attached to them; measured in Edge, `out/t/bidi.html`). So the sentence needs the fix in both renderers to show `85.5%`. Compare `zoom-t1-sentences-somar.png` (PowerPoint) with `zoom-t1-sentences-html.png` (Edge).

Side fix found on the way: pptxgenjs writes one `a:pPr` per run for multi-run text (96 paragraphs had two or more). The schema allows one per paragraph, so post-processing keeps the first.

## T3 Long table (40 rows)

Rows per page come from the layout: (1000 - 180 - 60) / 50 = 15. That gives 3 slides of 15, 15 and 10 rows. Before rendering, every cell width was measured in Somar against its column: 0 cells too wide.

| Check | PPTX (Somar) | PPTX (substitute) | HTML (Edge) |
|---|---|---|---|
| Pages and rows | 15 / 15 / 10, total 40 | same | same |
| Continuation title | slides 3, 4: `تفاصيل المنافذ (يتبع)` | same | same |
| Header repeated | yes on all 3 (COM row 1 text = header) | yes | yes |
| Table inside slide | bottom 495 / 495 / 370 pt of 540 | same | 0 tables outside |
| Clipped or wrapped cells | 0 cells with more than 1 line (COM line count) | 0 | 0 of 215 cells overflow |
| **Result** | **PASS** | **PASS** | **PASS** |

PNGs: `somar-tests-s02.png` to `s04.png`, `html-02-T3-1.png` to `html-04-T3-3.png`. Looked at `somar-tests-s03.png` and `html-03-T3-2.png` side by side: same rows, same breaks, same column order.

## T4 Long titles (header-fit ladder)

40 headers: 22 real ones from `portReportHtml.ts` (relaxed-thompson worktree, read only) and 18 synthetic ones, including one deliberately impossible text. Each header sits in a 276px number column of a 6-column, 1720px table. The base size is 25px bold, and the step-2 floor is max(20, 0.85 x 25) = 21.25px. Step 3 takes width from the other number columns down to their own minimum, which is the widest of their header and data measured in Somar plus padding. Step 4 picks the space that minimises the longer line, then widens only as needed. Measurement: Edge canvas `measureText` with the Somar TTFs, times `FIT_SAFETY` = 1.04 (see below).

| Step | Count | Real | Synthetic |
|---|---|---|---|
| 1 One line at base size | 3 | 1 | 2 |
| 2 Shrink (sizes used: 21.5 to 24.5px) | 5 | 5 | 0 |
| 3 Widen the column | 22 | 11 | 11 |
| 4 Two balanced lines | 9 | 5 | 4 |
| 5 Error («العنوان أطول من المساحة») | 1 | 0 | 1 |

| Check | Result | Evidence |
|---|---|---|
| PowerPoint line count = engine decision, real Somar | **PASS** 40/40 | `check.json` `T4somar`; `somar-tests-s05.png` to `s11.png` |
| Same with the substitute font | **PASS** 40/40 | `check.json` `T4` |
| HTML: no cell overflows | **PASS** 0 clipped | `html-05` to `html-11-T4-*.png` |
| No ellipsis, no automatic abbreviation | **PASS** | full text is in every cell; step 5 shows a short error marker and the full message is in `layout.json` |

The 1.04 factor is an empirical result. At 1.00, PowerPoint with real Somar wrapped 8 of the 40 headers onto one more line than the engine predicted, because PowerPoint lays Somar out slightly wider than Chromium's canvas does. Headers were also first measured at weight 400 while both renderers draw them bold; that is fixed. At 1.04 all 40 match. Caveat: the factor was tuned on this set, so treat it as a starting margin and recheck it on T2's real report.

## T5 Diagram as grouped shapes

One model (`diagram` in `tests.mjs`) feeds both outputs. PPTX: a hand-written `p:grpSp` with 5 `roundRect` shapes and 4 `p:cxnSp` straight connectors with arrowheads, glued with `stCxn`/`endCxn` to connection sites 1 and 3. HTML: divs plus SVG lines from the same coordinates.

| Check (PowerPoint COM) | Result |
|---|---|
| One group, type msoGroup (6) | yes, 9 items |
| Shapes / connectors | 5 shapes with text, 4 connectors (`Connector = -1`), 4 of 4 `BeginConnected` |
| Edit text inside the group | set item 2 to `تعديل`, read back `تعديل` |
| Move the group | `Left` 190 to 200 pt |
| Labels fit (measured) | every label fits its box (`layout.json` `diagramFit`) |
| **Result** | **PASS** |

PNGs: `somar-tests-s12.png`, `html-12-T5.png`. The first render cut the long label in the middle box; the box was widened from 380 to 540px and a measured fit check was added. Remaining visual difference: arrowhead size (PowerPoint `med`, SVG marker) is close but not identical.

PDF was not generated in this spike. The diagram feeds HTML and PPTX only.

## T6 Freeform

| Check (PowerPoint COM) | Result |
|---|---|
| Shape type | 5 = msoFreeform (not a picture: 0 `p:pic`, 0 media files) |
| Nodes | 5, and `Nodes.Insert` took it to 6 |
| Text editable | set `نص جديد`, read back |
| **Result** | **PASS** |

PNGs: `somar-tests-s13.png`, `html-13-T6.png`. Found: pptxgenjs `addText` margin is in **points**, while table-cell margin is in **inches**. The first render ignored the intended inset and the label crossed the slanted edge.

## T7 Embedded font

Licence flag: OS/2 `fsType` = **0x0008** in Somar Regular and Bold, "editable embedding" (embedding allowed, and the document may be edited). Also found: both Somar `.ttf` files are actually **CFF-outline OpenType** (`OTTO`). PowerPoint embeds only TrueType outlines, so `otf2ttf.py` (fontTools 4.65) makes a glyf copy for the test. That copy is a modified font file. Whether the licence permits converting and redistributing it is open, and it is not committed.

| Variant (all open via COM, no error) | Rendered without Somar visible | Result |
|---|---|---|
| Raw CFF TTF as `fntdata` | substitute font, embedding ignored | FAIL |
| Raw glyf TTF as `fntdata` | substitute font, embedding ignored | FAIL |
| EOT-wrapped CFF (`eot.mjs`) | Arabic drawn as mojibake (box-drawing glyphs), Latin in an Arial-like face | FAIL |
| EOT-wrapped glyf | same mojibake | FAIL |
| **PowerPoint's own embedding** (font session-loaded, `SaveAs(..., EmbedTrueTypeFonts)`, then removed and reopened in a fresh PowerPoint) | **same mojibake** | FAIL |

PNGs: `tests-embed-glyf-eot-s01.png`, `tests-embed-glyf-ttf-s01.png`, `office-glyf-reopened-s01.png` (PowerPoint's own embed, reopened), `office-glyf-loaded-s01.png` (real Somar while loaded).

**Result: FAIL.** On this machine an embedded Somar does not render correctly once Somar is not visible to PowerPoint, even when PowerPoint did the embedding itself. PowerPoint's own file is EOT version 0x00020002 with flags 0x5 (subset + MTX compression) and `charset="-78"`. Because it fails the same way as the hand-built EOT, the EOT writer is not the cause. Not tested: a second clean machine, a known-good embeddable Arabic TrueType font as a control, and the case where the font is installed machine-wide. Practical route for G8 today: install Somar machine-wide on the PCs that open the decks. `somar-tests-*.png` shows that PowerPoint renders real Somar as soon as it can see the font.

## G1 to G10 for the final slides (`tests.pptx`)

| | Criterion | Score | Evidence |
|---|---|---|---|
| G1 | Opens without repair | **PASS (automated)** | COM `Open` succeeds for all 13 slides; the earlier corrupt variant (duplicate `saveSubsetFonts`) did throw, so the check is sensitive. A manual open has not been done |
| G2 | No pictures | **PASS** | 0 `p:pic`, 0 files in `ppt/media/` |
| G3 | Text boxes, real tables, native shapes | **PASS** | 44 real tables, text boxes, a grouped diagram with connectors, a freeform. These slides have no charts (chart editability was shown in `RESULTS.md`) |
| G4 | Every paragraph RTL and right-aligned | **PASS** | 765/765, 44/44 `tblPr rtl="1"`. Note: the pptxgenjs master and layout default styles (`lvlNpPr`) still say `rtl="0" algn="l"`. They are not paragraphs, but the engine should rewrite them too |
| G5 | Latin digits, correct order | **PASS** with separate LTR runs | `zoom-t1-pct-date-somar.png`, `zoom-t1-table-somar.png`, `somar-tests-s03.png` |
| G6 | Nothing clipped or outside the slide | **PASS** | T3 0 multi-line cells; T4 40/40 line counts match; HTML 0 overflows; diagram and freeform labels measured to fit |
| G7 | Positions match HTML | **PARTIAL** | Same boxes, same line breaks, same pagination. Pixel diff (threshold 32): 2.6 to 6.0 % of slide pixels on text slides, 0.92 % T5, 0.24 % T6. Glyph edges are offset by a few px and rules and boxes coincide (`diff-s03.png`) |
| G8 | Somar actually used in PowerPoint | **FAIL here / PASS when visible** | Plain render uses a substitute (`tests-s01.png`); with Somar visible it is Somar (`somar-tests-s01.png`); embedding does not solve it (T7) |
| G9 | Every number traceable to source Excel | **N/A** | Fixtures are synthetic in this spike; belongs to T2 |
| G10 | No long dash, no emoji | **PASS** for deck text (0) and every file written here | Pre-existing `model.mjs`, `toHtml.mjs`, `toPptx.mjs`, `RESULTS.md` still contain long dashes. They were not touched |

## Open items

1. T7: try a control embeddable Arabic TrueType font, then a second machine without Somar. If both fail the same way, embedding is not a viable route for Somar and machine-wide install is the answer.
2. Recheck `FIT_SAFETY` against T2's real port report and PowerPoint with Somar installed machine-wide.
3. Rewrite master and layout `lvlNpPr` defaults to `rtl="1" algn="r"`.
4. Manual open in PowerPoint once (G1) and a hand edit of a table and a diagram box.
