import { describe, expect, it } from "vitest";
import { twoDatasetsFixture } from "../__fixtures__/twoDatasets";
import { pipeline } from "../__fixtures__/xlsxKit";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import { OTHERS_LABEL } from "../resolve/resolve";
import { issueReport } from "./issueReport";

describe("second end-to-end fixture: two datasets, page and visual filters, continued table, others bucket", () => {
  it("issues through issueReport with every gate passing", async () => {
    const f = twoDatasetsFixture();
    const r = await issueReport(f.spec, f.files, f.params, { theme: f.theme, measurer: createFixedAdvanceMeasurer() });
    if (!r.ok) throw new Error(r.message);
    const { html, parityReport, lintReport } = r.files;
    expect(parityReport.passed).toBe(true);
    expect(parityReport.issues).toEqual([]);
    expect(lintReport.errors).toEqual([]);
    // The 40-row table does not fit one slide: it continues onto «(يتبع)» slides.
    expect(parityReport.counts.slides).toBeGreaterThan(3);
    expect(html).toContain("(يتبع)");
    expect(html).toContain("2026-05");
    expect(html).toContain(OTHERS_LABEL);
  });

  it("resolves the right figures: unfiltered text count, page-filtered table, visual-filtered bar with «أخرى»", () => {
    const f = twoDatasetsFixture();
    const { values, doc } = pipeline(f, f.files);
    const all = [...values.values()];
    // Page 1 has no filter: 45 non-blank shipment ports (40 in 2026-05, 5 in 2026-04); studies is the other dataset.
    expect(values.get("shipCount")?.display).toBe("45");
    expect(values.get("studied")?.display).toBe("10");
    // Page 2's month filter: 40 shipments of weight 1..40, total 820; the 5 x 1000 of 2026-04 left out.
    const filtered = all.filter((v) => v.provenance.filters.length === 1 && Object.keys(v.group).length === 0);
    expect(filtered.find((v) => v.measureId === "shipCount")?.display).toBe("40");
    expect(filtered.find((v) => v.measureId === "totalWeight")?.display).toBe("820");
    expect(all.filter((v) => v.measureId === "shipCount" && v.group.shipPort !== undefined && v.group.shipPort !== OTHERS_LABEL)).toHaveLength(40);
    // The bar's 40 categories: the top 11 by weight (40..30) and «أخرى» with ports 00..28 (weights 1..29, sum 435).
    const bar = doc.slides.flatMap((s) => s.boxes).find((b) => b.kind === "bar");
    expect(bar?.kind === "bar" && bar.categories).toEqual([...Array.from({ length: 11 }, (_v, i) => `منفذ ${29 + i}`), OTHERS_LABEL]);
    expect(all.find((v) => v.measureId === "totalWeight" && v.group.shipPort === OTHERS_LABEL)?.display).toBe("435");
    // The «(يتبع)» slides carry the rest of the 40 table rows.
    expect(doc.slides.filter((s) => s.title.endsWith("(يتبع)")).length).toBeGreaterThan(0);
  });
});
