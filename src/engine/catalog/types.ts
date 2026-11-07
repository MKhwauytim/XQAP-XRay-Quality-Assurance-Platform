import type { PageSpec, VisualSpec, WellRole } from "../spec/types";

export type DesignStatus = "active" | "planned" | "retired";

export interface SlotDecl {
  id: string;
  nameAr: string;
  kind: "dimension" | "measure" | "text";
  required: boolean;
}

export type SlotRef = { slot: string };

/** A visual whose wells point at slots instead of fields; `text` may hold `{{slot:<id>}}`. */
export type CatalogVisual = Omit<VisualSpec, "wells" | "text" | "sort"> & {
  wells: Partial<Record<WellRole, SlotRef[]>>;
  text?: string;
  /** Sort by the field or measure bound to a slot; dropped when that optional slot is unbound. */
  sort?: { slot: string; dir: "asc" | "desc" };
};

export interface CatalogDesign {
  number: number;
  nameAr: string;
  descriptionAr: string;
  deck3Source: string;
  status: DesignStatus;
  retiredReasonAr?: string;
  slots: SlotDecl[];
  page: { grid: PageSpec["grid"]; titleRow?: false; visuals: CatalogVisual[] };
  overrules?: { rule: string; reasonAr: string }[];
}
