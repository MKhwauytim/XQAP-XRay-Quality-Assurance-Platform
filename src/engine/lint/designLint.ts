import type { EngineIssue } from "../errors";
import { LAYOUT } from "../layout/layoutReport";
import type { Run } from "../layout/bidiRuns";
import type { BarChartBox, LayoutBox, LayoutDoc, LayoutSlide, TableBox, TextBox } from "../layout/types";
import type { ThemeTokens } from "../spec/types";
import { ANY_DIGIT, ARABIC_INDIC_DIGITS, LONG_DASH, MIN_FONT_PX, figureTokens, hexDigits } from "../text";

/**
 * Design lint (spec §4.9), Milestone 1 scope (C20): Floor F1 (contrast, a pure token-pair check), F2 (fit errors
 * the layout recorded), F4 (minimum 20px), T3 (no U+2013 / U+2014) and T6 (no emoji or decorative symbol) are
 * errors; R3 (a single coloured word in a title) is a warning. F5 (Floor) and the catalog warnings R1, R2, R8, R9
 * were added for catalog entries (Milestone 5); the browser lint pass is deferred to Milestone 3.
 */

export type TextRule = "T3" | "T6";

const DECORATIVE = /[\u2713\u2705\u26A0\u2605\u2190-\u21FF]|\p{Extended_Pictographic}/gu;

/** Every long dash (T3) and emoji or decorative symbol (T6) in `s`, by UTF-16 index. */
export function lintText(s: string): { rule: TextRule; index: number }[] {
  const out: { rule: TextRule; index: number }[] = [];
  for (const m of s.matchAll(LONG_DASH)) out.push({ rule: "T3", index: m.index });
  for (const m of s.matchAll(DECORATIVE)) out.push({ rule: "T6", index: m.index });
  return out.sort((a, b) => a.index - b.index);
}

