import type { CatalogDesign } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

/** deck3 `kpiBand` ("top") over `dataTable`: headline figures in a band, the detail table below as the focal element. */
export const d08KpiTable: CatalogDesign = {
  number: 8,
  nameAr: "مؤشرات مع جدول",
  descriptionAr: "شريط مؤشرات في الأعلى وجدول تفصيلي تحته بحقل صفوف وحتى ثلاثة مقاييس مع صف الإجمالي.",
  deck3Source: "kpiBand + dataTable",
  status: "active",
  slots: [
    { id: "kpi1", nameAr: "المؤشر الأول", kind: "measure", required: true },
    { id: "kpi2", nameAr: "المؤشر الثاني", kind: "measure", required: true },
    { id: "kpi3", nameAr: "المؤشر الثالث", kind: "measure", required: false },
    { id: "row1", nameAr: "حقل الصفوف", kind: "dimension", required: true },
    { id: "value1", nameAr: "مقياس الجدول الأول", kind: "measure", required: true },
    { id: "value2", nameAr: "مقياس الجدول الثاني", kind: "measure", required: false },
    { id: "value3", nameAr: "مقياس الجدول الثالث", kind: "measure", required: false },
    { id: "rowOrder", nameAr: "ترتيب الصفوف", kind: "measure", required: false },
    NOTE_SLOT,
  ],
  page: {
    grid: GRID,
    visuals: [
      {
        visualId: "band", type: "kpiBand", frame: { col: 0, row: 2, w: 24, h: 3, z: 1 },
        wells: { values: [{ slot: "kpi1" }, { slot: "kpi2" }, { slot: "kpi3" }] },
      },
      {
        visualId: "table", type: "table", frame: { col: 0, row: 6, w: 24, h: 7, z: 1 },
        wells: { rows: [{ slot: "row1" }], values: [{ slot: "value1" }, { slot: "value2" }, { slot: "value3" }] },
        sort: { slot: "rowOrder", dir: "asc" },
      },
      noteVisual(),
    ],
  },
};
