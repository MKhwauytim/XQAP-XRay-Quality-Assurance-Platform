import { describe, expect, it } from "vitest";
import { FIXTURE_DATASET as def, FIXTURE_FILES as files } from "../__fixtures__/twoSlide";
import { profileColumns } from "./profile";
import { typeDataset } from "./typing";

describe("profileColumns", () => {
  const { data: typed } = typeDataset(def, files);

  it("counts valid, error, null and distinct", () => {
    const p = profileColumns(typed, def).find((c) => c.columnId === "count")!;
    expect(p).toMatchObject({ total: 12, valid: 9, errors: 2, nulls: 1, distinct: 7 });
    expect(p.valid + p.errors + p.nulls).toBe(p.total);
    expect(p.sampleErrors).toEqual(["غير متوفر", "12,5"]);
  });

  it("a text column with one empty status has one null and no errors", () => {
    const p = profileColumns(typed, def).find((c) => c.columnId === "status")!;
    expect(p).toMatchObject({ total: 12, errors: 0, nulls: 1, valid: 11, distinct: 2 });
  });

  it("caps sampleErrors at 5", () => {
    const bad = {
      id: "x",
      rows: Array.from({ length: 8 }, () => ({ count: null })),
      errors: Array.from({ length: 8 }, (_, i) => ({ columnId: "count", row: i, raw: `e${i}` })),
    };
    const p = profileColumns(bad, def).find((c) => c.columnId === "count")!;
    expect(p.sampleErrors).toEqual(["e0", "e1", "e2", "e3", "e4"]);
    expect(p).toMatchObject({ errors: 8, nulls: 0, valid: 0 });
  });
});
