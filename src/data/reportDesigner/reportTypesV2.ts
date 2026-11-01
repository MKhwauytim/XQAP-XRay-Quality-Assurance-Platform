import type { ChartBar, ChartTone, groupedBarChart } from "../reporting/executive/deck3/chartKit";
import type { KpiCell, TableCell } from "../reporting/executive/deck3/slideKit";
import { createEmptyDocument } from "./reportTypes";
import type { ElementConfig, Page, PageSizePreset, ReportDocument } from "./reportTypes";

export const REPORT_SCHEMA_VERSION_V2 = 2;

export type BlockType =
  | "kpiBand" | "tintedPanel" | "dataTable" | "barChart" | "groupedBarChart"
  | "sectionHeader" | "divider" | "line" | "richText" | "image" | "legacyChart";

export type BlockConfigMap = {
  kpiBand: { cells: KpiCell[]; variant: "top" | "bottom" | "solo"; compact?: boolean };
  tintedPanel: { variant: "land" | "sea" | "all"; title: string; note?: string; childIds: string[] };
  dataTable: { headers: string[]; rows: TableCell[][]; totals?: TableCell[] };
  barChart: { bars: ChartBar[]; min: number; max: number };
  groupedBarChart: Parameters<typeof groupedBarChart>[0];
  sectionHeader: { eyebrow: string; title: string; note?: string };
  divider: { tone: ChartTone };
  line: { tone: ChartTone; orientation: "h" | "v" };
  richText: { text: string };
  image: { dataUrl: string; alt?: string };
  legacyChart: { original: ElementConfig };
};

export type BlockElement<T extends BlockType = BlockType> = {
  elementId: string; type: T; name: string;
  x: number; y: number; w: number; h: number; z: number; locked?: boolean;
  config: BlockConfigMap[T];
};

export type DocLayout = { snap: boolean; columns: 12; gutter: number; rowUnit: number };

export type PageV2 = Omit<Page, "elements"> & { elements: BlockElement[] };

export type ReportDocumentV2 = Omit<ReportDocument, "pages" | "theme" | "schemaVersion"> & {
  schemaVersion: 2; layout: DocLayout; pages: PageV2[];
};

export const DEFAULT_LAYOUT: DocLayout = { snap: true, columns: 12, gutter: 16, rowUnit: 8 };

export function isV2(doc: unknown): doc is ReportDocumentV2 {
  return typeof doc === "object" && doc !== null
    && (doc as { schemaVersion?: unknown }).schemaVersion === REPORT_SCHEMA_VERSION_V2;
}

export function createEmptyDocumentV2(
  name: string, createdBy: string, preset: PageSizePreset = "16:9",
): ReportDocumentV2 {
  const v1: Partial<ReportDocument> = createEmptyDocument(name, createdBy, preset);
  const pages = v1.pages ?? [];
  delete v1.theme;
  delete v1.schemaVersion;
  delete v1.pages;
  return {
    ...(v1 as Omit<ReportDocument, "pages" | "theme" | "schemaVersion">),
    schemaVersion: 2,
    layout: { ...DEFAULT_LAYOUT },
    pages: pages.map((p) => ({ ...p, elements: [] })),
  };
}
