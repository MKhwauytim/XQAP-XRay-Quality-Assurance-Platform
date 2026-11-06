import type { EngineIssue } from "../errors";
import { LAYOUT } from "../layout/layoutReport";
import type { Run } from "../layout/bidiRuns";
import type { LayoutBox, LayoutDoc, LayoutSlide, TextBox } from "../layout/types";
import type { ThemeTokens } from "../spec/types";

/**
 * Design lint (spec §4.9), Milestone 1 scope (C20): Floor F1 (contrast, a pure token-pair check), F2 (fit errors
 * the layout recorded), F4 (minimum 20px), T3 (no U+2013 / U+2014) and T6 (no emoji or decorative symbol) are
 * errors; R3 (a single coloured word in a title) is a warning. F5, the other Reflex and Finish rules and the
 * browser lint pass are deferred to Milestone 3.
 */

export type TextRule = "T3" | "T6";

const LONG_DASH = /[\u2013\u2014]/gu;
const DECORATIVE = /[\u2713\u2705\u26A0\u2605\u2190-\u21FF]|\p{Extended_Pictographic}/gu;

/** Every long dash (T3) and emoji or decorative symbol (T6) in `s`, by UTF-16 index. */
export function lintText(s: string): { rule: TextRule; index: number }[] {
  const out: { rule: TextRule; index: number }[] = [];
  for (const m of s.matchAll(LONG_DASH)) out.push({ rule: "T3", index: m.index });
  for (const m of s.matchAll(DECORATIVE)) out.push({ rule: "T6", index: m.index });
  return out.sort((a, b) => a.index - b.index);
}

const ARABIC_INDIC = /[\u0660-\u0669]/g;
/** Count of Arabic-Indic digits (U+0660 to U+0669) in `s` (decision 4). */
export const arabicIndicCount = (s: string): number => s.match(ARABIC_INDIC)?.length ?? 0;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Relative luminance, or NaN for anything that is not `#RGB` / `#RRGGBB`. */
function luminance(color: string): number {
  if (!HEX_COLOR.test(color)) return Number.NaN;
  let h = color.slice(1);
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2 contrast ratio of two `#RGB` / `#RRGGBB` colours, 1 to 21; NaN when either colour does not parse. */
export function contrastRatio(fg: string, bg: string): number {
  const la = luminance(fg);
  const lb = luminance(bg);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** F1 threshold: 3:1 at 44px and above, 4.5:1 below. */
const minContrast = (sizePx: number): number => (sizePx >= 44 ? 3 : 4.5);
const F4_MIN_PX = 20;

const lineText = (lines: Run[][]): string => lines.map((l) => l.map((r) => r.text).join("")).join("\n");

/** The fill under a point: the last rect box drawn before `upTo` that contains it, else the slide background. */
function backgroundAt(slide: LayoutSlide, upTo: number, x: number, y: number, theme: ThemeTokens): string {
  for (let i = upTo - 1; i >= 0; i--) {
    const b = slide.boxes[i];
    if (b.kind === "rect" && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) return b.fill;
  }
  return theme.ink.bg;
}

interface Sample { where: string; text: string; sizePx: number; fg?: string; bg?: string }

/** Every piece of text a slide shows, with its size and (where the layout knows it) its colour pair. */
function samples(slide: LayoutSlide, theme: ThemeTokens): Sample[] {
  const out: Sample[] = [{ where: "title", text: slide.title, sizePx: LAYOUT.titlePx }];
  slide.boxes.forEach((b: LayoutBox, i) => {
    if (b.kind === "text") {
      out.push({ where: b.id, text: lineText(b.lines), sizePx: b.sizePx, fg: b.color, bg: backgroundAt(slide, i, b.x, b.y, theme) });
    } else if (b.kind === "table") {
      for (const c of b.header) out.push({ where: c.id, text: lineText(c.lines), sizePx: c.sizePx, fg: theme.ink.bg, bg: theme.ink.navy });
      for (const c of b.rows.flat()) out.push({ where: c.id, text: lineText(c.lines), sizePx: c.sizePx, fg: theme.ink.text, bg: theme.ink.bg });
    } else if (b.kind === "bar") {
      const bg = backgroundAt(slide, i, b.x, b.y, theme);
      out.push({ where: `${b.id} values`, text: "", sizePx: LAYOUT.barLabelPx, fg: theme.ink.text, bg });
      for (const c of b.categories) out.push({ where: `${b.id} categories`, text: c, sizePx: LAYOUT.barLabelPx, fg: theme.ink.muted, bg });
    }
  });
  return out;
}

const lintIssue = (page: number, where: string, detail: string): EngineIssue => ({ rule: "gate.lint", page, path: where, detail });

/** R3: another text box of a different colour laid over the title row reads as one coloured word in the title. */
function r3(slide: LayoutSlide): EngineIssue[] {
  const title = slide.boxes.find((b): b is TextBox => b.kind === "text" && b.id === `s${slide.index}-title`);
  if (title === undefined) return [];
  return slide.boxes
    .filter((b): b is TextBox => b.kind === "text" && b !== title && b.color !== title.color &&
      b.y < title.y + title.h && b.y + b.h > title.y && b.x < title.x + title.w && b.x + b.w > title.x)
    .map((b) => lintIssue(slide.index, b.id, "R3: كلمة ملونة منفردة في العنوان"));
}

export function lintLayout(doc: LayoutDoc, theme: ThemeTokens): { errors: EngineIssue[]; warnings: EngineIssue[] } {
  const errors: EngineIssue[] = [];
  const warnings: EngineIssue[] = [];
  for (const issue of doc.issues) {
    if (issue.rule === "fit.tooLong") errors.push({ ...issue, rule: "gate.lint", detail: `F2: ${issue.detail ?? "fit.tooLong"}` });
  }
  for (const slide of doc.slides) {
    for (const s of samples(slide, theme)) {
      if (s.fg !== undefined && s.bg !== undefined) {
        const ratio = contrastRatio(s.fg, s.bg);
        const need = minContrast(s.sizePx);
        // Written as "not at least" so an unparseable colour (NaN) is an error, never a pass.
        if (!(ratio >= need)) errors.push(lintIssue(slide.index, s.where, `F1: contrast ${ratio.toFixed(2)} < ${need} (${s.fg} on ${s.bg})`));
      }
      if (s.sizePx < F4_MIN_PX) errors.push(lintIssue(slide.index, s.where, `F4: ${s.sizePx}px < ${F4_MIN_PX}px`));
      for (const hit of lintText(s.text)) errors.push(lintIssue(slide.index, s.where, `${hit.rule}: index ${hit.index}`));
    }
    warnings.push(...r3(slide));
  }
  // M6: a digit typed into static template text is not a measured figure. Parity lets it through; the author is told.
  for (const n of doc.nonFigureSpans) {
    if (n.staticText !== undefined) warnings.push(lintIssue(n.slide, n.boxId, `M6: رقم مكتوب في نص ثابت: ${n.staticText.trim()}`));
  }
  return { errors, warnings };
}

/** T3/T6 over output text from one source; `where` names it in the issue. */
export function lintOutputText(where: string, texts: Iterable<string>): EngineIssue[] {
  const out: EngineIssue[] = [];
  for (const t of texts) for (const hit of lintText(t)) out.push({ rule: "gate.lint", path: where, detail: `${hit.rule}: U+${t.codePointAt(hit.index)?.toString(16).toUpperCase().padStart(4, "0")}` });
  return out;
}
