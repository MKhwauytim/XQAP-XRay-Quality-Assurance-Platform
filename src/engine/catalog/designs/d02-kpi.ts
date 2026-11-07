import type { CatalogDesign } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

/** deck3 `kpiBand` ("solo" variant): three or four headline figures in one band across the slide. */
export const d02Kpi: CatalogDesign = {
  number: 2,
  nameAr: "شريط المؤشرات",
  descriptionAr: "ثلاثة أو أربعة مؤشرات رئيسية في شريط واحد بعرض الشريحة.",
  deck3Source: "kpiBand",
  status: "active",
  slots: [
    { id: "kpi1", nameAr: "المؤشر الأول", kind: "measure", required: true },
    { id: "kpi2", nameAr: "المؤشر الثاني", kind: "measure", required: true },
    { id: "kpi3", nameAr: "المؤشر الثالث", kind: "measure", required: true },
    { id: "kpi4", nameAr: "المؤشر الرابع", kind: "measure", required: false },
    NOTE_SLOT,
  ],
  page: {
    grid: GRID,
    visuals: [
      {
        visualId: "band", type: "kpiBand", frame: { col: 0, row: 4, w: 24, h: 4, z: 1 },
        wells: { values: [{ slot: "kpi1" }, { slot: "kpi2" }, { slot: "kpi3" }, { slot: "kpi4" }] },
      },
      noteVisual(),
    ],
  },
};
