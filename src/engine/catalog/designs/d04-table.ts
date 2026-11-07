import type { CatalogDesign } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

/** deck3 `dataTable`: one or two row fields and up to three measures, with a total row, optionally ordered by a measure; long tables continue. */
export const d04Table: CatalogDesign = {
  number: 4,
  nameAr: "جدول تفصيلي",
  descriptionAr: "جدول بصف أو صفين من الحقول وحتى ثلاثة مقاييس مع صف الإجمالي، ويتبع على شرائح إضافية إذا طال.",
  deck3Source: "dataTable",
  status: "active",
  slots: [
    { id: "row1", nameAr: "حقل الصفوف", kind: "dimension", required: true },
    { id: "row2", nameAr: "حقل الصفوف الثاني", kind: "dimension", required: false },
    { id: "value1", nameAr: "المقياس الأول", kind: "measure", required: true },
    { id: "value2", nameAr: "المقياس الثاني", kind: "measure", required: false },
    { id: "value3", nameAr: "المقياس الثالث", kind: "measure", required: false },
    { id: "rowOrder", nameAr: "ترتيب الصفوف", kind: "measure", required: false },
    NOTE_SLOT,
  ],
  page: {
    grid: GRID,
    visuals: [
      {
        visualId: "table", type: "table", frame: { col: 0, row: 1, w: 24, h: 12, z: 1 },
        wells: {
          rows: [{ slot: "row1" }, { slot: "row2" }],
          values: [{ slot: "value1" }, { slot: "value2" }, { slot: "value3" }],
        },
        sort: { slot: "rowOrder", dir: "asc" },
      },
      noteVisual(),
    ],
  },
};
