import type { CatalogDesign } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

/** deck3 `barChart` beside a `tintedPanel`: the chart carries the slide, a narrow panel at its end reads it in words. */
export const d06BarsNote: CatalogDesign = {
  number: 6,
  nameAr: "مخطط مع ملاحظة",
  descriptionAr: "مخطط أعمدة بعرض معظم الشريحة، وبجانبه لوحة ضيقة بعنوان ونص قصير يشرح ما يظهره المخطط.",
  deck3Source: "barChart + note (tintedPanel needs a panel visual, Milestone 2)",
  status: "active",
  slots: [
    { id: "category", nameAr: "الفئة", kind: "dimension", required: true },
    { id: "value", nameAr: "القيمة", kind: "measure", required: true },
    { id: "panelTitle", nameAr: "عنوان اللوحة", kind: "text", required: true },
    { id: "panelText", nameAr: "نص اللوحة", kind: "text", required: true },
    NOTE_SLOT,
  ],
  page: {
    grid: GRID,
    visuals: [
      // RTL: the panel sits at the slide's start (right), the chart fills the rest.
      {
        visualId: "panelTitle", type: "text", frame: { col: 17, row: 2, w: 7, h: 2, z: 1 }, wells: {},
        format: { tone: "primary", sizePx: 28, weight: 700 }, text: "{{slot:panelTitle}}",
      },
      {
        visualId: "panelText", type: "text", frame: { col: 17, row: 4, w: 7, h: 8, z: 1 }, wells: {},
        format: { tone: "neutral", sizePx: 24, weight: 400 }, text: "{{slot:panelText}}",
      },
      {
        visualId: "bars", type: "barChart", frame: { col: 0, row: 2, w: 16, h: 11, z: 1 },
        wells: { axis: [{ slot: "category" }], values: [{ slot: "value" }] },
        sort: { slot: "value", dir: "desc" },
      },
      noteVisual(),
    ],
  },
};
