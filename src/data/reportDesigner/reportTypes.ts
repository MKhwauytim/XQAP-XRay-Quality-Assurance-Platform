export const REPORT_SCHEMA_VERSION = 1;

export type DocType = "print" | "slides" | "dashboard";
export type PageSizePreset = "A4" | "Letter" | "16:9" | "4:3" | "16:9-fhd" | "custom";
export type Orientation = "portrait" | "landscape";

export type Aggregation =
  | "count" | "distinctCount" | "sum" | "avg" | "min" | "max" | "percentOfTotal";

export type FilterOp =
  | "equals" | "in" | "notEquals" | "between" | "contains" | "truthy" | "falsy" | "topN";

export type Filter = { field: string; op: FilterOp; value: unknown };

export type PageSetup = {
  size: PageSizePreset;
  orientation: Orientation;
  width: number;   // document units, px @96dpi
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
};

export type ElementType = "table" | "chart" | "kpi" | "text" | "shape" | "image";

export type ElementStyle = {
  fill?: string; borderColor?: string; borderWidth?: number; borderRadius?: number;
  padding?: number; fontFamily?: string; fontSize?: number; fontWeight?: number;
  color?: string; textAlign?: "right" | "center" | "left"; opacity?: number;
};

export type TableConfig = {
  kind: "table";
  dataSourceId: string;
  columns: Array<{ field: string; agg?: Aggregation; sort?: "asc" | "desc"; format?: string; condFormat?: unknown }>;
  groupBy: string[];
  filters: Filter[];
};
export type ChartConfig = {
  kind: "chart";
  chartType: "bar" | "line" | "pie" | "donut" | "area" | "combo" | "scatter";
  dataSourceId: string;
  wells: { axis: string[]; legend?: string; values: Array<{ field: string; agg: Aggregation }> };
  filters: Filter[];
  options: Record<string, unknown>;
};
export type KpiConfig = {
  kind: "kpi";
  dataSourceId: string;
  valueField: string;
  agg: Aggregation;
  target?: number;
  comparison?: "higherBetter" | "lowerBetter";
  format?: string;
};
export type TextConfig = { kind: "text"; text: string };
export type ShapeConfig = { kind: "shape"; shape: "rect" | "line" | "ellipse" | "divider" };
export type ImageConfig = { kind: "image"; dataUrl: string; alt?: string };

export type ElementConfig =
  | TableConfig | ChartConfig | KpiConfig | TextConfig | ShapeConfig | ImageConfig;

export type Element = {
  elementId: string;
  type: ElementType;
  name: string;
  x: number; y: number; w: number; h: number; z: number;
  rotation?: number; locked?: boolean;
  style: ElementStyle;
  config: ElementConfig;
};

export type Page = {
  pageId: string;
  name: string;
  order: number;
  background?: { color?: string; image?: string };
  filters: Filter[];
  elements: Element[];
};

export type DataSourceRef = { id: string; tableId: string; label: string };

export type ReportDocument = {
  reportId: string;
  reportName: string;
  version: number;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  docType: DocType;
  pageSetup: PageSetup;
  theme: { palette: string[]; fontFamily: string; defaults: Record<string, unknown> };
  dataSources: DataSourceRef[];
  pages: Page[];
  reportFilters: Filter[];
};

// A4 portrait at 96dpi = 794 x 1123 px.
export const A4_PORTRAIT: PageSetup = {
  size: "A4", orientation: "portrait", width: 794, height: 1123,
  margins: { top: 38, right: 38, bottom: 38, left: 38 },
};

export const SLIDE_16_9: PageSetup = {
  size: "16:9",
  orientation: "landscape",
  width: 1280,
  height: 720,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_4_3: PageSetup = {
  size: "4:3",
  orientation: "landscape",
  width: 960,
  height: 720,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_FHD: PageSetup = {
  size: "16:9-fhd",
  orientation: "landscape",
  width: 1920,
  height: 1080,
  margins: { top: 20, right: 20, bottom: 20, left: 20 },
};

export const SLIDE_PRESETS: Record<PageSizePreset, PageSetup> = {
  "A4": A4_PORTRAIT,
  "Letter": { size: "Letter", orientation: "portrait", width: 816, height: 1056, margins: { top: 38, right: 38, bottom: 38, left: 38 } },
  "16:9": SLIDE_16_9,
  "4:3": SLIDE_4_3,
  "16:9-fhd": SLIDE_FHD,
  "custom": A4_PORTRAIT,
};

export function getPageSetup(preset: PageSizePreset): PageSetup {
  return SLIDE_PRESETS[preset] ?? A4_PORTRAIT;
}

export function createReportId(): string {
  return `rpt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function createPageId(): string {
  return `pg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function createElementId(): string {
  return `el-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyDocument(name: string, createdBy: string, preset: PageSizePreset = "A4"): ReportDocument {
  const now = new Date().toISOString();
  const pageSetup = getPageSetup(preset);
  return {
    reportId: createReportId(),
    reportName: name,
    version: 1,
    createdAt: now, createdBy, updatedAt: now, updatedBy: createdBy,
    docType: "print",
    pageSetup: { ...pageSetup, margins: { ...pageSetup.margins } },
    theme: { palette: ["#1f6feb", "#2da44e", "#bf8700", "#cf222e", "#8250df"], fontFamily: "inherit", defaults: {} },
    dataSources: [],
    pages: [{ pageId: createPageId(), name: "صفحة 1", order: 0, filters: [], elements: [] }],
    reportFilters: [],
  };
}
