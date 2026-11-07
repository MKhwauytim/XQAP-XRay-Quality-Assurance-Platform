import type { CatalogVisual, SlotDecl } from "../types";

/**
 * Pieces every catalog design shares. deck3 grid notes: the engine slide is 24 columns by 14 rows; row 0 is the
 * title with its gold rule, so content starts at row 1 and the source line sits in row 13, as deck3's foot does.
 */

/** The optional source line every design carries (deck3's slide foot); a demo fills it with «بيانات توضيحية». */
export const NOTE_SLOT: SlotDecl = { id: "sourceNote", nameAr: "ملاحظة المصدر", kind: "text", required: false };

/** The source line in the bottom row, at the slide's left (its end in RTL), in the smallest allowed size. */
export const noteVisual = (): CatalogVisual => ({
  visualId: "note", type: "text", frame: { col: 0, row: 13, w: 8, h: 1, z: 2 }, wells: {},
  format: { tone: "neutral", sizePx: 20, weight: 400 },
  text: `{{slot:${NOTE_SLOT.id}}}`,
});

export const GRID = { cols: 24, rows: 14 } as const;
