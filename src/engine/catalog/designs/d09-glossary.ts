import type { CatalogDesign, CatalogVisual, SlotDecl } from "../types";
import { GRID, NOTE_SLOT, noteVisual } from "./shared";

const ORDINALS = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];

/** Six cells, three per row, as deck3's `cols-3` glossary grid: each a bold term over its definition. */
const CELLS = ORDINALS.map((ord, i) => ({ ord, i, term: `term${i + 1}`, definition: `definition${i + 1}` }));

const slots: SlotDecl[] = CELLS.flatMap(({ ord, i, term, definition }): SlotDecl[] => [
  { id: term, nameAr: `المصطلح ${ord}`, kind: "text", required: i < 2 },
  { id: definition, nameAr: `التعريف ${ord}`, kind: "text", required: i < 2 },
]);

const visuals: CatalogVisual[] = CELLS.flatMap(({ i, term, definition }): CatalogVisual[] => {
  // RTL: the first cell of a row sits at the right; rows share the same three columns.
  const col = 16 - (i % 3) * 8;
  const row = i < 3 ? 2 : 7;
  return [
    { visualId: term, type: "text", frame: { col, row, w: 8, h: 1, z: 1 }, wells: {}, format: { tone: "primary", sizePx: 28, weight: 700 }, text: `{{slot:${term}}}` },
    { visualId: definition, type: "text", frame: { col, row: row + 1, w: 8, h: 3, z: 1 }, wells: {}, format: { tone: "neutral", sizePx: 22, weight: 400 }, text: `{{slot:${definition}}}` },
  ];
});

/** deck3 `glossarySlide`: terms and their definitions in a grid of cells; definitions, not figures. */
export const d09Glossary: CatalogDesign = {
  number: 9,
  nameAr: "تعريفات المصطلحات",
  descriptionAr: "شريحة تعرف مصطلحات التقرير: حتى ستة مصطلحات في شبكة، تحت كل مصطلح تعريفه.",
  deck3Source: "glossarySlide",
  status: "active",
  slots: [...slots, NOTE_SLOT],
  page: { grid: GRID, visuals: [...visuals, noteVisual()] },
  overrules: [{ rule: "R8", reasonAr: "شريحة تعريفات لا تحمل أرقامًا" }],
};
