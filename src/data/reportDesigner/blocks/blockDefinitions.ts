import { getLabels } from "../../labels/labelsStore";
import { esc } from "../../reporting/executive/primitives";
import { barChart, groupedBarChart } from "../../reporting/executive/deck3/chartKit";
import { contentHead, dataTable, kpiBand, tintedPanel } from "../../reporting/executive/deck3/slideKit";
import type { BlockConfigMap, BlockType } from "../reportTypesV2";

const RULE_THICKNESS_PX = 2;

export type RenderCtx = { childHtml?: (ids: string[]) => string };

export type BlockDefinition<T extends BlockType> = {
  type: T;
  labelKey: string;
  defaultSize: { w: number; h: number };
  defaultConfig(): BlockConfigMap[T];
  bindingShape: "static"; // P2 adds "scalars" | "series" | "table"
  render(config: BlockConfigMap[T], ctx: RenderCtx): string;
};

export type BlockDefinitions = { [K in BlockType]: BlockDefinition<K> };

export const BLOCK_DEFINITIONS: BlockDefinitions = {
  kpiBand: {
    type: "kpiBand", labelKey: "rd_block_kpiBand", defaultSize: { w: 12, h: 12 }, bindingShape: "static",
    defaultConfig: () => ({ cells: [{ label: "مؤشر", value: "0", valueTone: "gold" }], variant: "solo" }),
    render: (c) => kpiBand(c.cells, c.variant, c.compact),
  },
  tintedPanel: {
    type: "tintedPanel", labelKey: "rd_block_tintedPanel", defaultSize: { w: 6, h: 24 }, bindingShape: "static",
    defaultConfig: () => ({ variant: "all", title: "", childIds: [] }),
    render: (c, ctx) => tintedPanel({ variant: c.variant, title: c.title, note: c.note, body: ctx.childHtml?.(c.childIds) ?? "" }),
  },
  dataTable: {
    type: "dataTable", labelKey: "rd_block_dataTable", defaultSize: { w: 12, h: 24 }, bindingShape: "static",
    defaultConfig: () => ({ headers: [], rows: [] }),
    render: (c) => dataTable({ headers: c.headers, rows: c.rows, totals: c.totals }),
  },
  barChart: {
    type: "barChart", labelKey: "rd_block_barChart", defaultSize: { w: 6, h: 24 }, bindingShape: "static",
    defaultConfig: () => ({ bars: [], min: 0, max: 100 }),
    render: (c) => barChart({ bars: c.bars, min: c.min, max: c.max }),
  },
  groupedBarChart: {
    type: "groupedBarChart", labelKey: "rd_block_groupedBarChart", defaultSize: { w: 6, h: 24 }, bindingShape: "static",
    defaultConfig: () => ({ groups: [], min: 0, max: 100 }),
    render: (c) => groupedBarChart(c),
  },
  sectionHeader: {
    type: "sectionHeader", labelKey: "rd_block_sectionHeader", defaultSize: { w: 12, h: 6 }, bindingShape: "static",
    defaultConfig: () => ({ eyebrow: "", title: "" }),
    render: (c) => contentHead({ eyebrow: c.eyebrow, title: c.title, note: c.note }),
  },
  divider: {
    type: "divider", labelKey: "rd_block_divider", defaultSize: { w: 12, h: 1 }, bindingShape: "static",
    defaultConfig: () => ({ tone: "navy" }),
    render: (c) => `<div class="v3-tone-${esc(c.tone)}" style="height:${RULE_THICKNESS_PX}px;width:100%"></div>`,
  },
  line: {
    type: "line", labelKey: "rd_block_line", defaultSize: { w: 12, h: 1 }, bindingShape: "static",
    defaultConfig: () => ({ tone: "navy", orientation: "h" }),
    render: (c) => `<div class="v3-tone-${esc(c.tone)}" style="${c.orientation === "h" ? `height:${RULE_THICKNESS_PX}px;width:100%` : `width:${RULE_THICKNESS_PX}px;height:100%`}"></div>`,
  },
  richText: {
    type: "richText", labelKey: "rd_block_richText", defaultSize: { w: 6, h: 6 }, bindingShape: "static",
    defaultConfig: () => ({ text: "" }),
    render: (c) => `<p class="v3-note">${esc(c.text)}</p>`,
  },
  image: {
    type: "image", labelKey: "rd_block_image", defaultSize: { w: 4, h: 12 }, bindingShape: "static",
    defaultConfig: () => ({ dataUrl: "" }),
    render: (c) => `<img src="${esc(c.dataUrl)}" alt="${esc(c.alt)}" style="max-width:100%;max-height:100%">`,
  },
  legacyChart: {
    type: "legacyChart", labelKey: "rd_block_legacyChart", defaultSize: { w: 6, h: 12 }, bindingShape: "static",
    defaultConfig: () => ({ original: { kind: "text", text: "" } }),
    render: () => `<div class="rd-element-placeholder" data-legacy="1">${esc(getLabels().rd_block_legacyChart)}</div>`,
  },
};