const ARABIC_INDIC = new RegExp(`[${ARABIC_INDIC_DIGITS}]`, "gu");
/** Count of Arabic-Indic digits (U+0660 to U+0669) in `s` (decision 4). */
export const arabicIndicCount = (s: string): number => s.match(ARABIC_INDIC)?.length ?? 0;

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, or NaN for anything that is not `#RGB` / `#RRGGBB`. */
function luminance(color: string): number {
  const h = hexDigits(color);
  if (h === undefined) return Number.NaN;
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

const titleOf = (slide: LayoutSlide): TextBox | undefined =>
  slide.boxes.find((b): b is TextBox => b.kind === "text" && b.id === `s${slide.index}-title`);

const boxText = (b: TextBox): string => lineText(b.lines).trim();

/** Gap in px within which a text box counts as adjacent to a bar or KPI tile. */
const ADJACENT_PX = 40;

const near = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  b.x < a.x + a.w + ADJACENT_PX && b.x + b.w > a.x - ADJACENT_PX && b.y < a.y + a.h + ADJACENT_PX && b.y + b.h > a.y - ADJACENT_PX;

/**
 * F5 (Floor): a good or bad tone is never carried by colour alone. A bar in a good/bad tone must show a value
 * label (a non-null value with a category) or have a text box beside it; a text box (a KPI value) in a good/bad
 * tone must have another non-empty text box inside its tile or beside it. Tone is recognised by colour equal to
 * the theme's good/bad tone, since the layout model carries the resolved colour, not the tone name.
 */
function f5(slide: LayoutSlide, theme: ThemeTokens): EngineIssue[] {
  const toned = (c: string): boolean => c.toLowerCase() === theme.tones.good.toLowerCase() || c.toLowerCase() === theme.tones.bad.toLowerCase();
  const texts = slide.boxes.filter((b): b is TextBox => b.kind === "text" && boxText(b) !== "");
  const out: EngineIssue[] = [];
  for (const b of slide.boxes) {
    if (b.kind === "bar" && toned(b.color)) {
      const valueLabel = b.values.some((v) => v !== null) && b.categories.some((c) => c.trim() !== "");
      if (!valueLabel && !texts.some((t) => near(b, t))) out.push(lintIssue(slide.index, b.id, "F5: اللون وحده يحمل الدلالة، يلزم نص ظاهر"));
    } else if (b.kind === "text" && toned(b.color) && boxText(b) !== "") {
      if (!texts.some((t) => t !== b && near(b, t))) out.push(lintIssue(slide.index, b.id, "F5: اللون وحده يحمل الدلالة، يلزم نص ظاهر"));
    }
  }
  return out;
}

/** R1: a smaller text box above the title (an eyebrow); only a pattern repeated on several slides is reported. */
function r1(doc: LayoutDoc): EngineIssue[] {
  const hits: EngineIssue[] = [];
  for (const slide of doc.slides) {
    const title = titleOf(slide);
    if (title === undefined) continue;
    for (const b of slide.boxes) {
      if (b.kind === "text" && b !== title && boxText(b) !== "" && b.y + b.h <= title.y && b.sizePx < title.sizePx) {
        hits.push(lintIssue(slide.index, b.id, "R1: نص أصغر فوق العنوان"));
      }
    }
  }
  return new Set(hits.map((h) => h.page)).size > 1 ? hits : [];
}

const LATIN_WORD = /[A-Za-z]{4,}/g;

/** R2: an all-capitals Latin word longer than 3 letters. */
function r2(slide: LayoutSlide, theme: ThemeTokens): EngineIssue[] {
  return samples(slide, theme)
    .filter((s) => (s.text.match(LATIN_WORD) ?? []).some((w) => w === w.toUpperCase()))
    .map((s) => lintIssue(slide.index, s.where, "R2: نص لاتيني بأحرف كبيرة كلها"));
}

/** R8: a title with no figure in it. */
function r8(slide: LayoutSlide): EngineIssue[] {
  const t = slide.title;
  return figureTokens(t).length === 0 && !ANY_DIGIT.test(t) ? [lintIssue(slide.index, `s${slide.index}-title`, "R8: عنوان بلا رقم")] : [];
}

const tableArea = (t: TableBox): number => t.colW.reduce((a, c) => a + c, 0) * t.rowH * (t.rows.length + 1);

/** R9: two or more charts or tables on a slide and none at least 1.5 times the area of every other. */
function r9(slide: LayoutSlide): EngineIssue[] {
  const areas = slide.boxes
    .filter((b): b is BarChartBox | TableBox => b.kind === "bar" || b.kind === "table")
    .map((b) => (b.kind === "bar" ? b.w * b.h : tableArea(b)))
    .sort((a, b) => b - a);
  if (areas.length < 2 || areas[0] >= 1.5 * areas[1]) return [];
  return [lintIssue(slide.index, `s${slide.index}`, "R9: لا يوجد عنصر مهيمن بين المخططات والجداول")];
}

export interface Overrule { rule: string; reasonAr: string }

const ruleOf = (i: EngineIssue): string => /^[A-Z]\d+/.exec(i.detail ?? "")?.[0] ?? "";

export function lintLayout(
  doc: LayoutDoc,
  theme: ThemeTokens,
  opts?: { overrules?: Overrule[] },
): { errors: EngineIssue[]; warnings: EngineIssue[]; overruled: EngineIssue[] } {
  const errors: EngineIssue[] = [];
  const found: EngineIssue[] = [];
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
      if (s.sizePx < MIN_FONT_PX) errors.push(lintIssue(slide.index, s.where, `F4: ${s.sizePx}px < ${MIN_FONT_PX}px`));
      for (const hit of lintText(s.text)) errors.push(lintIssue(slide.index, s.where, `${hit.rule}: index ${hit.index}`));
    }
    errors.push(...f5(slide, theme));
    found.push(...r3(slide), ...r2(slide, theme), ...r8(slide), ...r9(slide));
  }
  found.push(...r1(doc));
  // M6: a digit typed into static template text is not a measured figure. Parity lets it through; the author is told.
  for (const n of doc.nonFigureSpans) {
    if (n.staticText !== undefined) found.push(lintIssue(n.slide, n.boxId, `M6: رقم مكتوب في نص ثابت: ${n.staticText.trim()}`));
  }
  // Only a Reflex or Finish warning can be overruled, and only with a reason; F5 is Floor and is an error, never here.
  const allowed = new Set((opts?.overrules ?? []).filter((o) => o.reasonAr.trim() !== "").map((o) => o.rule));
  const warnings = found.filter((w) => !allowed.has(ruleOf(w)));
  const overruled = found.filter((w) => allowed.has(ruleOf(w)));
  return { errors, warnings, overruled };
}

/** Catalog entry gate: passes only with zero errors and zero warnings left after the entry's overrules. */
export function catalogEntryGate(doc: LayoutDoc, theme: ThemeTokens, overrules?: Overrule[]): { ok: boolean; issues: EngineIssue[] } {
  const r = lintLayout(doc, theme, { overrules });
  const issues = [...r.errors, ...r.warnings];
  return { ok: issues.length === 0, issues };
}

/** T3/T6 over output text from one source; `where` names it in the issue. */
export function lintOutputText(where: string, texts: Iterable<string>): EngineIssue[] {
  const out: EngineIssue[] = [];
  for (const t of texts) for (const hit of lintText(t)) out.push({ rule: "gate.lint", path: where, detail: `${hit.rule}: U+${t.codePointAt(hit.index)?.toString(16).toUpperCase().padStart(4, "0")}` });
  return out;
}
