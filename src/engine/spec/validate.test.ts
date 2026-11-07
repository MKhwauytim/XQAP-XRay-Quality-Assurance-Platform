import { describe, expect, it } from "vitest";
import { packWith, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { Fixture } from "../__fixtures__/twoSlide";
import type { MessageKey } from "../messages";
import { mergePackMeasures, validateSpec } from "./validate";

describe("validateSpec", () => {
  it("accepts the two-slide fixture", () => {
    const f = twoSlideFixture();
    expect(validateSpec(f.spec, undefined, f.params)).toEqual([]);
  });

  it.each([
    ["unknown measure in a well", (f: Fixture) => { f.spec.pages[0]!.visuals[1]!.wells.values![0] = { measure: "nope" }; }, "measure.unknown", "pages[0].visuals[1].wells.values[0]"],
    ["text field dropped in barChart values", (f: Fixture) => { f.spec.pages[1]!.visuals[1]!.wells.values = [{ field: "port" }]; }, "well.invalid", "pages[1].visuals[1].wells.values[0]"],
    ["two axis fields on a bar chart", (f: Fixture) => { f.spec.pages[1]!.visuals[1]!.wells.axis!.push({ field: "portType" }); }, "well.invalid", "pages[1].visuals[1].wells.axis"],
    ["typed number in text", (f: Fixture) => { f.spec.pages[0]!.visuals[0]!.text = "نسبة 92%"; }, "literal.number", "pages[0].visuals[0].text"],
    ["bad formula", (f: Fixture) => { f.spec.model.measures[0]!.formula = "sum("; }, "formula.syntax", "model.measures[0].formula"],
    ["frame outside grid", (f: Fixture) => { f.spec.pages[0]!.visuals[0]!.frame.col = 23; }, "schema.invalid", "pages[0].visuals[0].frame"],
    ["frame on the title row", (f: Fixture) => { f.spec.pages[0]!.visuals[0]!.frame.row = 0; }, "schema.invalid", "pages[0].visuals[0].frame"],
    ["font under 20px", (f: Fixture) => { f.spec.pages[0]!.visuals[0]!.format!.sizePx = 18; }, "schema.invalid", "pages[0].visuals[0].format.sizePx"],
    ["missing required param", (f: Fixture) => { delete f.params.values.port; }, "schema.invalid", "params.values.port"],
    ["too many pages", (f: Fixture) => { f.spec.pages = Array(201).fill(f.spec.pages[0]); }, "limit.slides", "pages"],
    ["issuedAt not ISO", (f: Fixture) => { f.params.issuedAt = "yesterday"; }, "schema.invalid", "params.issuedAt"],
    ["measure cycle", (f: Fixture) => {
      f.spec.model.measures[0]!.formula = "@matchRate + 1";
      f.spec.model.measures[1]!.formula = "@studied + 1";
    }, "schema.invalid", "model.measures[0].formula"],
    ["dataset table named like the source table", (f: Fixture) => { f.spec.datasets[0]!.label = "مصدر الأرقام"; }, "schema.invalid", "datasets[0].label"],
    ["calc formula using a measure reference", (f: Fixture) => {
      f.spec.datasets[0]!.steps.push({ id: "s3", label: "حساب", kind: "calc", calc: { columnId: "x", type: "number", formula: "@studied" } });
    }, "formula.notAllowed", "datasets[0].steps[2].calc.formula"],
    ["too many visuals on a page", (f: Fixture) => { f.spec.pages[0]!.visuals = Array(41).fill(f.spec.pages[0]!.visuals[1]); }, "limit.visuals", "pages[0].visuals"],
  ] as [string, (f: Fixture) => void, MessageKey, string][])("rejects %s with its location", (_n, mutate, rule, path) => {
    const f = twoSlideFixture();
    mutate(f);
    expect(validateSpec(f.spec, undefined, f.params)).toContainEqual(expect.objectContaining({ rule, path }));
  });

  it("names the cycle path in the detail", () => {
    const f = twoSlideFixture();
    f.spec.model.measures[0]!.formula = "@matchRate + 1";
    f.spec.model.measures[1]!.formula = "@studied + 1";
    const hit = validateSpec(f.spec, undefined, f.params).find((i) => i.detail?.startsWith("measure cycle"));
    expect(hit?.detail).toBe("measure cycle: studied > matchRate > studied");
  });

  it("a spec with no pack is valid (pack mapping is optional)", () => {
    const f = twoSlideFixture();
    expect(f.spec.model.packId).toBeUndefined();
    expect(validateSpec(f.spec, undefined, f.params)).toEqual([]);
  });

  it("pack measures referenced by the spec are copied into model.measures", () => {
    const f = twoSlideFixture();
    const pack = packWith({ id: "packCount", formula: "count([الحالة])" });
    f.spec.pages[0]!.visuals[1]!.wells.values!.push({ measure: "packCount" });
    const merged = mergePackMeasures(f.spec, pack);
    expect(merged.model.measures.map((m) => m.id)).toContain("packCount");
    expect(merged.model.packId).toBe(pack.packId);
    expect(f.spec.model.measures.map((m) => m.id)).not.toContain("packCount");
    expect(validateSpec(merged, pack, f.params)).toEqual([]);
  });

  it("does not copy pack measures the spec never references", () => {
    const f = twoSlideFixture();
    const merged = mergePackMeasures(f.spec, packWith({ id: "packCount", formula: "count([الحالة])" }));
    expect(merged.model.measures.map((m) => m.id)).toEqual(["studied", "matchRate"]);
  });

  it("a spec measure sharing an id with a different pack measure is schema.invalid", () => {
    const f = twoSlideFixture();
    const pack = packWith({ id: "studied", formula: "count([العدد])" });
    expect(validateSpec(f.spec, pack, f.params)).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "model.measures[0].id" }),
    );
  });
});

