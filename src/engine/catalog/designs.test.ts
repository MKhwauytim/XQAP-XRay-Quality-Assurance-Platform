import { describe, expect, it } from "vitest";
import { FIXTURE_THEME } from "../__fixtures__/twoSlide";
import { issueReport } from "../issue/issueReport";
import type { IssueEnv } from "../issue/issueReport";
import { catalogEntryGate } from "../lint/designLint";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import type { LayoutDoc } from "../layout/types";
import { buildSpecFromPicks } from "./bind";
import { DEMO_NOTE, DEMO_PARAMS, demoInputs, renderDesignDemo } from "./designs/demo";
import { activeDesigns } from "./registry";
import { LONG_DASH } from "../text";

const env = (): IssueEnv => ({ theme: structuredClone(FIXTURE_THEME), measurer: createFixedAdvanceMeasurer() });

const shownText = (doc: LayoutDoc): string[] =>
  doc.slides.flatMap((s) => s.boxes.flatMap((b) => (b.kind === "text" ? [b.lines.map((l) => l.map((r) => r.text).join("")).join(" ")] : [])));

const byNumber = (n: number) => {
  const d = activeDesigns().find((x) => x.number === n);
  if (d === undefined) throw new Error(`no design ${n}`);
  return d;
};

describe("catalog designs", () => {
  it("has designs 1 to 5 active", () => {
    expect(activeDesigns().map((d) => d.number)).toEqual([1, 2, 3, 4, 5]);
  });

  it("every active design passes the catalog entry gate", () => {
    for (const d of activeDesigns()) {
      const doc = renderDesignDemo(d, env());
      const gate = catalogEntryGate(doc, FIXTURE_THEME, d.overrules);
      expect(gate.issues, `design ${d.number}`).toEqual([]);
      expect(gate.ok).toBe(true);
      for (const s of doc.slides) {
        const texts = s.boxes.flatMap((b) => (b.kind === "text" ? [b.lines.map((l) => l.map((r) => r.text).join("")).join("")] : []));
        expect(texts, `design ${d.number} slide ${s.index}`).toContain(DEMO_NOTE);
      }
      expect(shownText(doc).join(" ")).toContain("بيانات توضيحية");
    }
  });

  it("every active design issues end to end with demo data", async () => {
    for (const d of activeDesigns()) {
      const { base, binding, files } = demoInputs(d);
      const built = buildSpecFromPicks([d.number], [binding], base);
      if (!built.ok) throw new Error(`design ${d.number}: ${JSON.stringify(built.issues)}`);
      const r = await issueReport(built.spec, files, DEMO_PARAMS, env());
      if (!r.ok) throw new Error(`design ${d.number}: ${r.message}`);
      expect(r.ok).toBe(true);
    }
  });

  it("a title figure is resolved, shown and traced", () => {
    const d = activeDesigns().find((x) => x.number === 3)!;
    const doc = renderDesignDemo(d, env());
    expect(doc.slides[0].title).not.toContain("{{");
    expect(doc.figures.some((f) => f.boxId === "s1-title")).toBe(true);
  });

  it("design 4 paginates a long table", () => {
    const d = activeDesigns().find((x) => x.number === 4)!;
    const doc = renderDesignDemo(d, env(), { repeat: 3 });
    expect(doc.slides.length).toBeGreaterThan(1);
    expect(catalogEntryGate(doc, FIXTURE_THEME, d.overrules).issues).toEqual([]);
  });

  it("design 4 carries the note on every continued slide", () => {
    const doc = renderDesignDemo(byNumber(4), env(), { repeat: 3 });
    expect(doc.slides.length).toBeGreaterThan(1);
    for (const s of doc.slides) expect(shownText({ ...doc, slides: [s] }), `slide ${s.index}`).toContain(DEMO_NOTE);
  });

  it("bars in designs 3 and 5 rank by value, highest first", () => {
    for (const n of [3, 5]) {
      const bar = renderDesignDemo(byNumber(n), env()).slides[0].boxes.find((b) => b.kind === "bar");
      if (bar?.kind !== "bar") throw new Error(`design ${n} has no bar`);
      const vals = bar.values.map((v) => v ?? 0);
      expect(vals, `design ${n}`).toEqual([...vals].sort((a, b) => b - a));
    }
  });

  it("design 4 rows run in calendar month order", () => {
    const table = renderDesignDemo(byNumber(4), env()).slides[0].boxes.find((b) => b.kind === "table");
    if (table?.kind !== "table") throw new Error("no table");
    const months = table.rows.map((r) => r[0].lines.map((l) => l.map((x) => x.text).join("")).join("")).filter((t) => t !== "الإجمالي");
    expect([...new Set(months)]).toEqual(["يناير", "فبراير", "مارس"]);
  });

  it("design 1 has a single title text, its heading", () => {
    const doc = renderDesignDemo(byNumber(1), env());
    expect(doc.slides[0].boxes.some((b) => b.id === "s1-title")).toBe(false);
    expect(doc.slides[0].boxes.some((b) => b.kind === "rule")).toBe(false);
    expect(shownText(doc).filter((t) => t.includes("نتائج المطابقة في المنافذ"))).toHaveLength(1);
  });

  it("titles of designs 2 and 5 state a figure the band does not show", () => {
    for (const n of [2, 5]) {
      const doc = renderDesignDemo(byNumber(n), env());
      const titleKeys = doc.figures.filter((f) => f.boxId === "s1-title").map((f) => f.valueKey);
      const bandKeys = doc.figures.filter((f) => f.boxId !== "s1-title").map((f) => f.valueKey);
      expect(titleKeys.length).toBeGreaterThan(0);
      for (const k of titleKeys) expect(bandKeys, `design ${n}`).not.toContain(k);
    }
  });

  it("demo text uses no long dash", () => {
    for (const d of activeDesigns()) {
      const json = JSON.stringify(demoInputs(d));
      expect(json.match(LONG_DASH)).toBeNull();
    }
  });
});
