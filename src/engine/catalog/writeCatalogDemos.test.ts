import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIXTURE_THEME } from "../__fixtures__/twoSlide";
import { renderHtml } from "../html/renderHtml";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import { renderDesignDemo } from "./designs/demo";
import { activeDesigns } from "./registry";

/**
 * Writes each active design's demo HTML as d0N.html for the lookbook check. Runs only when CATALOG_OUT is set:
 *   $env:CATALOG_OUT = "C:\some\folder"; npx vitest run src/engine/catalog/writeCatalogDemos.test.ts
 */
const outDir = process.env.CATALOG_OUT;

describe.skipIf(outDir === undefined || outDir === "")("catalog demos to CATALOG_OUT", () => {
  it("writes one HTML file per active design", () => {
    const dir = outDir ?? "";
    mkdirSync(dir, { recursive: true });
    for (const d of activeDesigns()) {
      const doc = renderDesignDemo(d, { theme: FIXTURE_THEME, measurer: createFixedAdvanceMeasurer() });
      const html = renderHtml(doc, FIXTURE_THEME, { title: d.nameAr });
      writeFileSync(join(dir, `d${String(d.number).padStart(2, "0")}.html`), html);
      expect(html.length).toBeGreaterThan(0);
    }
  });
});
