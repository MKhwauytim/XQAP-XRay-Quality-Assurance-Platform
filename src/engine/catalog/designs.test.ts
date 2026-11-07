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

  it("demo text uses no long dash", () => {
    for (const d of activeDesigns()) {
      const json = JSON.stringify(demoInputs(d));
      expect(json.match(LONG_DASH)).toBeNull();
    }
  });
});
