import type { EngineIssue } from "../errors";
import { UNBOXED } from "./readBack";
import type { ReadBox } from "./readBack";

type Source = readonly [name: string, boxes: Map<number, ReadBox[]>];

function comparePair(a: Source, b: Source, tolerancePx: number, out: EngineIssue[]): void {
  const issue = (page: number, path: string, detail: string): void => { out.push({ rule: "gate.layoutParity", page, path, detail }); };
  const slides = [...new Set([...a[1].keys(), ...b[1].keys()])].filter((s) => s > 0).sort((x, y) => x - y);
  for (const page of slides) {
    const ma = new Map((a[1].get(page) ?? []).filter((x) => x.id !== UNBOXED).map((x) => [x.id, x]));
    const mb = new Map((b[1].get(page) ?? []).filter((x) => x.id !== UNBOXED).map((x) => [x.id, x]));
    for (const [id, ba] of ma) {
      const bb = mb.get(id);
      if (bb === undefined) { issue(page, id, `missing in ${b[0]}`); continue; }
      if (Math.abs(ba.x - bb.x) > tolerancePx || Math.abs(ba.y - bb.y) > tolerancePx) {
        issue(page, id, `top-left ${a[0]} (${ba.x}, ${ba.y}) ${b[0]} (${bb.x}, ${bb.y})`);
      }
      if (ba.lines !== bb.lines) issue(page, id, `lines ${a[0]} ${ba.lines} ${b[0]} ${bb.lines}`);
    }
    for (const id of mb.keys()) if (!ma.has(id)) issue(page, id, `missing in ${a[0]}`);
  }
}

/**
 * M2 / decision 8: per box and table cell, equal line count and top-left within `tolerancePx`. HTML is compared
 * with PPTX, and, when the layout is given, each read-back with the layout itself, so a drift both writers share
 * is still caught.
 */
export function checkLayoutParity(
  html: Map<number, ReadBox[]>, pptx: Map<number, ReadBox[]>, tolerancePx = 2, layout?: Map<number, ReadBox[]>,
): EngineIssue[] {
  const out: EngineIssue[] = [];
  const h: Source = ["HTML", html];
  const p: Source = ["PPTX", pptx];
  comparePair(h, p, tolerancePx, out);
  if (layout !== undefined) {
    const l: Source = ["layout", layout];
    comparePair(l, h, tolerancePx, out);
    comparePair(l, p, tolerancePx, out);
  }
  return out;
}
