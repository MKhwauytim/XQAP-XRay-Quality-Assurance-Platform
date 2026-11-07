import { createHash } from "node:crypto";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { applySteps } from "../data/processing";
import type { ProcessedDataset } from "../data/processing";
import { profileColumns } from "../data/profile";
import type { ColumnProfile, RawFile } from "../data/types";
import { typeDataset } from "../data/typing";
import { layoutReport } from "../layout/layoutReport";
import { createFixedAdvanceMeasurer } from "../layout/measure";
import { resolveVisuals } from "../resolve/resolve";
import { FIXTURE_FILES, twoSlideFixture } from "./twoSlide";
import type { Fixture } from "./twoSlide";

/** Test-only: the fixture through the pipeline up to the workbook, and read-back helpers. */
export function pipeline(f: Fixture = twoSlideFixture(), files: RawFile[] = FIXTURE_FILES) {
  const processed = new Map<string, ProcessedDataset>();
  const profiles = new Map<string, ColumnProfile[]>();
  f.spec.datasets.forEach((def, i) => {
    const { data } = typeDataset(def, files);
    profiles.set(def.id, profileColumns(data, def));
    processed.set(def.id, applySteps(data, def, f.params, i));
  });
  const r = resolveVisuals(f.spec, processed, profiles, f.params);
  const doc = layoutReport(f.spec, r.visuals, r.values, f.params, f.theme, createFixedAdvanceMeasurer());
  return { f, files, processed, values: r.values, doc };
}

export const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

export function sheetAoa(bytes: Uint8Array, name: string): unknown[][] {
  const wb = XLSX.read(bytes, { type: "array" });
  const ws = wb.Sheets[name];
  if (ws === undefined) throw new Error(`no sheet ${name}; have ${wb.SheetNames.join(" | ")}`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: true });
}

export function sheetFormulas(bytes: Uint8Array, name: string): string[] {
  const ws = XLSX.read(bytes, { type: "array", cellFormula: true }).Sheets[name];
  return Object.keys(ws ?? {}).filter((k) => !k.startsWith("!")).flatMap((k) => (ws?.[k]?.f ? [String(ws[k].f)] : []));
}

export async function unzip(bytes: Uint8Array) {
  const z = await JSZip.loadAsync(bytes);
  const texts = new Map<string, string>();
  for (const n of Object.keys(z.files)) if (!z.files[n].dir) texts.set(n, await z.files[n].async("string"));
  return {
    names: [...texts.keys()],
    list: (re: RegExp) => [...texts.keys()].filter((n) => re.test(n)).sort(),
    text: (p: string) => texts.get(p) ?? "",
  };
}
