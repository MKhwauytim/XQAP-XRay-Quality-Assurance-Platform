import JSZip from "jszip";
import type { RawFile } from "../data/types";
import { renderHtml } from "../html/renderHtml";
import { writePptx } from "../pptx/writePptx";
import { planWorkbook } from "../xlsx/planWorkbook";
import { writeXlsx } from "../xlsx/writeXlsx";
import { FIXTURE_FILES, twoSlideFixture } from "./twoSlide";
import type { Fixture } from "./twoSlide";
import { pipeline } from "./xlsxKit";

/** Test-only: every stage output the gates read, for the two-slide fixture or a modified copy. */
export async function buildOutputs(f: Fixture = twoSlideFixture(), files: RawFile[] = FIXTURE_FILES) {
  const p = pipeline(f, files);
  const plan = planWorkbook(p.files, f.spec, p.processed, p.values, p.doc);
  const opts = { title: f.spec.title, issuedAt: f.params.issuedAt };
  const out = await writeXlsx(plan, { files: p.files, spec: f.spec, processed: p.processed, values: p.values, doc: p.doc, theme: f.theme }, opts);
  const html = renderHtml(p.doc, f.theme, opts);
  const pptx = await writePptx(p.doc, f.theme, opts);
  return {
    doc: p.doc, html, pptx, xlsx: out.report, companion: out.companion, plan,
    processed: p.processed, values: p.values, theme: f.theme,
  };
}
export type Outputs = Awaited<ReturnType<typeof buildOutputs>>;

/** Rebuilds the outputs with one raw cell replaced: `rawCell` goes into the first data row's «العدد» cell. */
export async function writeFixtureWith(opts: { rawCell: string }): Promise<Outputs> {
  const files = structuredClone(FIXTURE_FILES);
  files[0].sheets[0].rows[0][3] = opts.rawCell;
  return buildOutputs(twoSlideFixture(), files);
}

async function rewrite(bytes: Uint8Array, edit: (z: JSZip) => Promise<void>): Promise<Uint8Array> {
  const z = await JSZip.loadAsync(bytes);
  await edit(z);
  return z.generateAsync({ type: "uint8array" });
}

/** Replaces the first occurrence of `from` in the first slide that holds it. */
export function editPptxText(pptx: Uint8Array, from: string, to: string): Promise<Uint8Array> {
  return rewrite(pptx, async (z) => {
    for (const name of Object.keys(z.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort()) {
      const xml = await z.files[name].async("string");
      if (xml.includes(from)) { z.file(name, xml.replace(from, to)); return; }
    }
    throw new Error(`${from} not in any slide`);
  });
}

export function dropPart(bytes: Uint8Array, part: string): Promise<Uint8Array> {
  return rewrite(bytes, async (z) => {
    if (z.file(part) === null) throw new Error(`${part} not in zip`);
    z.remove(part);
  });
}
