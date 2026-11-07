import type { Cell, ColumnProfile, DatasetDef, TypedDataset } from "./types";

const MAX_SAMPLE_ERRORS = 5;
const MAX_SAMPLE_CHARS = 200;

export function profileColumns(data: TypedDataset, def: DatasetDef): ColumnProfile[] {
  return def.columns.map((col) => {
    const errs = data.errors.filter((e) => e.columnId === col.id);
    const seen = new Set<Cell>();
    let nullCells = 0;
    for (const r of data.rows) {
      const v = r[col.id] ?? null;
      if (v === null) nullCells += 1;
      else seen.add(v);
    }
    const total = data.rows.length;
    // An errored cell is stored as null but counted once, as an error.
    const nulls = Math.max(0, nullCells - errs.length);
    return {
      columnId: col.id,
      total,
      valid: total - nulls - errs.length,
      errors: errs.length,
      nulls,
      distinct: seen.size,
      sampleErrors: errs.slice(0, MAX_SAMPLE_ERRORS).map((e) => e.raw.slice(0, MAX_SAMPLE_CHARS)),
    };
  });
}
