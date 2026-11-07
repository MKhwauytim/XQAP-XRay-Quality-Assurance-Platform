import type { EngineIssue } from "../errors";
import { splitRuns } from "./bidiRuns";
import { FIT_SAFETY, type TextMeasurer } from "./measure";
import { MIN_FONT_PX } from "../text";

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

  if (full <= maxW) return { step: 3, sizePx: base, widthPx: Math.min(maxW, Math.ceil(full)), lines: [text] };

  if (box.maxLines === 2) {
    let best: { longest: number; lines: string[] } | null = null;
    const locked = ltrOffsets(text);
    for (let i = text.indexOf(" "); i !== -1; i = text.indexOf(" ", i + 1)) {
      if (locked.has(i)) continue;
      const a = text.slice(0, i);
      const b = text.slice(i + 1);
      if (!a || !b) continue;
      const longest = Math.max(measure(a, base), measure(b, base));
      if (!best || longest < best.longest) best = { longest, lines: [a, b] };
    }
    if (best && best.longest <= maxW) {
      return { step: 4, sizePx: base, widthPx: Math.min(maxW, Math.max(box.w, Math.ceil(best.longest))), lines: best.lines };
    }
  }
  return { step: 5, sizePx: base, widthPx: box.w, lines: [text] };
}

/** A located `fit.tooLong` issue when the ladder failed, else null. */
export function fitIssue(r: FitResult, where: Omit<EngineIssue, "rule">): EngineIssue | null {
  return r.step === 5 ? { rule: "fit.tooLong", ...where } : null;
}

/** Character offsets inside LTR runs; a line break there would split a number cluster. */
function ltrOffsets(text: string): Set<number> {
  const out = new Set<number>();
  let pos = 0;
  for (const r of splitRuns(text)) {
    if (r.ltr) for (let k = 0; k < r.text.length; k++) out.add(pos + k);
    pos += r.text.length;
  }
  return out;
}

/** Width a fitted header needs to stay at its step. */
function requiredWidth(h: string, r: FitResult, colW: number, basePx: number, m: TextMeasurer): number {
  const w = (t: string) => Math.ceil(m.width(t, basePx, 700) * FIT_SAFETY);
  if (r.step === 1) return w(h);
  if (r.step === 4) return Math.max(...r.lines.map(w));
  if (r.step === 3) return r.widthPx;
  return colW; // step 2 was shrunk to this width; step 5 keeps its width and fails closed
}

/**
 * Fit every header, then allocate. Each column's floor is max(minW, required width of its fitted header);
 * widened columns take width from the others' slack above their floor, so no column gives back width its
 * own header needs. If the slack cannot cover every widened header, those headers refit without widening.
 * The sum of widths is kept exactly.
 */
export function fitTableHeaders(
  headers: string[],
  colW: number[],
  minW: number[],
  basePx: number,
  m: TextMeasurer,
): { colW: number[]; fits: FitResult[] } {
  const box = (w: number) => ({ w, basePx, weight: 700 as const, maxLines: 2 as const });
  const total = colW.reduce((a, b) => a + b, 0);
  const fitAll = (widen: boolean) => headers.map((h, i) => {
    const others = colW.reduce((a, w, j) => (j === i ? a : a + Math.max(0, w - (minW[j] ?? 0))), 0);
    return fitText(h, box(colW[i]), m, widen ? colW[i] + others : colW[i]);
  });
  let fits = fitAll(true);
  let floors = fits.map((r, i) => Math.max(minW[i] ?? 0, requiredWidth(headers[i], r, colW[i], basePx, m)));
  const fixed = (i: number) => floors[i] > colW[i];
  if (floors.reduce((a, f, i) => a + (fixed(i) ? f : Math.min(f, colW[i])), 0) > total) {
    fits = fitAll(false);
    floors = fits.map((r, i) => Math.max(minW[i] ?? 0, requiredWidth(headers[i], r, colW[i], basePx, m)));
  }
  const widths = colW.map((w, i) => Math.max(w, floors[i]));
  let need = widths.reduce((a, b) => a + b, 0) - total;
  const slack = widths.map((w, i) => (fixed(i) ? 0 : Math.max(0, w - floors[i])));
  const totalSlack = slack.reduce((a, b) => a + b, 0);
  if (need > 0 && totalSlack > 0) {
    const take = slack.map((s) => Math.min(s, Math.floor((need * s) / totalSlack)));
    need -= take.reduce((a, b) => a + b, 0);
    const order = slack.map((s, j) => ({ s, j })).sort((a, b) => b.s - a.s || a.j - b.j);
    for (const { j } of order) {
      if (need <= 0) break;
      if (take[j] < slack[j]) { take[j] += 1; need -= 1; }
    }
    take.forEach((t, j) => { widths[j] -= t; });
  }
  return { colW: widths, fits: fits.map((r, i) => (r.step === 5 ? r : { ...r, widthPx: widths[i] })) };
}
