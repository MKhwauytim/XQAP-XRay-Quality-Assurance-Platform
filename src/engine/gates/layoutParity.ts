import type { EngineIssue } from "../errors";
import type { ReadBox } from "./readBack";

/** M2 / decision 8: per box and table cell, equal line count and top-left within `tolerancePx` between HTML and PPTX. */
export function checkLayoutParity(html: Map<number, ReadBox[]>, pptx: Map<number, ReadBox[]>, tolerancePx = 2): EngineIssue[] {
  const out: EngineIssue[] = [];
  const issue = (page: number, path: string, detail: string): void => { out.push({ rule: "gate.layoutParity", page, path, detail }); };
  const slides = [...new Set([...html.keys(), ...pptx.keys()])].sort((a, b) => a - b);
  for (const page of slides) {
    const h = new Map((html.get(page) ?? []).map((b) => [b.id, b]));
    const p = new Map((pptx.get(page) ?? []).map((b) => [b.id, b]));
    for (const [id, hb] of h) {
      const pb = p.get(id);
      if (pb === undefined) { issue(page, id, "missing in PPTX"); continue; }
      const dx = Math.abs(hb.x - pb.x);
      const dy = Math.abs(hb.y - pb.y);
      if (dx > tolerancePx || dy > tolerancePx) issue(page, id, `top-left HTML (${hb.x}, ${hb.y}) PPTX (${pb.x}, ${pb.y})`);
      if (hb.lines !== pb.lines) issue(page, id, `lines HTML ${hb.lines} PPTX ${pb.lines}`);
    }
    for (const id of p.keys()) if (!h.has(id)) issue(page, id, "missing in HTML");
  }
  return out;
}
