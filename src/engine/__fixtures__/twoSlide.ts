import type { DatasetDef, RawFile } from "../data/types";
import type { DomainPack, IssueParams, MeasureSpec, ReportSpec, ThemeTokens } from "../spec/types";

export const FIXTURE_FILE = "studies.xlsx";
export const FIXTURE_SHEET = "نتائج الدراسة";

/**
 * 12 raw rows: 1 empty status (removed by s1), 1 exact duplicate (removed by s2). After both, 10 rows, 7 matched:
 * بحري 4 rows (جدة, 3 matched); بري 6 rows (الحديثة 3 with 2 matched, البطحاء 3 with 2 matched).
 */
export const FIXTURE_FILES: RawFile[] = [
  {
    fileName: FIXTURE_FILE,
    bytesSha256: "0123456789abcdef".repeat(4),
    sheets: [
      {
        sheetName: FIXTURE_SHEET,
        headers: ["المنفذ", "نوع المنفذ", "الحالة", "العدد"],
        rows: [
          ["جدة", "بحري", "مطابق", 100],
          ["جدة", "بحري", "مطابق", 200],
          ["الحديثة", "بري", "مطابق", 300],
          ["البطحاء", "بري", "مطابق", 400],
          ["البطحاء", "بري", "مطابق", 500],
          ["الحديثة", "بري", "مطابق", "غير متوفر"],
          ["جدة", "بحري", "غير مطابق", "12,5"],
          ["الحديثة", "بري", "غير مطابق", 700],
          ["البطحاء", "بري", "غير مطابق", 200],
          ["البطحاء", "بري", "", ""],
          ["جدة", "بحري", "مطابق", 600],
          ["جدة", "بحري", "مطابق", 600],
        ],
      },
    ],
  },
];

function col(id: string, label: string, header: string, type: "text" | "number") {
  return {
    source: { file: FIXTURE_FILE, sheet: FIXTURE_SHEET, header },
    id,
    label,
    type,
    role: type === "number" ? ("measure" as const) : ("dimension" as const),
    level: type === "number" ? ("quantitative" as const) : ("nominal" as const),
  };
}

export const FIXTURE_DATASET: DatasetDef = {
  id: "studies",
  label: "الدراسات",
  files: [FIXTURE_FILE],
  columns: [
    col("port", "المنفذ", "المنفذ", "text"),
    col("portType", "نوع المنفذ", "نوع المنفذ", "text"),
    col("status", "الحالة", "الحالة", "text"),
    col("count", "العدد", "العدد", "number"),
  ],
  steps: [
    { id: "s1", label: "استبعاد الحالة الفارغة", kind: "filter", filter: { field: "status", op: "notNull" } },
    { id: "s2", label: "حذف التكرار", kind: "dedupe", key: ["port", "portType", "status", "count"] },
  ],
};

const STUDIED: MeasureSpec = {
  id: "studied", label: "المدروس", datasetId: "studies", formula: "count([الحالة])",
  format: { kind: "int", digits: 0 },
};
const MATCH_RATE: MeasureSpec = {
  id: "matchRate", label: "نسبة التوائم", datasetId: "studies",
  formula: 'filter(count([الحالة]), [الحالة] = "مطابق") / @studied',
  format: { kind: "pct", digits: 2 },
};

export const FIXTURE_THEME: ThemeTokens = {
  tones: { primary: "#1F4E79", neutral: "#5B6770", good: "#2E7D32", bad: "#B3261E" },
  ink: {
    navy: "#0B2545", text: "#1B1F24", muted: "#5B6770", hair: "#D5DAE0",
    bg: "#FFFFFF", panel: "#F3F5F8", gold: "#B58B2A",
  },
  font: "Cairo",
};

function buildSpec(): ReportSpec {
  return {
    schemaVersion: 1,
    reportId: "twoSlide",
    title: "تقرير المنافذ",
    theme: "deck3",
    datasets: [structuredClone(FIXTURE_DATASET)],
    model: { measures: [structuredClone(STUDIED), structuredClone(MATCH_RATE)] },
    params: [{ id: "port", type: "text", required: true }],
    pages: [
      {
        pageId: "p1", title: "الملخص", size: "16:9", grid: { cols: 24, rows: 14 },
        visuals: [
          {
            visualId: "p1text", type: "text", frame: { col: 0, row: 1, w: 24, h: 3, z: 1 }, wells: {},
            format: { tone: "neutral", sizePx: 28, weight: 400 },
            text: "تقرير {{param:port}}: نسبة التوائم {{measure:matchRate}}",
          },
          {
            visualId: "p1kpi", type: "kpiBand", frame: { col: 0, row: 4, w: 24, h: 4, z: 1 },
            wells: { values: [{ measure: "studied" }, { measure: "matchRate" }] },
          },
        ],
      },
      {
        pageId: "p2", title: "التفصيل", size: "16:9", grid: { cols: 24, rows: 14 },
        visuals: [
          {
            visualId: "p2table", type: "table", frame: { col: 0, row: 1, w: 24, h: 6, z: 1 },
            wells: { rows: [{ field: "portType" }], values: [{ measure: "studied" }, { measure: "matchRate" }] },
          },
          {
            visualId: "p2bar", type: "barChart", frame: { col: 0, row: 7, w: 24, h: 7, z: 1 },
            wells: { axis: [{ field: "port" }], values: [{ measure: "matchRate" }] },
          },
        ],
      },
    ],
  };
}

/** A fresh deep copy on every call, safe to mutate. */
export function twoSlideFixture() {
  const params: IssueParams = { issuedAt: "2026-11-05T09:00:00Z", values: { port: "جدة" } };
  return { spec: buildSpec(), params, theme: structuredClone(FIXTURE_THEME) };
}
export type Fixture = ReturnType<typeof twoSlideFixture>;

export function packWith(measure: { id: string; formula: string }): DomainPack {
  return {
    packId: "testPack",
    schemaVersion: 1,
    fields: [],
    measures: [{ ...measure, label: measure.id, datasetId: "studies", format: { kind: "int", digits: 0 } }],
  };
}
