import type { EngineIssue } from "../errors";
import type { LayoutDoc } from "../layout/types";
import type { ResolvedValue } from "../resolve/resolve";
import { NO_SLIDE, UNBOXED } from "./readBack";
import type { ReadBox } from "./readBack";
import { figureTokens } from "../text";

export { figureTokens };

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
 * M6 / M13, three checks:
 * 1. Located: every figure's display is in the tokens of its own box (or cell) in both the PPTX and the HTML,
 *    so two figures swapped between boxes are caught.
 * 2. Per slide, the multiset of number tokens shown (boxes, cells, and HTML text outside every box) equals the
 *    layout's figures plus its non-figure spans; any digit in HTML body text outside every slide blocks.
 * 3. Every figure equals its المصدر row (one row per value key) and its resolved value.
 */
export function checkFigureParity(
  doc: LayoutDoc, pptx: Map<number, ReadBox[]>, html: Map<number, ReadBox[]>,
  xlsxSource: { valueKey: string; display: string }[], values: Map<string, ResolvedValue>,
): EngineIssue[] {
  const out: EngineIssue[] = [];
  const issue = (page: number | undefined, detail: string, path?: string): void => {
    out.push({ rule: "gate.figureParity", page, path, detail });
  };
  const sources = [["PPTX", pptx], ["HTML", html]] as const;

  // Several figures can share one box (a text box, a bar chart): require them together, as a multiset.
  const byBox = new Map<string, { slide: number; boxId: string; tokens: string[] }>();
  for (const f of doc.figures) {
    const k = `${f.slide} ${f.boxId}`;
    const e = byBox.get(k) ?? { slide: f.slide, boxId: f.boxId, tokens: [] };
    e.tokens.push(...figureTokens(f.display));
    byBox.set(k, e);
  }
  for (const { slide, boxId, tokens } of byBox.values()) {
    for (const [name, boxes] of sources) {
      const box = (boxes.get(slide) ?? []).find((b) => b.id === boxId);
      if (box === undefined) { issue(slide, `${name}: figure box missing`, boxId); continue; }
      const missing = surplus(multiset(tokens), multiset(figureTokens(box.text)));
      if (missing.length > 0) issue(slide, `${name}: box lacks [${missing.join(", ")}]`, boxId);
    }
  }

  for (const s of doc.slides) {
    const expected = multiset([
      ...doc.figures.filter((f) => f.slide === s.index).flatMap((f) => figureTokens(f.display)),
      ...doc.nonFigureSpans.filter((n) => n.slide === s.index).flatMap((n) => figureTokens(n.text)),
    ]);
    for (const [name, boxes] of sources) {
      const got = multiset((boxes.get(s.index) ?? []).flatMap((b) => figureTokens(b.text)));
      const extra = surplus(got, expected);
      const missing = surplus(expected, got);
      if (extra.length > 0 || missing.length > 0) {
        issue(s.index, `${name}: extra [${extra.join(", ")}] missing [${missing.join(", ")}]`);
      }
    }
  }
  const outside = (html.get(NO_SLIDE) ?? []).flatMap((b) => figureTokens(b.text));
  if (outside.length > 0) issue(undefined, `HTML: digits outside every slide [${outside.join(", ")}]`, UNBOXED);

  const source = new Map<string, string[]>();
  for (const r of xlsxSource) source.set(r.valueKey, [...(source.get(r.valueKey) ?? []), r.display]);
  // المصدر has one row per figure, so a value key shown twice repeats; repeats that disagree are an error.
  for (const [key, rows] of source) {
    if (new Set(rows).size > 1) issue(undefined, `المصدر: one value key with different displays [${rows.join(" | ")}]`, key);
  }
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
