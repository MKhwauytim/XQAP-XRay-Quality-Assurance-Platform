import { describe, expect, it } from "vitest";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { Fixture } from "../__fixtures__/twoSlide";
import { applySteps } from "../data/processing";
import type { ProcessedDataset } from "../data/processing";
import { profileColumns } from "../data/profile";
import type { ColumnProfile, RawFile } from "../data/types";
import { typeDataset } from "../data/typing";
import { LIMITS } from "../limits";
import { formatValue, resolveVisuals } from "./resolve";

function resolveFixture(f: Fixture, files: RawFile[] = FIXTURE_FILES) {
  const data = new Map<string, ProcessedDataset>();
  const profiles = new Map<string, ColumnProfile[]>();
  f.spec.datasets.forEach((def, i) => {
    const { data: typed } = typeDataset(def, files);
    profiles.set(def.id, profileColumns(typed, def));
    data.set(def.id, applySteps(typed, def, f.params, i));
  });
  return resolveVisuals(f.spec, data, profiles, f.params);
}

/** A fixture whose raw sheet has `n` distinct ports, two matched rows each, the first port the largest. */
function withPorts(n: number): { f: Fixture; files: RawFile[] } {
  const files = structuredClone(FIXTURE_FILES);
  const rows: unknown[][] = [];
  for (let i = 0; i < n; i++) {
    const copies = i === 0 ? 4 : 2;
    for (let c = 0; c < copies; c++) rows.push([`منفذ ${String(i).padStart(2, "0")}`, "بري", "مطابق", i * 10 + c]);
  }
  files[0].sheets[0].rows = rows;
  return { f: twoSlideFixture(), files };
}

describe("resolveVisuals", () => {
  const { visuals, values, issues } = resolveFixture(twoSlideFixture());

  it("matchRate resolves to 0.7 with display 70.00% and provenance naming the column", () => {
    const v = values.get("matchRate")!;
    expect(v.value).toBeCloseTo(0.7, 10);
    expect(v.display).toBe("70.00%");
    expect(v.provenance.columns).toEqual(["status"]);
    expect(v.provenance).toMatchObject({ datasetId: "studies", measureId: "matchRate", filters: [] });
  });

  it("studied counts the 10 processed rows", () => {
    expect(values.get("studied")!).toMatchObject({ value: 10, display: "10" });
  });

  it("table cells per port type and a total that is re-evaluated, not summed", () => {
    expect(values.get("matchRate@portType=بحري")!.display).toBe("75.00%");
    expect(values.get("matchRate@portType=بري")!.display).toBe("66.67%");
    const table = visuals.find((v) => v.visualId === "p2table")!;
    expect(table.categories).toEqual(["بحري", "بري"]);
    expect(table.totals.find((t) => t.measureId === "matchRate")!.display).toBe("70.00%");
    expect(table.totals.find((t) => t.measureId === "studied")!.display).toBe("10");
  });

  it("bar chart categories sort by code point and carry group cells", () => {
    const bar = visuals.find((v) => v.visualId === "p2bar")!;
    expect(bar.categories).toEqual(["البطحاء", "الحديثة", "جدة"]);
    expect(bar.cells.map((c) => [c.key, c.display])).toEqual([
      ["matchRate@port=البطحاء", "66.67%"], ["matchRate@port=الحديثة", "66.67%"], ["matchRate@port=جدة", "75.00%"],
    ]);
  });

  it("sort by a measure descending orders categories by value", () => {
    const f = twoSlideFixture();
    f.spec.pages[1].visuals[1].sort = { by: "matchRate", dir: "desc" };
    expect(resolveFixture(f).visuals.find((v) => v.visualId === "p2bar")!.categories[0]).toBe("جدة");
  });

  it("visuals keep 1-based page indexes in spec order and the text visual resolves its measure", () => {
    expect(visuals.map((v) => [v.pageIndex, v.visualId])).toEqual([[1, "p1text"], [1, "p1kpi"], [2, "p2table"], [2, "p2bar"]]);
    expect(visuals[0].cells.map((c) => c.key)).toEqual(["matchRate"]);
  });

  it("a measure over a column with type errors fails with type.errors and the column name", () => {
    const f = twoSlideFixture();
    f.spec.model.measures.push({ id: "total", label: "المجموع", datasetId: "studies", formula: "sum([العدد])", format: { kind: "int", digits: 0 } });
    f.spec.pages[0].visuals[1].wells.values!.push({ measure: "total" });
    const r = resolveFixture(f);
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: "type.errors" }));
    expect(r.issues[0].detail).toContain("العدد");
    expect(r.issues[0].detail).toContain("2");
  });

  it.each(["dimension well", "filter"])("an errored column used as a %s also fails closed", (use) => {
    const f = twoSlideFixture();
    if (use === "dimension well") f.spec.pages[1].visuals[1].wells.axis = [{ field: "count" }];
    else f.spec.filters = [{ field: "count", op: "notNull" }];
    expect(resolveFixture(f).issues.map((i) => i.rule)).toContain("type.errors");
  });

  it("the fixture's errored column is unused, so resolve has no issues", () => {
    expect(issues).toEqual([]);
  });

  it("filters on {param: port} apply the param value and provenance holds the literal", () => {
    const f = twoSlideFixture();
    f.spec.filters = [{ field: "port", op: "eq", value: { param: "port" } }];
    const r = resolveFixture(f);
    expect(r.values.get("studied")!.value).toBe(4);
    expect(r.values.get("studied")!.provenance.filters).toEqual([{ field: "port", op: "eq", value: "جدة" }]);
  });

  it("an empty filtered set displays '-' for ratios and 0 for counts", () => {
    const f = twoSlideFixture();
    f.spec.filters = [{ field: "port", op: "eq", value: "لا يوجد" }];
    const r = resolveFixture(f);
    expect(r.values.get("studied")!.display).toBe("0");
    expect(r.values.get("matchRate")!).toMatchObject({ value: null, display: "-" });
  });

  it("13 categories collapse to 11 plus «أخرى», re-evaluated on the collapsed rows", () => {
    const { f, files } = withPorts(13);
    f.spec.model.measures[1] = { ...f.spec.model.measures[0], id: "matchRate" };
    const bar = resolveFixture(f, files).visuals.find((v) => v.type === "barChart")!;
    expect(bar.categories).toHaveLength(LIMITS.maxChartCategories);
    expect(bar.categories.at(-1)).toBe("أخرى");
    expect(bar.categories[0]).toBe("منفذ 00");
    expect(bar.cells.at(-1)!).toMatchObject({ key: "matchRate@port=أخرى", value: 4 });
  });

  it("is deterministic", () => {
    expect(resolveFixture(twoSlideFixture())).toEqual(resolveFixture(twoSlideFixture()));
  });
});

describe("formatValue", () => {
  it("uses Latin digits, thousands separators, pct and '-' for null", () => {
    expect(formatValue(1234567, { kind: "int", digits: 0 })).toBe("1,234,567");
    expect(formatValue(0.8295, { kind: "pct", digits: 2 })).toBe("82.95%");
    expect(formatValue(1234.5, { kind: "dec", digits: 2 })).toBe("1,234.50");
    expect(formatValue(null, { kind: "pct", digits: 2 })).toBe("-");
  });
});
