import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

// Raw budget raised 3.60 -> 3.75 MB on 2026-08-18 for the two design-handoff
// redesigns landing together (the Population wizard rework + the KPI dashboard
// rework, the latter a wholly new dashboard with hand-rolled inline-SVG charts).
// Dead CSS the redesigns orphaned was deleted first -- ~17 kB across
// Population.css and Reports.css -- so this covers real new feature code, not
// drift. The GZIP budget is deliberately unchanged and still has ~100 kB of
// headroom: gzip is what actually governs transfer, and holding that line is
// what keeps this a budget rather than a rubber stamp.
// Raw budget raised 3.75 -> 3.80 MB on 2026-08-20 for the v105.0 القسم 3
// analytics rework: three wholly new executive-deck pages (daily accuracy
// trend, outcome matrix, risk-engine agreement), each owning its own scoped
// CSS, plus a new inline-SVG `timeSeriesBand` chart primitive. Same rationale
// as the 2026-08-18 raise -- real new feature code, not drift. The overage
// without this raise was ~11 kB (0.3%). GZIP is again deliberately unchanged
// and still holds ~67 kB of headroom; gzip governs actual transfer, and
// holding that line is what keeps this a budget rather than a rubber stamp.
// Raw budget raised 3.80 -> 3.90 MB on 2026-08-21 for the v106 ad-hoc import
// rework: a three-step wizard replacing a single-shot upload button, a
// CertScan-style mapping workbench (field rail + clickable data grid + value
// mapping panel), an assignment panel covering four distribution modes with a
// live plan preview, ~500 lines of scoped CSS, and ~130 new label keys. Same
// rationale as the two raises above -- real new feature code, not drift. The
// overage without this raise was ~49 kB (1.3%). GZIP is again deliberately
// unchanged and still holds ~46 kB of headroom; gzip governs actual transfer,
// and holding that line is what keeps this a budget rather than a rubber stamp.
//
// CORRECTION, 2026-08-22 -- do not go looking for the reserve described here
// before: a previous note claimed `adhocImportMapping.ts` and
// `adhocImportAssignment.ts` were "real headroom available without cutting
// features". They are not. Both are orphaned from the UI, but they are orphaned
// from the PRODUCTION MODULE GRAPH too: nothing reachable from `src/main.tsx`
// imports either, so Rollup already tree-shakes them and they contribute zero
// bytes to `dist/index.html`. Measured directly -- deleting both modules and
// rebuilding produced a BYTE-IDENTICAL bundle (3805.8 kB / 1238.7 kB gzip).
// `adhocImportMapping.ts` has since been deleted anyway, as dead-code hygiene,
// and the budget did not move.
//
// The general lesson, since this will come up again: "orphaned from the UI" is
// not the same test as "in the bundle". Only a module the entry graph actually
// reaches costs bytes, and test files are not part of that graph -- a module
// whose only remaining importers are `*.test.ts` is already free. Before
// banking any deletion as headroom, measure it: build, delete, rebuild, diff
// the two `dist/index.html` sizes. Real headroom comes from code the shipped
// app genuinely loads.
// Raw budget raised 3.90 -> 3.95 MB on 2026-08-22 for the action-log expansion:
// 29 new action types wired to real call sites across ten screens (including
// four that were DECLARED but never fired -- `backup-restored` among them, so
// the most destructive operation in the app left no trace in the log meant to
// record it), a grouped filter bar over the log viewer, and 52 new label keys.
// Overage without this raise was ~17 kB (0.5%). GZIP is again deliberately
// unchanged and still holds ~25 kB.
//
// Read the correction above before treating any raise as routine. There is no
// cheap reserve left: the bundle was measured at 3805.8 kB with 348 kB of that
// being base64 fonts (IBM Plex Sans Arabic 400/700 + Somar Sans in four
// weights). Both families are needed by the live UI AND by generated reports,
// which are standalone files with no network, and Somar was ALREADY
// deduplicated in an earlier pass -- the app and the report builders used to
// embed separate ~240 kB copies. `vite-plugin-singlefile` inlines everything by
// design, so code-splitting and lazy-loading are not available escape routes.
//
// The one genuine optimisation left is subsetting the Arabic fonts to the
// glyphs actually used, which could plausibly reclaim 100 kB+. That is its own
// piece of work with its own risk (a missing glyph renders as a box in a report
// nobody re-checks), not something to bolt onto a feature change. Until it is
// done, expect the next sizeable feature to need another raise -- and say so
// out loud rather than quietly bumping the number.
const MAX_BYTES = 3_950_000;
const MAX_GZIP_BYTES = 1_300_000;
const bundlePath = new URL("../dist/index.html", import.meta.url);

const bundle = await readFile(bundlePath);
const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;

const formatKb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;
console.log(`Bundle: ${formatKb(bundle.byteLength)} (${formatKb(gzipBytes)} gzip)`);

if (bundle.byteLength > MAX_BYTES || gzipBytes > MAX_GZIP_BYTES) {
  console.error(
    `Bundle budget exceeded. Limits: ${formatKb(MAX_BYTES)} (${formatKb(MAX_GZIP_BYTES)} gzip).`,
  );
  process.exitCode = 1;
}
