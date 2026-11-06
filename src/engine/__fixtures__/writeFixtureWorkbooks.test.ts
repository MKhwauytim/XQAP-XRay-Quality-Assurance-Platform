import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planWorkbook } from "../xlsx/planWorkbook";
import { writeXlsx } from "../xlsx/writeXlsx";
import type { PackageStage } from "../xlsx/writeXlsx";
import { pipeline } from "./xlsxKit";

/**
 * Writes the fixture's report and companion workbooks, plus staged variants for bisecting in real Excel.
 * Runs only when XLSX_OUT is set:
 *   $env:XLSX_OUT = "C:\some\folder"; npx vitest run src/engine/__fixtures__/writeFixtureWorkbooks.test.ts
 * Variants: v-a SheetJS only, v-a2 v-a through the dated re-zip only, v-b + clean-up, v-c + dated re-zip, v-d + styles/views/separators,
 * v-e + tables, v-f everything (pivots and caches), each as -report.xlsx and -companion.xlsx.
 */
const outDir = process.env.XLSX_OUT;
const STAGES: [string, PackageStage | undefined][] = [["a", "sheetjs"], ["a2", "rezip"], ["b", "clean"], ["c", "zip"], ["d", "styled"], ["e", "tables"], ["f", undefined]];

describe.skipIf(outDir === undefined || outDir === "")("fixture workbooks to XLSX_OUT", () => {
  it("writes the final files and every staged variant", async () => {
    const p = pipeline();
    const plan = planWorkbook(p.files, p.f.spec, p.processed, p.values, p.doc);
    const input = { files: p.files, spec: p.f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: p.f.theme };
    const dir = outDir ?? "";
    mkdirSync(dir, { recursive: true });
    for (const [tag, stopAfter] of STAGES) {
      const out = await writeXlsx(plan, input, { title: p.f.spec.title, issuedAt: p.f.params.issuedAt, stopAfter });
      writeFileSync(join(dir, `v-${tag}-report.xlsx`), out.report);
      writeFileSync(join(dir, `v-${tag}-companion.xlsx`), out.companion);
      if (stopAfter === undefined) {
        writeFileSync(join(dir, out.reportFileName), out.report);
        writeFileSync(join(dir, out.companionFileName), out.companion);
      }
      expect(out.report.byteLength).toBeGreaterThan(0);
    }
  });
});
