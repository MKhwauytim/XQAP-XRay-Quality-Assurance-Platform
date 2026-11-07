import type { CatalogDesign } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

/** deck3 `kpiBand` ("top") over `barChart`: headline figures in a band, the chart below as the focal element. */
export const d05KpiBars: CatalogDesign = {
  number: 5,
  nameAr: "مؤشرات مع مخطط",
  descriptionAr: "شريط مؤشرات في الأعلى ومخطط أعمدة تحته هو العنصر الرئيسي في الشريحة.",
  deck3Source: "kpiBand + barChart",
  status: "active",
  slots: [
    { id: "kpi1", nameAr: "المؤشر الأول", kind: "measure", required: true },
    { id: "kpi2", nameAr: "المؤشر الثاني", kind: "measure", required: true },
    { id: "kpi3", nameAr: "المؤشر الثالث", kind: "measure", required: false },
    { id: "category", nameAr: "فئة المخطط", kind: "dimension", required: true },
    { id: "value", nameAr: "قيمة المخطط", kind: "measure", required: true },
    NOTE_SLOT,
  ],
  page: {
    grid: GRID,
    visuals: [
      {
        visualId: "band", type: "kpiBand", frame: { col: 0, row: 1, w: 24, h: 3, z: 1 },
        wells: { values: [{ slot: "kpi1" }, { slot: "kpi2" }, { slot: "kpi3" }] },
      },
      {
        visualId: "bars", type: "barChart", frame: { col: 1, row: 4, w: 22, h: 9, z: 1 },
        wells: { axis: [{ slot: "category" }], values: [{ slot: "value" }] },
      },
      noteVisual(),
    ],
  },
};
