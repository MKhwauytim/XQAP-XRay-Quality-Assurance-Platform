import { describe, expect, it } from "vitest";
import { FIXTURE_DATASET, FIXTURE_FILES, packWith, twoSlideFixture } from "../__fixtures__/twoSlide";
import { profileColumns } from "../data/profile";
import { typeDataset } from "../data/typing";
import type { EngineIssue } from "../errors";
import { mergePackMeasures } from "../spec/validate";
import { ENGINE_VERSION } from "../version";
import { buildRecipe, checkSources, validateRecipe } from "./recipe";
import type { Recipe } from "./recipe";

function makeInput() {
  const fx = twoSlideFixture();
  const { data } = typeDataset(FIXTURE_DATASET, FIXTURE_FILES);
  return {
    files: structuredClone(FIXTURE_FILES),
    spec: fx.spec,
    params: { ...fx.params, messages: { "recipe.invalid": "نص مخصص" } },
    profiles: new Map([["studies", profileColumns(data, FIXTURE_DATASET)]]),
  };
}
const input = makeInput();

describe("buildRecipe", () => {
  it("holds names, hashes, column types, steps, measures, spec, params and engine version", () => {
    const r = JSON.parse(buildRecipe(input));
    expect(r).toMatchObject({ recipeVersion: 1, engineVersion: ENGINE_VERSION, params: { issuedAt: input.params.issuedAt } });
    expect(r.sources[0]).toMatchObject({ fileName: "studies.xlsx", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(r.sources[0].sheets[0]).toMatchObject({ rowCount: 12, headers: ["المنفذ", "نوع المنفذ", "الحالة", "العدد"] });
    expect(r.columns.studies.map((c: { id: string; type: string }) => `${c.id}:${c.type}`)).toEqual(["port:text", "portType:text", "status:text", "count:number"]);
    expect(r.steps.studies.map((s: { id: string }) => s.id)).toEqual(["s1", "s2"]);
    expect(r.measures.map((m: { id: string }) => m.id)).toEqual(["studied", "matchRate"]);
    expect(r.spec.reportId).toBe("twoSlide");
    expect(r.params.values).toEqual({ port: "جدة" });
    expect(r.params).not.toHaveProperty("messages");
  });

  it("holds no row data and no raw error values", () => {
    const s = buildRecipe(input);
    expect(s).not.toContain("غير متوفر");
    expect(s).not.toContain("12,5");
    expect(s).not.toContain("sampleErrors");
    expect(JSON.parse(s).profiles.studies.find((p: { columnId: string }) => p.columnId === "count")).toMatchObject({ errors: 2, nulls: 1 });
  });

  it("holds no distinctive cell value from any row, however unusual", () => {
    const i = makeInput();
    i.files[0]!.sheets[0]!.rows.push(["ZXQ-port-9917", "بري", "مطابق", "bad-ZXQ-5521"]);
    const { data } = typeDataset(FIXTURE_DATASET, i.files);
    i.profiles = new Map([["studies", profileColumns(data, FIXTURE_DATASET)]]);
    expect(i.profiles.get("studies")!.some((p) => p.sampleErrors.some((e) => e.includes("ZXQ")))).toBe(true);
    const s = buildRecipe(i);
    expect(s).not.toContain("ZXQ");
    expect(JSON.parse(s).sources[0].sheets[0].rowCount).toBe(13);
  });

  it("is canonical: the same input gives the same string", () => {
    const a = buildRecipe(input);
    expect(buildRecipe(structuredClone(input))).toBe(a);
    expect(a.endsWith("\n")).toBe(true);
    expect(a).not.toContain("\r");
    const keys = Object.keys(JSON.parse(a));
    expect(keys).toEqual([...keys].sort());
  });

  it("copies pack measures into the spec and the measures list, with the pack id (C23)", () => {
    const pack = packWith({ id: "packRate", formula: "count([الحالة])" });
    const i = makeInput();
    i.spec.pages[0]!.visuals[1]!.wells.values!.push({ measure: "packRate" });
    i.spec = mergePackMeasures(i.spec, pack);
    const r = JSON.parse(buildRecipe(i));
    expect(r.spec.model.packId).toBe("testPack");
    expect(r.measures.map((m: { id: string }) => m.id)).toContain("packRate");
    expect(r.spec.model.measures.map((m: { id: string }) => m.id)).toContain("packRate");
  });
});

describe("validateRecipe", () => {
  it("accepts what buildRecipe wrote", () => {
    const r = validateRecipe(buildRecipe(input));
    expect(r.ok).toBe(true);
    expect((r as { recipe: Recipe }).recipe.engineVersion).toBe(ENGINE_VERSION);
  });

  it("rejects malformed JSON and a wrong recipeVersion with a path", () => {
    const m = validateRecipe("{");
    expect(m.ok).toBe(false);
    expect((m as { issues: EngineIssue[] }).issues[0]).toMatchObject({ rule: "recipe.invalid", path: "" });
    const r = validateRecipe(JSON.stringify({ ...JSON.parse(buildRecipe(input)), recipeVersion: 2 }));
    expect(r.ok).toBe(false);
    expect((r as { issues: EngineIssue[] }).issues[0]).toMatchObject({ rule: "recipe.invalid", path: "recipeVersion" });
  });

  it("rejects a bad hash and a missing section with located issues", () => {
    const base = JSON.parse(buildRecipe(input));
    base.sources[0].sha256 = "xyz";
    delete base.steps;
    const r = validateRecipe(JSON.stringify(base)) as { ok: false; issues: EngineIssue[] };
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.path)).toEqual(["sources[0].sha256", "steps"]);
  });

  it("rejects an embedded spec that fails validation, with the spec path", () => {
    const base = JSON.parse(buildRecipe(input));
    base.spec.pages[0].visuals[1].wells.values[0] = { measure: "nope" };
    const r = validateRecipe(JSON.stringify(base)) as { ok: false; issues: EngineIssue[] };
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.every((i) => i.path?.startsWith("spec"))).toBe(true);
  });
});

describe("checkSources", () => {
  const rec = (validateRecipe(buildRecipe(input)) as { recipe: Recipe }).recipe;

  it("flags a changed hash with the file name", () => {
    expect(checkSources(rec, input.files)).toEqual([]);
    const changed = [{ ...input.files[0]!, bytesSha256: "0".repeat(64) }];
    expect(checkSources(rec, changed)[0]).toMatchObject({ rule: "recipe.hashMismatch" });
    expect(checkSources(rec, changed)[0]!.detail).toContain("studies.xlsx");
  });

  it("flags a missing file by name", () => {
    expect(checkSources(rec, [])).toEqual([{ rule: "recipe.hashMismatch", path: "studies.xlsx", detail: "studies.xlsx: file missing" }]);
  });
});
