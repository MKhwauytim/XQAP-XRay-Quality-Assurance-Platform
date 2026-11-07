// Designs are JSON on a shared folder, so block configs are untrusted. Every
// enum goes through an allowlist and every number through Number.isFinite
// before reaching the deck3 kit. Free-text strings are escaped by the kit
// itself (kpiBand, tintedPanel, charts, contentHead, table headers); only
// table cell bodies are escaped here because the kit takes them as raw HTML.
import { esc } from "../../reporting/executive/primitives";
import type { ChartBar, ChartTone } from "../../reporting/executive/deck3/chartKit";
import type { KpiCell, TableCell } from "../../reporting/executive/deck3/slideKit";
import type { BlockConfigMap, TextCell } from "../reportTypesV2";

function pick<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return allowed.find((a) => a === v);
}
function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function optStr(v: unknown): string | undefined { return typeof v === "string" && v ? v : undefined; }
function num(v: unknown, fallback: number): number { return typeof v === "number" && Number.isFinite(v) ? v : fallback; }
function arr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }

const KPI_TONES = ["navy", "gold", "green", "red"] as const;
const CHART_TONES = ["gold", "blue", "green", "red", "navy"] as const;
const CELL_TONES = ["navy", "gold", "green", "red", "muted"] as const;
const PANEL_VARIANTS = ["land", "sea", "all"] as const;
const KPI_VARIANTS = ["top", "bottom", "solo"] as const;
const PLOT_TINTS = ["panel", "land", "sea"] as const;

export const chartTone = (v: unknown): ChartTone | undefined => pick(v, CHART_TONES);

function kpiCell(c: KpiCell): KpiCell {
  const out: KpiCell = { label: str(c?.label), value: str(c?.value), valueTone: pick(c?.valueTone, KPI_TONES), aside: optStr(c?.aside), sub: optStr(c?.sub) };
  const x = c?.extra;
  if (x) out.extra = { label: str(x.label), value: str(x.value), valueTone: pick(x.valueTone, KPI_TONES), aside: optStr(x.aside), sub: optStr(x.sub) };
  return out;
}

function bar(b: ChartBar): ChartBar {
  return { label: str(b?.label), sublabel: optStr(b?.sublabel), value: typeof b?.value === "number" && Number.isFinite(b.value) ? b.value : null, tone: chartTone(b?.tone) };
}

function cell(c: TextCell): TableCell {
  const tone = pick(c?.tone, CELL_TONES);
  return { html: esc(str(c?.text)), cls: tone ? `v-${tone}` : undefined };
}

export const sanitize = {
  kpiBand: (c: BlockConfigMap["kpiBand"]): BlockConfigMap["kpiBand"] => ({
    cells: arr<KpiCell>(c.cells).map(kpiCell), variant: pick(c.variant, KPI_VARIANTS) ?? "solo", compact: c.compact === true,
  }),
  tintedPanel: (c: BlockConfigMap["tintedPanel"]): BlockConfigMap["tintedPanel"] => ({
    variant: pick(c.variant, PANEL_VARIANTS) ?? "all", title: str(c.title), note: optStr(c.note),
    childIds: arr<unknown>(c.childIds).filter((i): i is string => typeof i === "string"),
  }),
  dataTable: (c: BlockConfigMap["dataTable"]) => ({
    headers: arr<unknown>(c.headers).map(str),
    rows: arr<TextCell[]>(c.rows).map((r) => arr<TextCell>(r).map(cell)),
    totals: c.totals ? arr<TextCell>(c.totals).map(cell) : undefined,
  }),
  barChart: (c: BlockConfigMap["barChart"]): BlockConfigMap["barChart"] => ({
    bars: arr<ChartBar>(c.bars).map(bar), min: num(c.min, 0), max: num(c.max, 100),
  }),
  groupedBarChart: (c: BlockConfigMap["groupedBarChart"]): BlockConfigMap["groupedBarChart"] => ({
    groups: arr<BlockConfigMap["groupedBarChart"]["groups"][number]>(c.groups).map((g) => ({
      label: str(g?.label), sublabel: optStr(g?.sublabel), a: bar(g?.a), b: bar(g?.b),
    })),
    min: num(c.min, 0), max: num(c.max, 100), tint: pick(c.tint, PLOT_TINTS),
    toneA: chartTone(c.toneA), toneB: chartTone(c.toneB),
  }),
  sectionHeader: (c: BlockConfigMap["sectionHeader"]): BlockConfigMap["sectionHeader"] => ({
    eyebrow: str(c.eyebrow), title: str(c.title), note: optStr(c.note),
  }),
  divider: (c: BlockConfigMap["divider"]): BlockConfigMap["divider"] => ({ tone: chartTone(c.tone) ?? "navy" }),
  line: (c: BlockConfigMap["line"]): BlockConfigMap["line"] => ({
    tone: chartTone(c.tone) ?? "navy", orientation: pick(c.orientation, ["h", "v"] as const) ?? "h",
  }),
};
