import { describe, expect, it } from "vitest";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { Fixture } from "../__fixtures__/twoSlide";
import { applySteps } from "../data/processing";
import type { ProcessedDataset } from "../data/processing";
import { profileColumns } from "../data/profile";
import type { ColumnProfile, RawFile } from "../data/types";
import { typeDataset } from "../data/typing";
import { LIMITS } from "../limits";
import { formatValue, resolveVisuals, valueKey } from "./resolve";

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
    const key = valueKey("studied", {}, [{ field: "port", op: "eq", value: "جدة" }]);
    expect(key).toBe('studied#["port","eq","جدة"]');
    expect(r.values.get(key)!.value).toBe(4);
    expect(r.values.get(key)!.provenance.filters).toEqual([{ field: "port", op: "eq", value: "جدة" }]);
    expect(r.values.has("studied")).toBe(false);
  });

  it("an empty filtered set displays '-' for ratios and 0 for counts", () => {
    const f = twoSlideFixture();
    f.spec.filters = [{ field: "port", op: "eq", value: "لا يوجد" }];
    const r = resolveFixture(f);
    const fl = [{ field: "port", op: "eq" as const, value: "لا يوجد" }];
    expect(r.values.get(valueKey("studied", {}, fl))!.display).toBe("0");
    expect(r.values.get(valueKey("matchRate", {}, fl))!).toMatchObject({ value: null, display: "-" });
  });

  it("13 categories collapse to 11 plus «أخرى», re-evaluated on the collapsed rows", () => {
    const { f, files } = withPorts(13);
    f.spec.model.measures[1] = { ...f.spec.model.measures[0], id: "matchRate" };
    const bar = resolveFixture(f, files).visuals.find((v) => v.type === "barChart")!;
    expect(bar.categories).toHaveLength(LIMITS.maxChartCategories);
    expect(bar.categories.at(-1)).toBe("أخرى");
    expect(bar.categories[0]).toBe("منفذ 00");
    expect(bar.cells.at(-1)!).toMatchObject({ key: "matchRate@port~others", value: 4 });
  });

  const limited = (n: number, limit: { topN: number; others: boolean }) => {
    const { f, files } = withPorts(n);
    f.spec.model.measures[1] = { ...f.spec.model.measures[0], id: "matchRate" };
    for (const p of f.spec.pages) for (const v of p.visuals) if (v.type === "barChart") v.limit = limit;
    const r = resolveFixture(f, files);
    return { r, bar: r.visuals.find((v) => v.type === "barChart")! };
  };

  it("limit others:false keeps the top 3 of 5, drops the rest, and totals only the kept rows", () => {
    const { r, bar } = limited(5, { topN: 3, others: false });
    expect(bar.categories).toEqual(["منفذ 00", "منفذ 01", "منفذ 02"]);
    expect(bar.categories).not.toContain("أخرى");
    expect(bar.cells.map((c) => c.group.port)).not.toContain("منفذ 03");
    expect(bar.cells.map((c) => c.group.port)).not.toContain("منفذ 04");
    expect([...r.values.keys()].some((k) => k.includes("~others"))).toBe(false);
    expect(bar.totals[0]).toMatchObject({ value: 8, key: "matchRate@port~top3" });
    expect(r.issues.filter((i) => i.rule === "resolve.keyConflict")).toEqual([]);
  });

  it("limit others:true keeps the full total, since «أخرى» is drawn", () => {
    const { bar } = limited(5, { topN: 3, others: true });
    expect(bar.categories).toEqual(["منفذ 00", "منفذ 01", "منفذ 02", "أخرى"]);
    expect(bar.totals[0]).toMatchObject({ value: 12, key: "matchRate" });
  });

  it("limit others:false with topN 12 and 12 groups keeps all 12", () => {
    const { bar } = limited(12, { topN: 12, others: false });
    expect(bar.categories).toHaveLength(12);
    expect(bar.categories).not.toContain("أخرى");
    expect(bar.totals[0]).toMatchObject({ value: 26, key: "matchRate" });
  });

  it("limit others:false with topN above the group count gives the unsplit totals", () => {
    const full = limited(5, { topN: 99, others: true }).bar;
    const { bar } = limited(5, { topN: 8, others: false });
    expect(bar.categories).toHaveLength(5);
    expect(bar.totals.map((t) => [t.key, t.value])).toEqual(full.totals.map((t) => [t.key, t.value]));
    expect(bar.totals.some((t) => t.key.includes("~top"))).toBe(false);
  });

  it("a real category named «أخرى» keeps its own key beside the collapsed bucket", () => {
    const { f, files } = withPorts(13);
    files[0].sheets[0].rows.push(["أخرى", "بري", "مطابق", 1], ["أخرى", "بري", "مطابق", 2], ["أخرى", "بري", "مطابق", 3]);
    f.spec.model.measures[1] = { ...f.spec.model.measures[0], id: "matchRate" };
    const r = resolveFixture(f, files);
    const bar = r.visuals.find((v) => v.type === "barChart")!;
    expect(bar.categories.filter((c) => c === "أخرى")).toHaveLength(2);
    expect(r.values.get("matchRate@port=أخرى")!.value).toBe(3);
    expect(r.values.get("matchRate@port~others")!.value).toBe(6);
    expect(r.issues).toEqual([]);
  });

  it("a KPI and a page-filtered table total get distinct keys and both correct values", () => {
    const f = twoSlideFixture();
    f.spec.pages[1].filters = [{ field: "portType", op: "eq", value: "بحري" }];
    const r = resolveFixture(f);
    expect(r.values.get("matchRate")!.display).toBe("70.00%");
    const table = r.visuals.find((v) => v.visualId === "p2table")!;
    const total = table.totals.find((t) => t.measureId === "matchRate")!;
    expect(total.key).toBe('matchRate#["portType","eq","بحري"]');
    expect(total.display).toBe("75.00%");
    expect(r.values.get(total.key)!.display).toBe("75.00%");
    expect(r.issues).toEqual([]);
  });

  it("a visual whose measures span datasets fails and evaluates nothing", () => {
    const f = twoSlideFixture();
    f.spec.datasets.push({ ...structuredClone(f.spec.datasets[0]), id: "copy" });
    f.spec.model.measures.push({ ...f.spec.model.measures[0], id: "studiedCopy", datasetId: "copy" });
    f.spec.pages[0].visuals[1].wells.values!.push({ measure: "studiedCopy" });
    const r = resolveFixture(f);
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: "schema.invalid", visual: "p1kpi", detail: "visual mixes datasets" }));
    expect(r.visuals.find((v) => v.visualId === "p1kpi")!.cells).toEqual([]);
  });

  it("a filter whose field matches no dataset raises an issue", () => {
    const f = twoSlideFixture();
    f.spec.pages[0].filters = [{ field: "nowhere", op: "notNull" }];
    expect(resolveFixture(f).issues).toContainEqual(expect.objectContaining({ rule: "schema.invalid", path: "pages[0].filters[0]" }));
  });

  it("a {param} missing from params raises an issue instead of an always-false filter", () => {
    const f = twoSlideFixture();
    f.spec.filters = [{ field: "port", op: "eq", value: { param: "absent" } }];
    const r = resolveFixture(f);
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: "schema.invalid", detail: "missing param: absent" }));
  });

  it("a null cell and a real '-' value stay two groups with correct figures", () => {
    const f = twoSlideFixture();
    const files = structuredClone(FIXTURE_FILES);
    files[0].sheets[0].rows.push(["", "بري", "مطابق", 1], ["-", "بري", "مطابق", 2], ["-", "بري", "غير مطابق", 3]);
    f.spec.model.measures[1] = { ...f.spec.model.measures[0], id: "matchRate" };
    const r = resolveFixture(f, files);
    const bar = r.visuals.find((v) => v.visualId === "p2bar")!;
    expect(bar.categories.filter((c) => c === "-")).toHaveLength(2);
    expect(r.values.get("matchRate@port=null")!.value).toBe(1);
    expect(r.values.get("matchRate@port=-")!.value).toBe(2);
  });

  it("two-field labels that join the same way stay two groups", () => {
    const f = twoSlideFixture();
    const files = structuredClone(FIXTURE_FILES);
    files[0].sheets[0].rows = [["a / b", "c", "مطابق", 1], ["a", "b / c", "مطابق", 2], ["a", "b / c", "مطابق", 3]];
    f.spec.pages[1].visuals[0].wells.rows = [{ field: "port" }, { field: "portType" }];
    const r = resolveFixture(f, files);
    const table = r.visuals.find((v) => v.visualId === "p2table")!;
    expect(table.categories).toEqual(["a / b / c", "a / b / c"]);
    expect(table.cells.filter((c) => c.measureId === "studied").map((c) => c.value).sort()).toEqual([1, 2]);
    expect(r.values.get('studied@port="a / b"|portType=c')).toBeUndefined();
    expect(r.values.get("studied@port=a / b|portType=c")!.value).toBe(1);
    expect(r.values.get("studied@port=a|portType=b / c")!.value).toBe(2);
  });

  it("a real category named '~' keeps its own key beside the collapsed bucket", () => {
    const { f, files } = withPorts(13);
    files[0].sheets[0].rows.push(["~", "بري", "مطابق", 1], ["~", "بري", "مطابق", 2], ["~", "بري", "مطابق", 3]);
    f.spec.model.measures[1] = { ...f.spec.model.measures[0], id: "matchRate" };
    const r = resolveFixture(f, files);
    expect(r.values.get('matchRate@port="~"')!.value).toBe(3);
    expect(r.values.get("matchRate@port~others")!.value).toBe(6);
    expect(r.issues).toEqual([]);
  });

  it("values containing '=' or '|' give distinct, injective keys", () => {
    expect(valueKey("m", { a: "x=y" }, [])).toBe('m@a="x=y"');
    expect(valueKey("m", { a: "x|b=y" }, [])).not.toBe(valueKey("m", { a: "x", b: "y" }, []));
    expect(valueKey("m", { a: "1" }, [])).not.toBe(valueKey("m", { a: 1 }, []));
    expect(valueKey("m", { a: "null" }, [])).not.toBe(valueKey("m", { a: null }, []));
    expect(valueKey("m", { a: "بحري" }, [])).toBe("m@a=بحري");
  });

  it("desc without sort.by reverses code point order", () => {
    const f = twoSlideFixture();
    f.spec.pages[1].visuals[1].sort = { by: "", dir: "desc" };
    expect(resolveFixture(f).visuals.find((v) => v.visualId === "p2bar")!.categories).toEqual(["جدة", "الحديثة", "البطحاء"]);
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
