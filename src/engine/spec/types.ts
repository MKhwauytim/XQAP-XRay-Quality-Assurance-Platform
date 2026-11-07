import type { ColumnType, DatasetDef, FilterSpec } from "../data/types";
import type { MessageKey } from "../messages";

export type Tone = "primary" | "neutral" | "good" | "bad";

export interface ThemeTokens {
  tones: Record<Tone, string>;
  ink: Record<"navy" | "text" | "muted" | "hair" | "bg" | "panel" | "gold", string>;
  font: string;
  fontData?: Uint8Array;
}

export interface MeasureSpec {
  id: string;
  label: string;
  datasetId: string;
  formula: string;
  format: { kind: "int" | "pct" | "dec"; digits: number };
}

export interface DomainPack {
  packId: string;
  schemaVersion: 1;
  fields: { id: string; label: string; type: ColumnType; role: "dimension" | "measure"; aliases?: string[] }[];
  measures: MeasureSpec[];
}

export type WellRole = "axis" | "legend" | "values" | "rows" | "columns";
export type WellItem = { field: string } | { measure: string };
export type Wells = Partial<Record<WellRole, WellItem[]>>;
export type VisualType = "text" | "kpiBand" | "table" | "barChart";

export interface VisualSpec {
  visualId: string;
  type: VisualType;
  frame: { col: number; row: number; w: number; h: number; z: number };
  wells: Wells;
  filters?: FilterSpec[];
  sort?: { by: string; dir: "asc" | "desc" };
  limit?: { topN: number; others: boolean };
  format?: { tone: Tone; sizePx?: number; weight?: 400 | 700 };
  /** Only for `type: "text"`; may hold `{{measure:<id>}}` and `{{param:<id>}}`. */
  text?: string;
  /** Only for `type: "text"`: a page note (a source line), repeated on every continuation slide of the page. */
  pageNote?: true;
}

export interface PageSpec {
  pageId: string;
  title: string;
  size: "16:9";
  grid: { cols: 24; rows: 14 };
  /** `false` draws no title row (a section divider whose own heading is the title); the title still names the slide. */
  titleRow?: false;
  filters?: FilterSpec[];
  visuals: VisualSpec[];
}

export interface ReportSpec {
  schemaVersion: 1;
  reportId: string;
  title: string;
  theme: "deck3";
  datasets: DatasetDef[];
  model: { packId?: string; measures: MeasureSpec[] };
  params: { id: string; type: "text" | "month" | "number"; required: boolean }[];
  filters?: FilterSpec[];
  pages: PageSpec[];
}

export interface IssueParams {
  issuedAt: string;
  values: Record<string, string | number>;
  messages?: Partial<Record<MessageKey, string>>;
}
