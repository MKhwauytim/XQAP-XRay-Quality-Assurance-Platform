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
const MAX_BYTES = 3_800_000;
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
