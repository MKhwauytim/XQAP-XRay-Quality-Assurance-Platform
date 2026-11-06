import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planWorkbook } from "../xlsx/planWorkbook";
import { writeXlsx } from "../xlsx/writeXlsx";
import { pipeline } from "./xlsxKit";

/**
 * Writes the fixture's report and companion workbooks so they can be opened in real Excel.
 * Runs only when XLSX_OUT is set:
 *   $env:XLSX_OUT = "C:\some\folder"; npx vitest run src/engine/__fixtures__/writeFixtureWorkbooks.test.ts
 */
const outDir = process.env.XLSX_OUT;

describe.skipIf(outDir === undefined || outDir === "")("fixture workbooks to XLSX_OUT", () => {
  it("writes both files", async () => {
    const p = pipeline();
    const plan = planWorkbook(p.files, p.f.spec, p.processed, p.values, p.doc);
    const out = await writeXlsx(plan, { files: p.files, spec: p.f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: p.f.theme }, { title: p.f.spec.title, issuedAt: p.f.params.issuedAt });
    const dir = outDir ?? "";
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, out.reportFileName), out.report);
    writeFileSync(join(dir, out.companionFileName), out.companion);
    expect(out.report.byteLength).toBeGreaterThan(0);
  });
});
