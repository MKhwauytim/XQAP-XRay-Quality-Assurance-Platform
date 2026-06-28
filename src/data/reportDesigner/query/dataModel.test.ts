import { describe, it, expect } from "vitest";
import { buildDataModel } from "./dataModel";
import { getFieldMeta } from "./fieldCatalog";
import { runQuery } from "./runQuery";

describe("fieldCatalog", () => {
  it("tags portName as a string dimension and exposes an Arabic label", () => {
    const meta = getFieldMeta("portName");
    expect(meta?.role).toBe("dimension");
    expect(meta?.type).toBe("string");
    expect(typeof meta?.label).toBe("string");
    expect(meta!.label.length).toBeGreaterThan(0);
  });
});

describe("buildDataModel", () => {
  it("exposes the fact table and supports a grouped query over it", () => {
    const factRows = [
      { portName: "ميناء أ", imageResult: "اشتباه" },
      { portName: "ميناء أ", imageResult: "سليمة" },
      { portName: "ميناء ب", imageResult: "اشتباه" },
    ];
    const model = buildDataModel({ factRows: factRows as never, portProfiles: [], stageProfiles: [] });
    expect(model.tables.fact.rows).toHaveLength(3);
    expect(model.tables.fact.fields.some((f) => f.field === "portName")).toBe(true);
    const out = runQuery(model.tables.fact.rows, {
      groupBy: ["portName"],
      values: [{ field: "portName", agg: "count" }],
      filters: [],
    });
    expect(out).toEqual([
      { portName: "ميناء أ", count_portName: 2 },
      { portName: "ميناء ب", count_portName: 1 },
    ]);
  });
});
