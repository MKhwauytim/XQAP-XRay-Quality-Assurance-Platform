export interface RawSheet {
  sheetName: string;
  headers: string[];
  rows: unknown[][];
}

export interface RawFile {
  fileName: string;
  /** SHA-256 of the uploaded bytes, computed by the host. */
  bytesSha256: string;
  sheets: RawSheet[];
}

export type ColumnType = "text" | "number" | "date" | "boolean";
export type ColumnRole = "dimension" | "measure";
export type ColumnLevel = "nominal" | "ordinal" | "quantitative" | "temporal";

export interface ColumnDecl {
  source: { file: string; sheet: string; header: string };
  id: string;
  label: string;
  type: ColumnType;
  role: ColumnRole;
  level: ColumnLevel;
  packField?: string;
}

export interface FilterSpec {
  field: string;
  op: "eq" | "neq" | "in" | "notNull";
  value?: string | number | boolean | (string | number)[] | { param: string };
}

export interface ProcessingStep {
  id: string;
  label: string;
  kind: "filter" | "dedupe" | "calc";
  filter?: FilterSpec;
  key?: string[];
  /** A calc column is virtual: it also appears in `columns` with `source.header` "". */
  calc?: { columnId: string; type: ColumnType; formula: string };
}

export interface DatasetDef {
  id: string;
  label: string;
  files: string[];
  columns: ColumnDecl[];
  steps: ProcessingStep[];
}

/** Dates are ISO YYYY-MM-DD strings. */
export type Cell = string | number | boolean | null;

export interface TypedCell {
  value: Cell;
  error?: string;
}

export interface TypedDataset {
  id: string;
  rows: Record<string, Cell>[];
  /** `row` is the 0-based index into `rows`; `raw` is the cell as text. */
  errors: { columnId: string; row: number; raw: string }[];
}

export interface ColumnProfile {
  columnId: string;
  total: number;
  valid: number;
  errors: number;
  nulls: number;
  distinct: number;
  /** At most 5 raw values, for the host profile panel only; the recipe strips it. */
  sampleErrors: string[];
}
