import type { EngineIssue } from "../errors";
import { FIT_SAFETY, type TextMeasurer } from "./measure";

/**
 * M7 fit ladder result. step 1: one line at base size; 2: one line shrunk; 3: one line in a widened box;
 * 4: two balanced lines; 5: does not fit (the caller must fail closed; the text is kept whole, never clipped).
 */
export interface FitResult {
  step: 1 | 2 | 3 | 4 | 5;
  sizePx: number;
  widthPx: number;
  lines: string[];
}

export interface FitBox {
  w: number;
  basePx: number;
  weight: 400 | 700;
  maxLines: 1 | 2;
}

const MIN_FONT_PX = 20;
const SHRINK_FLOOR = 0.85;
const SIZE_STEP = 0.5;

/** Run the fit ladder. `widenTo` is the widest the box may grow to (step 3, and step 4 when needed). */
export function fitText(text: string, box: FitBox, m: TextMeasurer, widenTo?: number): FitResult {
  const measure = (t: string, size: number) => m.width(t, size, box.weight) * FIT_SAFETY;
  const base = box.basePx;
  const maxW = Math.max(box.w, widenTo ?? box.w);
  const full = measure(text, base);
  if (full <= box.w) return { step: 1, sizePx: base, widthPx: box.w, lines: [text] };

  const minPx = Math.max(MIN_FONT_PX, SHRINK_FLOOR * base);
  let size = Math.floor(((base * box.w) / full) / SIZE_STEP) * SIZE_STEP;
  while (size >= minPx && measure(text, size) > box.w) size -= SIZE_STEP;
  if (size >= minPx) return { step: 2, sizePx: size, widthPx: box.w, lines: [text] };

  if (full <= maxW) return { step: 3, sizePx: base, widthPx: Math.ceil(full), lines: [text] };

  if (box.maxLines === 2) {
    let best: { longest: number; lines: string[] } | null = null;
    for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) {
      const a = text.slice(0, i);
      const b = text.slice(i + 1);
      if (!a || !b) continue;
      const longest = Math.max(measure(a, base), measure(b, base));
      if (!best || longest < best.longest) best = { longest, lines: [a, b] };
    }
    if (best && best.longest <= maxW) {
      return { step: 4, sizePx: base, widthPx: Math.max(box.w, Math.ceil(best.longest)), lines: best.lines };
    }
  }
  return { step: 5, sizePx: base, widthPx: box.w, lines: [text] };
}

/** A located `fit.tooLong` issue when the ladder failed, else null. */
export function fitIssue(r: FitResult, where: Omit<EngineIssue, "rule">): EngineIssue | null {
  return r.step === 5 ? { rule: "fit.tooLong", ...where } : null;
}

/** Fit each header, widening a column by borrowing from its siblings down to their `minW`. The sum of widths is kept. */
export function fitTableHeaders(
  headers: string[],
  colW: number[],
  minW: number[],
  basePx: number,
  m: TextMeasurer,
): { colW: number[]; fits: FitResult[] } {
  const widths = [...colW];
  const fits = headers.map((h, i) => {
    const slack = widths.map((w, j) => (j === i ? 0 : Math.max(0, w - (minW[j] ?? 0))));
    const totalSlack = slack.reduce((a, b) => a + b, 0);
    const r = fitText(h, { w: widths[i], basePx, weight: 700, maxLines: 2 }, m, widths[i] + totalSlack);
    const need = r.step === 5 ? 0 : Math.ceil(r.widthPx - widths[i]);
    if (need > 0) borrow(widths, slack, totalSlack, i, need);
    return r.step === 5 ? r : { ...r, widthPx: widths[i] };
  });
  return { colW: widths, fits };
}

function borrow(widths: number[], slack: number[], totalSlack: number, i: number, need: number): void {
  const take = slack.map((s) => Math.floor((need * s) / totalSlack));
  let rest = need - take.reduce((a, b) => a + b, 0);
  const order = slack.map((s, j) => ({ s, j })).sort((a, b) => b.s - a.s || a.j - b.j);
  for (const { j } of order) {
    if (rest <= 0) break;
    if (take[j] < slack[j]) { take[j] += 1; rest -= 1; }
  }
  take.forEach((t, j) => { widths[j] -= t; });
  widths[i] += need;
}
