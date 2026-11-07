import type { VisualType, WellRole } from "./types";

export interface WellSchema {
  accepts: ("text" | "number" | "date" | "boolean" | "measure")[];
  min: number;
  max: number;
}

export const WELL_SCHEMAS: Record<VisualType, Partial<Record<WellRole, WellSchema>>> = {
  text: {},
  kpiBand: { values: { accepts: ["measure"], min: 1, max: 6 } },
  table: {
    rows: { accepts: ["text", "date"], min: 1, max: 2 },
    values: { accepts: ["measure"], min: 1, max: 6 },
  },
  barChart: {
    axis: { accepts: ["text", "date"], min: 1, max: 1 },
    legend: { accepts: ["text"], min: 0, max: 1 },
    values: { accepts: ["measure"], min: 1, max: 1 },
  },
};
