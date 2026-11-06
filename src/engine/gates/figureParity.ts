import type { EngineIssue } from "../errors";
import type { LayoutDoc } from "../layout/types";
import type { ResolvedValue } from "../resolve/resolve";
import type { ReadBox } from "./readBack";

const FIGURE = /\d[\d,]*(\.\d+)?%?/g;

/** Number tokens in `s`, commas removed. */
export const figureTokens = (s: string): string[] => [...s.matchAll(FIGURE)].map((m) => m[0].replace(/,/g, ""));

function multiset(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Tokens in `a` beyond their count in `b`, as `token xN`. */
function surplus(a: Map<string, number>, b: Map<string, number>): string[] {
  return [...a].filter(([t, n]) => n > (b.get(t) ?? 0)).map(([t, n]) => `${t} x${n - (b.get(t) ?? 0)}`).sort();
}

/**
 * M6 / M13: per slide, the multiset of number tokens is the same in the PPTX, the HTML and the layout's figures,
 * and every figure equals its المصدر row and its resolved value.
 */
export function checkFigureParity(
  doc: LayoutDoc, pptx: Map<number, ReadBox[]>, html: Map<number, ReadBox[]>,
  xlsxSource: { valueKey: string; display: string }[], values: Map<string, ResolvedValue>,
): EngineIssue[] {
  const out: EngineIssue[] = [];
  const issue = (page: number | undefined, detail: string, path?: string): void => {
    out.push({ rule: "gate.figureParity", page, path, detail });
  };
  for (const s of doc.slides) {
    const layout = multiset(doc.figures.filter((f) => f.slide === s.index).flatMap((f) => figureTokens(f.display)));
    for (const [name, boxes] of [["PPTX", pptx], ["HTML", html]] as const) {
      const got = multiset((boxes.get(s.index) ?? []).flatMap((b) => figureTokens(b.text)));
      const extra = surplus(got, layout);
      const missing = surplus(layout, got);
      if (extra.length > 0 || missing.length > 0) {
        issue(s.index, `${name}: extra [${extra.join(", ")}] missing [${missing.join(", ")}]`);
      }
    }
  }
  const source = new Map<string, string[]>();
  for (const r of xlsxSource) source.set(r.valueKey, [...(source.get(r.valueKey) ?? []), r.display]);
  for (const f of doc.figures) {
    const rows = source.get(f.valueKey);
    if (rows === undefined) issue(f.slide, `المصدر: no row for ${f.display}`, f.boxId);
    else if (!rows.includes(f.display)) issue(f.slide, `المصدر: ${rows.join(" | ")} != ${f.display}`, f.boxId);
    const v = values.get(f.valueKey);
    if (v === undefined) issue(f.slide, `resolved: no value for ${f.display}`, f.boxId);
    else if (v.display !== f.display) issue(f.slide, `resolved: ${v.display} != ${f.display}`, f.boxId);
  }
  return out;
}
