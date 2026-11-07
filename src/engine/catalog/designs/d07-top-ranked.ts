import type { CatalogDesign } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

/** deck3 `barChart` over many categories: the top five by value, highest first, the rest folded into «أخرى». */
export const d07TopRanked: CatalogDesign = {
  number: 7,
  nameAr: "الأعلى ترتيبًا",
  descriptionAr: "مخطط أعمدة لأعلى خمس فئات حسب القيمة، وتجمع بقية الفئات في عمود واحد باسم أخرى.",
  deck3Source: "barChart (topN + «أخرى»)",
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
        visualId: "bars", type: "barChart", frame: { col: 1, row: 2, w: 22, h: 11, z: 1 },
        wells: { axis: [{ slot: "category" }], values: [{ slot: "value" }] },
        sort: { slot: "value", dir: "desc" },
        limit: { topN: 5, others: true },
      },
      noteVisual(),
    ],
  },
};
