# Visual/design library research — 2026-07-14

Scope: libraries/techniques to enhance report visuals (self-contained HTML strings,
opened offline, no network) and/or the live app UI, for `x-ray-quality-app-v1`
(Arabic RTL, ZATCA context, single-file `dist/index.html` currently **3.10 MB**
raw / ~1.1 MB gzip). Constraints: client-side only, no network at report-open time,
RTL/Arabic-safe, bundle-size-conscious. Sizes below are min+gzip from Bundlephobia's
API (`bundlephobia.com/api/size?package=<name>`) unless noted; font sizes are actual
`.woff2` file sizes from the published npm package (via unpkg/jsDelivr file listing).

## Comparison table

| Library | Gives us | Min / gzip | SVG-string capable? | RTL/Arabic | License | Verdict |
|---|---|---|---|---|---|---|
| **Apache ECharts** (`echarts`) | Full chart engine, `renderer:'svg'` + `renderToSVGString()` | 1.11 MB / 368 KB gzip (full); can shrink via `echarts/core` + per-chart-type imports but still tens of KB per chart type | Yes — SVG renderer emits real SVG, extractable as a string | No built-in bidi/RTL layout; Arabic glyphs render fine as `<text>` (browser shapes them) but axis/legend mirroring is manual | Apache-2.0 | **SKIP** — even a slimmed single-chart-type import costs more than our entire existing `charts.ts` (≈nothing); not worth it unless we need chart types we can't hand-roll (e.g. true force-directed graphs) |
| **Observable Plot** (`@observablehq/plot`) | Grammar-of-graphics API, returns a real `SVGElement`/`HTMLElement` (`.outerHTML` gives a string) | 384 KB / 128 KB gzip (bundles D3 internally) | Yes, natively | Same as D3 — glyphs shape fine, layout/orientation is manual | ISC | **SKIP** — 128 KB gzip to replace a few hundred lines of hand-rolled path math we already have and already control pixel-for-pixel (RTL legend order, escText, empty-state discipline) |
| **D3 (full bundle)** (`d3`) | Everything (scales, shapes, layout, selection, DOM) | 279 KB / 92 KB gzip | Yes (headless-usable) | Manual | ISC | **SKIP** — only 2 of ~30 submodules are relevant to us |
| **D3 submodules** — `d3-shape` + `d3-scale` only | Arc/pie/line/curve path generators + scale math, usable headlessly (no DOM) to emit `d="…"` path strings | `d3-shape` 32.8 KB/5.7 KB gzip + `d3-scale` 47.3 KB/16 KB gzip ≈ **80 KB / 21.7 KB gzip combined** | Yes — this is exactly "headless layout → string", matching our existing pattern | N/A — pure math, no text | ISC | **TRIAL** — the one real upgrade path for `charts.ts`: smooth (curveBasis/curveMonotoneX) trend lines, true donut/pie arcs, and stacked-area math, at ~22 KB gzip, without adopting a renderer or losing our escText/RTL/empty-state discipline (we'd only ever import the path-string output) |
| **Chart.js** (`chart.js`) | Canvas-rendered charts, export via `canvas.toDataURL()` → base64 PNG | 201 KB / 68 KB gzip | No — canvas raster only, not SVG | Canvas 2D text shaping mostly works (browser-shaped glyphs) but layout (axis mirroring, RTL tick order) is manual, and rasterized PNG loses crispness/print quality vs. our current vector output | MIT | **SKIP** — regresses from vector SVG to raster PNG for no visual gain over what we already ship |
| **Vega-Lite** | Declarative grammar, heavier Vega runtime underneath | Several hundred KB gzip (Vega + Vega-Lite combined, larger than Plot) | Yes but heavyweight | Manual | BSD-3 | **SKIP** — strictly heavier than Plot for the same headless-string use case |
| **Vercel Satori** (`satori`) | JSX/HTML+CSS → SVG, custom font embedding, used for OG-image-style stat cards | 494 KB / 167 KB gzip (bundles `yoga-layout` WASM) | Yes, that's its whole purpose | **Confirmed blocker**: Satori's own README states "RTL languages are not supported" (bidi/Arabic layout unsupported as of the checked docs; an RTL PR was only opened April 2026 and not shipped) | MPL-2.0 | **SKIP for Arabic content** — would only be safe for LTR-only decorative elements (e.g. a numeral-only KPI badge), which doesn't justify 167 KB gzip |
| **resvg-wasm** (`@resvg/resvg-wasm`) | Rasterize SVG → PNG in-browser via Rust/WASM | ~2.5 MB **install size** (the `.wasm` binary itself) | N/A (consumes SVG, emits PNG) | N/A | MPL-2.0 | **SKIP** — the WASM binary alone is comparable to our entire current bundle; no use case here needs raster output badly enough to justify it |
| **Trianglify** (`trianglify`) | Deterministic, seeded low-poly triangle-mesh art → SVG or canvas | 56.3 KB / 20.7 KB gzip | Yes, SVG output natively, `x_colors`/`seed` params make it fully reproducible per report | N/A (no text) | MIT | **TRIAL** — good fit for a cover/section-divider background, seeded by report id or month key so the same report always regenerates the same art |
| **geopattern** (`geopattern`) | Deterministic seeded SVG geometric patterns (hashes a string, e.g. an id, into a pattern) | 18.7 KB / 5.3 KB gzip | Yes, native SVG string output (`.toSvg()`) | N/A (no text) | MIT | **TRIAL** — cheapest deterministic generative-art option; good for section dividers, employee-avatar-style identicons, or per-port visual identity strips |
| **hero-patterns** (heropatterns.com, no npm package — copy raw SVG) | ~100 hand-designed repeatable SVG background patterns, pick a couple, paste as string constants | A few hundred bytes–few KB **per pattern**, zero dependency/build cost | Yes — literally raw SVG/CSS `background-image` | N/A (no text) | Patterns are free to use (site says "always free"); no explicit OSS license text found — treat as "free to use, not redistribute as a branded product" | **ADOPT** — not an npm install at all, just copy 1–2 pattern SVGs into `ui/` as string constants for section-divider textures; zero recurring cost |
| **@fontsource/ibm-plex-sans-arabic** | Self-hosted Arabic-shaped-correct webfont, Argon-grade professional look for headings | Arabic-subset `.woff2`: **400 weight ≈ 42.8 KB, 700 weight ≈ 44.3 KB** (≈87 KB raw for 2 weights, ≈+33% ≈ **116 KB** once base64-inlined into a report or the app bundle) | N/A (it's a font, not an image) | Yes — this is the whole point, purpose-built Arabic shaping | SIL OFL-1.1 | **TRIAL, app-bundle only** — embed once in `dist/index.html` (fixed one-time cost ~116 KB for 2 weights), not per generated report (which would multiply the cost every report). Current system-Arabic-font fallback is probably fine for reports; reserve custom fonts for the app UI where the cost is paid once |
| **@fontsource/cairo** / **@fontsource/tajawal** / **Noto Kufi Arabic** | Same idea, different Arabic typeface personalities (Cairo = modern geometric, Tajawal = warm humanist, Noto Kufi = kufic/formal) | Same order of magnitude per weight (~35–50 KB arabic-subset woff2); exact bytes vary slightly per family, not independently reverified here | N/A | Yes | SIL OFL-1.1 (all three) | **TRIAL** — same verdict/caveat as IBM Plex Sans Arabic; pick ONE family only, don't ship multiple |
| **@phosphor-icons/core** | ~1,500+ SVG icon strings, tree-shakeable per-icon import | Full core package 323 KB / 47.5 KB gzip, but real per-icon cost is ~0.3–0.6 KB each if importing individual icon modules (not the whole barrel) | Yes, raw SVG strings | N/A (glyphs, no text direction issue — icons are direction-agnostic except a few directional arrows, which need manual RTL mirroring either way) | MIT | **SKIP** — our existing hand-rolled `src/data/reporting/executive/ui/icons.ts` (16 icons, ~3 KB total, stroke-based, `currentColor`-themed, already RTL/arrow-aware) already covers report needs at near-zero cost and matches the house style exactly. Only reconsider if the Document edition needs many *more* distinct icon concepts than the current 16 — then import individual phosphor SVGs (not the whole package) as new string constants, same pattern as today |
| **Tabler Icons** | Similar tree-shakeable SVG icon set | Comparable per-icon cost to Phosphor | Yes | Same as above | MIT | **SKIP** — same reasoning as Phosphor; no reason to add a second icon source |
| **Mermaid** (`mermaid`) | Text-to-diagram (flowcharts, sequence, etc.) | Main chunk alone 656 KB / 157 KB gzip, and it lazy-loads additional chunks per diagram type — realistic total well over 1 MB gzip if more than one diagram type is used | Yes, SVG output | Weak — Mermaid's own RTL support is minimal/inconsistent across diagram types, would need manual overrides anyway | MIT | **SKIP, hard** — 150 KB+ gzip (routinely much more) for something a ~100-line hand-rolled funnel/flow SVG builder (same pattern as `charts.ts`) does more cheaply and with full RTL control we already have to build ourselves regardless |
| **qrcode** (`qrcode`) | Generate QR codes client-side, `toString(data, {type:'svg'})` gives a raw SVG string synchronously, no canvas/DOM needed | 23.5 KB / 8.75 KB gzip | Yes, direct SVG string mode | N/A (QR modules, no text) | MIT | **ADOPT** — cheapest, most concretely useful item on this list: a provenance QR (report id + revision hash + generation timestamp) on report covers, fully offline, ~9 KB gzip fixed cost regardless of how many reports use it |
| **html-to-image** (`html-to-image`) | DOM node → PNG/SVG via a `<foreignObject>`-wrapped SVG data URI → `<img>`/canvas | 13.2 KB / 5.2 KB gzip | Produces a data-URI PNG typically (SVG-wrapping is an intermediate step, not the final artifact) | Because it uses `foreignObject`, the *browser's own* text/bidi engine renders the cloned DOM (unlike `html2canvas`, which manually reimplements CSS painting and has documented, unresolved RTL/Arabic bugs — see `niklasvh/html2canvas#686` and `#2488`) — so `html-to-image` is the safer of the two for Arabic content, though still worth a manual visual check per report template | MIT | **TRIAL, narrow** — only for snapshotting the *live* KPI dashboard (`ReviewerKpiPanel.tsx`'s recharts SVG, which is already real DOM) into a static image embedded in an exported report, not for our already-string-based chart builders which don't need this step at all |
| **dom-to-image-more** | Fork of the older `dom-to-image`, similar approach | Comparable size class to html-to-image, less actively maintained | Similar caveats | Same foreignObject caveat as above but the original `tsayen/dom-to-image` project is far less actively maintained | MIT | **SKIP** — `html-to-image` is the maintained fork of the same lineage; no reason to pick the less-maintained one |
| **css-doodle** | Web Component for CSS-grid generative art | Not sized (out of scope — Web Component pattern doesn't fit "generate a string to inline in a report") | No — needs a live custom element + runtime, not a static SVG string | N/A | MIT | **SKIP** — architecturally wrong shape for "static HTML string report"; would require shipping its runtime JS into every report |
| **mesh-gradient generators** (various small npm packages) | CSS mesh-gradient backgrounds | Typically tiny (a few KB) but mostly generate a static CSS string you could hand-write anyway | Partial (CSS, not SVG) | N/A | Varies | **SKIP** — a mesh-gradient background is just a few `radial-gradient()` CSS strings; not worth a dependency, hand-write 3–4 gradient stops directly in `theme.ts`/`tokens.ts` |

## Top-5 concrete recommendations (ranked by visual impact per KB)

1. **`qrcode` (SVG mode) — provenance QR on report covers.** ~9 KB gzip, one-time
   dependency. Integration: in the cover/title builder (e.g. wherever
   `deck2` or the sample/distribution report writes its cover markup), call
   `QRCode.toString(reportId + "|" + revisionHash, { type: "svg" })` and splice
   the returned `<svg>...</svg>` string directly into the cover markup next to
   the existing title block — no canvas, no async wait needed if using the
   sync string API.

2. **`geopattern` — deterministic section-divider identity strips.** ~5.3 KB
   gzip. Integration: in `src/data/reporting/executive/ui/` add a thin wrapper
   that calls `GeoPattern.generate(portName or month key).toSvg()` and use the
   output as a section-divider background behind port/month headers — same
   report always renders the same pattern (deterministic on the seed string),
   satisfying the "no randomness between opens" requirement implicitly.

3. **`d3-shape` + `d3-scale` (headless, path-string only) — smoother
   trend/donut math in `charts.ts`.** ~21.7 KB gzip combined. Integration:
   import only `arc`, `pie`, and a `curveMonotoneX`-based line generator from
   `d3-shape`/`d3-scale` inside `charts.ts`, keep every existing wrapper
   function signature (`escText`, `emptyState`, RTL legend order) unchanged —
   d3-shape only replaces the raw path-`d` string math, nothing structural.

4. **`trianglify` — seeded cover art for the Document/Executive edition.**
   ~20.7 KB gzip. Integration: in the deck/document cover builder, seed
   `trianglify({ width, height, seed: monthKey + reportRevision })` and inline
   its SVG output as a full-bleed cover background layer, behind the existing
   title/KPI text — visually "designed" without hiring a designer, fully
   reproducible.

5. **`hero-patterns` (hand-copied, not an npm dependency) — lightweight
   texture accents.** Near-zero cost (a few hundred bytes to a few KB per
   pattern, pasted as string constants). Integration: pick 1–2 subtle patterns
   (e.g. a topographic or grid-dot pattern) and store them as raw SVG string
   constants in `ui/patterns.ts`, used as low-opacity `background-image`
   texture on card headers — cheaper than any of the above because there's no
   dependency at all, just copied markup.

**Not in the top 5 but worth a follow-up decision:** `@fontsource/ibm-plex-sans-arabic`
(or Cairo/Tajawal) for the *app UI* only (not per-report), ~116 KB one-time if
2 weights are embedded in `dist/index.html`. This is a real typography upgrade
but is a bigger, more deliberate call (bundle already at 3.1 MB, this is the
single largest item on this list) — recommend treating it as a separate
decision from the report-visuals work above, gated on an explicit "do we want
custom Arabic type in the shipped app" conversation rather than bundling it
into this pass.

## Explicit SKIP list (with reasons)

- **Apache ECharts, Observable Plot, D3 (full), Chart.js, Vega-Lite** — all
  strictly heavier (68 KB–368 KB gzip) than what our existing bespoke
  `charts.ts` already does at ~0 KB dependency cost, for equal or worse RTL
  control. (Chart.js is additionally raster-only, a regression from our
  current vector SVG.)
- **Vercel Satori** — README-confirmed no RTL/bidi support; the one thing our
  app needs (Arabic text layout) is the one thing it doesn't do. An RTL PR
  exists (opened April 2026) but is unshipped.
- **resvg-wasm** — 2.5 MB WASM install size alone, larger than sensible for a
  single-file app that's already budget-conscious at 3.1 MB total.
- **Mermaid** — 157 KB+ gzip for the main chunk alone (more with additional
  diagram types loaded), for a job (simple flow/funnel diagrams) our own
  ~100-line SVG builder already handles more cheaply with full RTL control.
- **css-doodle** — needs a live Web Component runtime; architecturally
  incompatible with "generate one static self-contained HTML string."
- **dom-to-image-more** — redundant with `html-to-image` (same lineage,
  less maintained fork).
- **@phosphor-icons/core / Tabler Icons (as bulk imports)** — our existing
  16-icon hand-rolled set already matches the house visual style at near-zero
  cost; only individual icons should ever be pulled in, never the package.
- **Anything requiring network fetch at report-open time** (CDN-hosted fonts,
  remote icon APIs, hosted QR/pattern generators) — categorically excluded
  per the "opened offline" constraint; every recommendation above is either a
  bundled dependency or a hand-copied static asset.

## Bundle-budget note

Current single-file build: **3.10 MB raw / ~1.1 MB gzip** (`dist/index.html`,
2026-07-14 measurement).

The 5 recommended additions, if all adopted:

| Item | Gzip cost |
|---|---|
| `qrcode` | ~8.75 KB |
| `geopattern` | ~5.3 KB |
| `d3-shape` + `d3-scale` | ~21.7 KB |
| `trianglify` | ~20.7 KB |
| `hero-patterns` (copied, not a dependency) | ~0 KB (a few KB of static string data, not a build dependency) |
| **Total** | **≈ 56.5 KB gzip** (< 0.1 MB) |

That is roughly a 5% addition to the current ~1.1 MB gzip bundle — small
relative to the visual upside (deterministic generative cover art, a
provenance QR, smoother chart curves) and small relative to the font decision
above, which alone (~116 KB for 2 Arabic weights) would cost about 2× as much
as all five combined. Recommend shipping the five TRIAL/ADOPT items together
first, measuring the actual `dist/index.html` delta, then deciding on the font
question separately.

## Sources

- https://apache.github.io/echarts-handbook/en/how-to/cross-platform/server/
- https://echarts.apache.org/handbook/en/basics/release-note/5-5-0/
- https://gist.github.com/pissang/4c32ee30e35c91336af72b129a1a4a73
- https://www.npmjs.com/package/@observablehq/plot
- https://github.com/observablehq/plot
- https://github.com/vercel/satori (README: RTL/bidi not supported)
- https://www.npmjs.com/package/@resvg/resvg-wasm
- https://www.npmjs.com/package/trianglify
- https://github.com/qrohlf/trianglify
- https://www.npmjs.com/package/geopattern
- https://heropatterns.com/
- https://github.com/lowmess/hero-patterns
- https://www.npmjs.com/package/@fontsource/ibm-plex-sans-arabic
- https://www.npmjs.com/package/@fontsource/cairo
- https://www.npmjs.com/package/html-to-image
- https://github.com/niklasvh/html2canvas/issues/686
- https://github.com/niklasvh/html2canvas/issues/2488
- https://github.com/tsayen/dom-to-image
- https://www.npmjs.com/package/@phosphor-icons/core
- https://www.npmjs.com/package/qrcode
- https://www.npmjs.com/package/mermaid
- https://bundlephobia.com (API size data for: echarts, @observablehq/plot,
  mermaid, qrcode, satori, chart.js, d3, d3-shape, d3-scale, trianglify,
  geopattern, html-to-image, @phosphor-icons/core)
- Repo files reviewed for baseline (read-only): `src/data/reporting/executive/ui/charts.ts`,
  `src/data/reporting/executive/ui/icons.ts`, `package.json`, `dist/index.html`
  (size measurement only, not modified)
