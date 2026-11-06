import type { DatasetDef, RawFile } from "../data/types";

export const FIXTURE_FILE = "studies.xlsx";
export const FIXTURE_SHEET = "نتائج الدراسة";

/** 12 raw rows: 1 empty status (removed by s1), 1 exact duplicate (removed by s2), 7 matched after both. */
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
          ["الرياض", "بري", "مطابق", 300],
          ["الدمام", "بحري", "مطابق", 400],
          ["الدمام", "بحري", "مطابق", 500],
          ["الرياض", "بري", "مطابق", "غير متوفر"],
          ["جدة", "بحري", "غير مطابق", "12,5"],
          ["الرياض", "بري", "غير مطابق", 700],
          ["جدة", "بحري", "غير مطابق", 200],
          ["الدمام", "بحري", "", ""],
          ["الرياض", "بري", "مطابق", 600],
          ["الرياض", "بري", "مطابق", 600],
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
