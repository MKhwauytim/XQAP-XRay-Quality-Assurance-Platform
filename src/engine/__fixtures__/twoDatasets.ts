import type { DatasetDef, RawFile } from "../data/types";
import type { IssueParams, MeasureSpec, ReportSpec } from "../spec/types";
import { FIXTURE_DATASET, FIXTURE_FILES, FIXTURE_THEME } from "./twoSlide";

export const SHIP_FILE = "shipments.xlsx";
export const SHIP_SHEET = "الشحنات";
export const SHIP_PORTS = 40;

const pad = (i: number): string => String(i).padStart(2, "0");

/**
 * 46 raw rows: 40 ports «منفذ 00..39» in 2026-05 with weight i + 1 (sum 820), 5 rows of «منفذ 00» in 2026-04
 * with weight 1000 each (outside the month filter), and one all-blank row (kept: the dataset has no steps).
 */
export function shipmentFile(): RawFile {
  const rows: (string | number | null)[][] = [];
  for (let i = 0; i < SHIP_PORTS; i++) rows.push([`منفذ ${pad(i)}`, "2026-05", i + 1]);
  for (let i = 0; i < 5; i++) rows.push(["منفذ 00", "2026-04", 1000]);
  rows.push([null, null, null]);
  return {
    fileName: SHIP_FILE,
    bytesSha256: "fedcba9876543210".repeat(4),
    sheets: [{ sheetName: SHIP_SHEET, headers: ["المنفذ", "الشهر", "الوزن"], rows }],
  };
}

function col(id: string, label: string, header: string, type: "text" | "number") {
  return {
    source: { file: SHIP_FILE, sheet: SHIP_SHEET, header }, id, label, type,
    role: type === "number" ? ("measure" as const) : ("dimension" as const),
    level: type === "number" ? ("quantitative" as const) : ("nominal" as const),
  };
}

export const SHIP_DATASET: DatasetDef = {
  id: "shipments",
  label: "الشحنات",
  files: [SHIP_FILE],
  columns: [col("shipPort", "منفذ الشحن", "المنفذ", "text"), col("shipMonth", "الشهر", "الشهر", "text"), col("weight", "الوزن", "الوزن", "number")],
  steps: [],
};

const MEASURES: MeasureSpec[] = [
  { id: "studied", label: "المدروس", datasetId: "studies", formula: "count([الحالة])", format: { kind: "int", digits: 0 } },
  { id: "shipCount", label: "عدد الشحنات", datasetId: "shipments", formula: "count([منفذ الشحن])", format: { kind: "int", digits: 0 } },
  { id: "totalWeight", label: "إجمالي الوزن", datasetId: "shipments", formula: "sum([الوزن])", format: { kind: "int", digits: 0 } },
];

const PAGE = { size: "16:9" as const, grid: { cols: 24 as const, rows: 14 as const } };
const MONTH = { field: "shipMonth", op: "eq" as const, value: { param: "month" } };

function buildSpec(): ReportSpec {
  return {
    schemaVersion: 1,
    reportId: "twoDatasets",
    title: "تقرير الشحنات",
    theme: "deck3",
    datasets: [structuredClone(FIXTURE_DATASET), structuredClone(SHIP_DATASET)],
    model: { measures: structuredClone(MEASURES) },
    params: [{ id: "month", type: "month", required: true }],
    pages: [
      {
        pageId: "p1", title: "الملخص", ...PAGE,
        visuals: [
          {
            visualId: "p1text", type: "text", frame: { col: 0, row: 1, w: 24, h: 3, z: 1 }, wells: {},
            format: { tone: "neutral", sizePx: 28, weight: 400 },
            text: "تقرير شهر {{param:month}}: عدد الشحنات {{measure:shipCount}}",
          },
          {
            visualId: "p1kpi", type: "kpiBand", frame: { col: 0, row: 4, w: 24, h: 4, z: 1 },
            wells: { values: [{ measure: "studied" }] },
          },
        ],
      },
      {
        pageId: "p2", title: "الشحنات حسب المنفذ", ...PAGE, filters: [structuredClone(MONTH)],
        visuals: [
          {
            visualId: "p2table", type: "table", frame: { col: 0, row: 1, w: 24, h: 13, z: 1 },
            wells: { rows: [{ field: "shipPort" }], values: [{ measure: "shipCount" }, { measure: "totalWeight" }] },
          },
        ],
      },
      {
        pageId: "p3", title: "الوزن حسب المنفذ", ...PAGE,
        visuals: [
          {
            visualId: "p3bar", type: "barChart", frame: { col: 0, row: 1, w: 24, h: 13, z: 1 }, filters: [structuredClone(MONTH)],
            wells: { axis: [{ field: "shipPort" }], values: [{ measure: "totalWeight" }] },
          },
        ],
      },
    ],
  };
}

/** Two datasets, a page filter and a visual filter on `{{param:month}}`, a 40-row table and a 40-category bar. */
export function twoDatasetsFixture() {
  const params: IssueParams = { issuedAt: "2026-11-06T09:00:00Z", values: { month: "2026-05" } };
  const files: RawFile[] = [...structuredClone(FIXTURE_FILES), shipmentFile()];
  return { spec: buildSpec(), params, theme: structuredClone(FIXTURE_THEME), files };
}
