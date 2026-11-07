import type { CatalogDesign } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

/** deck3 `barChart`: one measure compared across the categories of one field, filling the slide body. */
export const d03Bars: CatalogDesign = {
  number: 3,
  nameAr: "مقارنة بالأعمدة",
  descriptionAr: "مخطط أعمدة يقارن مقياسًا واحدًا بين فئات حقل واحد.",
  deck3Source: "barChart",
  status: "active",
  slots: [
    { id: "category", nameAr: "الفئة", kind: "dimension", required: true },
    { id: "value", nameAr: "القيمة", kind: "measure", required: true },
    NOTE_SLOT,
  ],
  page: {
    grid: GRID,
    visuals: [
      {
        visualId: "bars", type: "barChart", frame: { col: 1, row: 1, w: 22, h: 12, z: 1 },
        wells: { axis: [{ slot: "category" }], values: [{ slot: "value" }] },
      },
      noteVisual(),
    ],
  },
};
