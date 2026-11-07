import { describe, expect, it } from "vitest";
import { buildOutputs, dropLastRow } from "../__fixtures__/gateKit";
import { twoDatasetsFixture } from "../__fixtures__/twoDatasets";
import { FIXTURE_FILES, twoSlideFixture } from "../__fixtures__/twoSlide";
import type { Fixture } from "../__fixtures__/twoSlide";
import type { RawFile } from "../data/types";
import { readProcessedRowCounts, zipParts } from "../gates/readBack";
import { runGates } from "../gates/runGates";
import { themeIssues } from "../html/renderHtml";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import { validateSpec } from "../spec/validate";
import { HEX_COLOR, hexDigits } from "../text";
import { issueReport } from "./issueReport";
import type { IssueResult } from "./issueReport";

const issue = (f: Fixture, files: RawFile[]): Promise<IssueResult> =>
  issueReport(f.spec, files, f.params, { theme: f.theme, measurer: createFixedAdvanceMeasurer() });

async function expectOk(f: Fixture, files: RawFile[]): Promise<void> {
  const r = await issue(f, files);
  if (!r.ok) throw new Error(r.message);
  expect(r.files.parityReport.passed).toBe(true);
}

describe("cross-dataset filters are refused, never dropped", () => {
  it("a KPI filtered on another dataset's column gives schema.invalid, not ok:true", async () => {
    const f = twoDatasetsFixture();
    f.spec.pages[0]!.visuals[1]!.filters = [{ field: "shipMonth", op: "eq", value: "2026-05" }];
    const r = await issue(f, f.files);
    expect(r.ok).toBe(false); if (r.ok) return;
    expect(r.issues[0]).toMatchObject({ rule: "schema.invalid", path: "pages[0].visuals[1].filters[0].field" });
  });

  it("a page filter on another dataset's column is refused for the visual that cannot use it", () => {
    const f = twoDatasetsFixture();
    f.spec.pages[0]!.filters = [{ field: "shipMonth", op: "eq", value: { param: "month" } }];
    const issues = validateSpec(f.spec, undefined, f.params);
    expect(issues).toContainEqual(expect.objectContaining({ rule: "schema.invalid", path: "pages[0].filters[0].field" }));
  });

  it("a well field from another dataset is refused", () => {
    const f = twoDatasetsFixture();
    f.spec.pages[1]!.visuals[0]!.wells.rows = [{ field: "portType" }];
    expect(validateSpec(f.spec, undefined, f.params)).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "pages[1].visuals[0].wells.rows[0]" }));
  });

  it("a report-level filter still applies only where its column exists", async () => {
    const f = twoDatasetsFixture();
    f.spec.filters = [{ field: "shipMonth", op: "eq", value: { param: "month" } }];
    await expectOk(f, f.files);
  });
});

describe("param digits never collide with figure digits", () => {
  it("month 2026-05 beside studied = 0 issues OK", async () => {
    const f = twoSlideFixture();
    f.spec.params.push({ id: "month", type: "month", required: true });
    f.params.values.month = "2026-05";
    f.spec.pages[0]!.visuals[0]!.text = "تقرير {{param:port}} لشهر {{param:month}}: المدروس {{measure:studied}}";
    const files = structuredClone(FIXTURE_FILES);
    for (const row of files[0]!.sheets[0]!.rows) row[2] = "";
    await expectOk(f, files);
  });
});

describe("reconcile counts rows, not filled cells", () => {
  it("a second dataset with an all-empty row issues OK", async () => {
    const f = twoDatasetsFixture();
    await expectOk(f, f.files);
    const o = await buildOutputs(f, f.files);
    expect(readProcessedRowCounts(o.xlsx, await zipParts(o.xlsx), o.plan).get("shipments")).toBe(46);
  });

  it("a trailing all-blank upload row issues OK", async () => {
    const f = twoSlideFixture();
    const files = structuredClone(FIXTURE_FILES);
    files[0]!.sheets[0]!.rows.push(["", null, "", null], [null, null, null, null]);
    await expectOk(f, files);
  });

  it("a really dropped processed row still blocks, also when it was the all-null row", async () => {
    const f = twoDatasetsFixture();
    const o = await buildOutputs(f, f.files);
    const sheet = o.plan.sheets.find((s) => s.kind === "processed" && s.datasetId === "shipments")!.name;
    const xlsx = await dropLastRow(o.xlsx, sheet);
    const rec = (await runGates({ ...o, xlsx })).issues.filter((i) => i.rule === "gate.reconcile");
    expect(rec).toContainEqual({ rule: "gate.reconcile", path: "shipments", detail: "processed sheet rows 45 != processed 46" });
  });
});

describe("one theme colour rule", () => {
  it("#B58B2 (five digits) fails closed everywhere", () => {
    expect(HEX_COLOR.test("#B58B2")).toBe(false);
    expect(hexDigits("#B58B2")).toBeUndefined();
    const f = twoSlideFixture();
    f.theme.ink.gold = "#B58B2";
    expect(themeIssues(f.theme)).toEqual([{ rule: "theme.invalid", path: "theme.ink.gold" }]);
    expect(hexDigits("#abc")).toBe("AABBCC");
    expect(hexDigits("#B58B2A")).toBe("B58B2A");
  });

  it("issueReport refuses a five-digit theme colour", async () => {
    const f = twoSlideFixture();
    f.theme.ink.gold = "#B58B2";
    const r = await issue(f, FIXTURE_FILES);
    expect(r.ok).toBe(false); if (r.ok) return;
    expect(r.issues[0]!.rule).toBe("theme.invalid");
  });
});

describe("a calc never overwrites a source column", () => {
  it("a calc whose columnId names a declared source column is schema.invalid", () => {
    const f = twoSlideFixture();
    f.spec.datasets[0]!.steps.push({ id: "c1", label: "حساب", kind: "calc", calc: { columnId: "status", type: "text", formula: "[المنفذ]" } });
    expect(validateSpec(f.spec, undefined, f.params)).toContainEqual(
      expect.objectContaining({ rule: "schema.invalid", path: "datasets[0].steps[2].calc.columnId" }));
  });

  it("a calc onto a declared virtual column, or an undeclared one, is accepted", () => {
    const f = twoSlideFixture();
    const d = f.spec.datasets[0]!;
    d.columns.push({ ...d.columns[3]!, id: "double", label: "الضعف", source: { file: "", sheet: "", header: "" } });
    d.steps.push(
      { id: "c1", label: "ضعف", kind: "calc", calc: { columnId: "double", type: "number", formula: "[العدد] * 2" } },
      { id: "c2", label: "نسخة", kind: "calc", calc: { columnId: "copy", type: "text", formula: "[المنفذ]" } },
    );
    expect(validateSpec(f.spec, undefined, f.params).filter((i) => i.path?.includes("calc"))).toEqual([]);
  });
});