type Anyobj = Record<string, unknown>;
const run = (spec: unknown, params?: unknown) =>
  validateSpec(spec as Fixture["spec"], undefined, params as Fixture["params"]);

function nodePaths(v: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (typeof v !== "object" || v === null) return [];
  const out: (string | number)[][] = [];
  for (const k of Object.keys(v)) {
    const p = [...prefix, Array.isArray(v) ? Number(k) : k];
    out.push(p, ...nodePaths((v as Anyobj)[k], p));
  }
  return out;
}

function mutateAt(root: Anyobj, path: (string | number)[], f: (parent: Anyobj, key: string | number) => void): void {
  let cur: Anyobj = root;
  for (const k of path.slice(0, -1)) cur = cur[k as string] as Anyobj;
  f(cur, path[path.length - 1]!);
}

describe("validateSpec as a trust boundary", () => {
  it.each([[null], [{}], [42], ["text"], [[]]])("does not throw on %j and reports schema.invalid", (bad) => {
    const issues = run(bad, twoSlideFixture().params);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.rule === "schema.invalid" && typeof i.path === "string")).toBe(true);
  });

  it("each missing root key is reported at that key", () => {
    const keys = ["schemaVersion", "reportId", "title", "theme", "datasets", "model", "params", "pages"];
    for (const k of keys) {
      const f = twoSlideFixture();
      delete (f.spec as unknown as Anyobj)[k];
      const issues = run(f.spec, f.params);
      expect(issues, k).toContainEqual(expect.objectContaining({ rule: "schema.invalid", path: k }));
    }
  });

  it("no throw when any node is deleted or replaced by null or a number", () => {
    const base = twoSlideFixture();
    const paths = nodePaths(base.spec);
    expect(paths.length).toBeGreaterThan(100);
    for (const p of paths) {
      for (const mode of ["delete", "null", "number"]) {
        const f = twoSlideFixture();
        mutateAt(f.spec as unknown as Anyobj, p, (parent, key) => {
          if (mode === "delete") delete parent[key as string];
          else parent[key as string] = mode === "null" ? null : 7;
        });
        expect(() => run(f.spec, f.params), `${mode} ${p.join(".")}`).not.toThrow();
      }
    }
  });

  it("reports nested wrong types with their path", () => {
    const f = twoSlideFixture();
    const v = f.spec.pages[0]!.visuals[0]! as unknown as Anyobj;
    v.wells = null;
    (f.spec.pages[0]!.visuals[1]! as unknown as Anyobj).frame = "x";
    (f.spec.pages[1]!.visuals[0]! as unknown as Anyobj).sort = { by: "studied", dir: "up" };
    const issues = run(f.spec, f.params);
    expect(issues).toContainEqual(expect.objectContaining({ path: "pages[0].visuals[0].wells" }));
    expect(issues).toContainEqual(expect.objectContaining({ path: "pages[0].visuals[1].frame" }));
    expect(issues).toContainEqual(expect.objectContaining({ path: "pages[1].visuals[0].sort.dir" }));
  });

  it.each([
    ["tone", (v: Anyobj) => { v.format = { tone: "loud" }; }, "pages[0].visuals[0].format.tone"],
    ["weight", (v: Anyobj) => { v.format = { tone: "neutral", weight: 500 }; }, "pages[0].visuals[0].format.weight"],
    ["limit.others", (v: Anyobj) => { v.limit = { topN: 3, others: "yes" }; }, "pages[0].visuals[0].limit.others"],
  ])("rejects a bad %s", (_n, mutate, path) => {
    const f = twoSlideFixture();
    mutate(f.spec.pages[0]!.visuals[0]! as unknown as Anyobj);
    expect(run(f.spec, f.params)).toContainEqual(expect.objectContaining({ rule: "schema.invalid", path }));
  });

  it("rejects a bad measure format kind and param type", () => {
    const f = twoSlideFixture();
    (f.spec.model.measures[0]!.format as unknown as Anyobj).kind = "money";
    (f.spec.params[0] as unknown as Anyobj).type = "date";
    const issues = run(f.spec, f.params);
    expect(issues).toContainEqual(expect.objectContaining({ path: "model.measures[0].format.kind" }));
    expect(issues).toContainEqual(expect.objectContaining({ path: "params[0].type" }));
  });

  it("checks param values against their declared type and month format", () => {
    const f = twoSlideFixture();
    f.spec.params.push({ id: "m", type: "month", required: true }, { id: "n", type: "number", required: true });
    f.params.values.m = "2026-13";
    f.params.values.n = "5";
    const issues = run(f.spec, f.params);
    expect(issues).toContainEqual(expect.objectContaining({ path: "params.values.m", detail: "expected month YYYY-MM" }));
    expect(issues).toContainEqual(expect.objectContaining({ path: "params.values.n", detail: "expected number" }));
    f.params.values.m = "2026-05";
    f.params.values.n = 5;
    expect(run(f.spec, f.params)).toEqual([]);
  });

  it("rejects an impossible calendar date in issuedAt", () => {
    const f = twoSlideFixture();
    f.params.issuedAt = "2026-02-31T00:00:00Z";
    expect(run(f.spec, f.params)).toContainEqual(expect.objectContaining({ path: "params.issuedAt" }));
  });

  it("rejects a column id repeated across datasets as ambiguous", () => {
    const f = twoSlideFixture();
    const second = structuredClone(f.spec.datasets[0]!);
    second.id = "other";
    f.spec.datasets.push(second);
    const issues = run(f.spec, f.params);
    expect(issues).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "datasets[1].columns[0].id", detail: "ambiguous field id" }),
    );
  });

  it("rejects a packId that differs from the supplied pack", () => {
    const f = twoSlideFixture();
    f.spec.model.packId = "other";
    const pack = packWith({ id: "packCount", formula: "count([الحالة])" });
    expect(validateSpec(f.spec, pack, f.params)).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "model.packId" }),
    );
  });

  it("rejects an unknown param in a filter value and in text", () => {
    const f = twoSlideFixture();
    f.spec.pages[0]!.filters = [{ field: "port", op: "eq", value: { param: "ghost" } }];
    f.spec.pages[0]!.visuals[0]!.text = "تقرير {{param:ghost}}";
    const issues = run(f.spec, f.params);
    expect(issues).toContainEqual(expect.objectContaining({ path: "pages[0].filters[0].value" }));
    expect(issues).toContainEqual(expect.objectContaining({ path: "pages[0].visuals[0].text", detail: "unknown param ghost" }));
  });

  it("rejects a malformed placeholder", () => {
    const f = twoSlideFixture();
    f.spec.pages[0]!.visuals[0]!.text = "تقرير {{foo}}";
    expect(run(f.spec, f.params)).toContainEqual(
      expect.objectContaining({ path: "pages[0].visuals[0].text", detail: "bad placeholder {{foo}}" }),
    );
  });

  it("rejects duplicate visual, page and measure ids", () => {
    const f = twoSlideFixture();
    f.spec.pages[0]!.visuals[1]!.visualId = "p1text";
    f.spec.pages[1]!.pageId = "p1";
    f.spec.model.measures[1]!.id = "studied";
    const issues = run(f.spec, f.params);
    expect(issues).toContainEqual(expect.objectContaining({ path: "pages[0].visuals[1].visualId" }));
    expect(issues).toContainEqual(expect.objectContaining({ path: "pages[1].pageId" }));
    expect(issues).toContainEqual(expect.objectContaining({ path: "model.measures[1].id" }));
  });

  it("copies pack measures transitively", () => {
    const f = twoSlideFixture();
    const pack = packWith({ id: "packTop", formula: "@packBase + 1" });
    pack.measures.push({ ...pack.measures[0]!, id: "packBase", formula: "count([الحالة])" });
    f.spec.pages[0]!.visuals[1]!.wells.values!.push({ measure: "packTop" });
    const merged = mergePackMeasures(f.spec, pack);
    expect(merged.model.measures.map((m) => m.id).sort()).toEqual(["matchRate", "packBase", "packTop", "studied"]);
    expect(validateSpec(merged, pack, f.params)).toEqual([]);
  });

  it("rejects a role the visual does not allow", () => {
    const f = twoSlideFixture();
    f.spec.pages[1]!.visuals[0]!.wells.legend = [{ field: "port" }];
    expect(run(f.spec, f.params)).toContainEqual(
      expect.objectContaining({ rule: "well.invalid", path: "pages[1].visuals[0].wells.legend" }),
    );
  });

  it("a calc output column is usable in a well, declared or not", () => {
    for (const declared of [false, true]) {
      const f = twoSlideFixture();
      const ds = f.spec.datasets[0]!;
      ds.steps.push({ id: "s3", label: "حساب", kind: "calc", calc: { columnId: "portCopy", type: "text", formula: "port" } });
      if (declared) {
        ds.columns.push({ source: { file: "", sheet: "", header: "" }, id: "portCopy", label: "نسخة", type: "text", role: "dimension", level: "nominal" });
      }
      f.spec.pages[1]!.visuals[1]!.wells.axis = [{ field: "portCopy" }];
      expect(run(f.spec, f.params), String(declared)).toEqual([]);
    }
  });
});
