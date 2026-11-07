import type { CatalogDesign } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

/** deck3 `sectionDivider`: a large section name with a one-line description, centred in the slide body. */
export const d01Section: CatalogDesign = {
  number: 1,
  nameAr: "فاصل قسم",
  descriptionAr: "شريحة تفصل بين أقسام التقرير: اسم القسم بخط كبير ووصف قصير تحته.",
  deck3Source: "sectionDivider",
  status: "active",
  slots: [
    { id: "heading", nameAr: "اسم القسم", kind: "text", required: true },
    { id: "description", nameAr: "وصف القسم", kind: "text", required: false },
    NOTE_SLOT,
  ],
  page: {
    grid: GRID,
    // deck3 dividers have no title bar: the heading is the only title.
    titleRow: false,
    visuals: [
      {
        visualId: "heading", type: "text", frame: { col: 3, row: 4, w: 18, h: 3, z: 1 }, wells: {},
        format: { tone: "primary", sizePx: 72, weight: 700 }, text: "{{slot:heading}}",
      },
      {
        visualId: "description", type: "text", frame: { col: 3, row: 7, w: 18, h: 2, z: 1 }, wells: {},
        format: { tone: "neutral", sizePx: 32, weight: 400 }, text: "{{slot:description}}",
      },
      noteVisual(),
    ],
  },
  overrules: [{ rule: "R8", reasonAr: "فاصل القسم يعلن اسم القسم ولا يحمل رقمًا" }],
};
