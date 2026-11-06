import type { EngineIssue } from "../errors";
import { LIMITS } from "../limits";
import type { ResolvedValue, ResolvedVisual } from "../resolve/resolve";
import type { IssueParams, MeasureSpec, PageSpec, ReportSpec, ThemeTokens, VisualSpec } from "../spec/types";
import { splitRuns } from "./bidiRuns";
import { fitIssue, fitTableHeaders, fitText } from "./fitLadder";
import type { FitResult } from "./fitLadder";
import { FIT_SAFETY } from "./measure";
import type { TextMeasurer } from "./measure";
import type { LayoutBox, LayoutDoc, LayoutFigure, LayoutSlide, TableBox, TextBox, TextCell } from "./types";

/**
 * Every layout dimension, in px on the 1920x1080 slide. `margin` is the safe area on all four edges: grid
 * frames are clipped to it, so no box ever sits closer to an edge. The title takes grid row 0 minus `ruleGap`,
 * and the rule (`ruleH` high) sits in that gap, so neither touches the first content row.
 */
export const LAYOUT = {
  slideW: 1920,
  slideH: 1080,
  margin: 24,
  ruleGap: 6,
  ruleH: 2,
  titlePx: 40,
  textPx: 28,
  kpiValuePx: 48,
  kpiLabelPx: 24,
  kpiGap: 16,
  tablePx: 22,
  rowH: 50,
  headerH: 60,
  cellPad: 8,
  /** Line height as a multiple of the font size; HTML and the layout line maths both read it. */
  lineHeightRatio: 1.4,
  /** Gap between stacked slides on screen (print drops it). */
  slideGap: 24,
  barLabelPx: 20,
  barLabelGap: 8,
  barWidthRatio: 0.6,
} as const;

/** Line height in whole px for a font size. */
export function lineHeightPx(sizePx: number): number {
  return Math.round(sizePx * LAYOUT.lineHeightRatio);
}

const CELL_W = LAYOUT.slideW / 24;
const CELL_H = LAYOUT.slideH / 14;
const CONTINUED = " (يتبع)";
const TOTAL_LABEL = "الإجمالي";

const MEASURE_REF = /\{\{measure:([^}]+)\}\}/g;
const PARAM_REF = /\{\{param:([^}]+)\}\}/g;

type Rect = { x: number; y: number; w: number; h: number };

/** Grid units to px: a cell is 1920/24 by 1080/14 px; edges round to whole px so adjacent frames share edges. */
export function gridToPx(frame: VisualSpec["frame"]): Rect {
  const x = Math.round(frame.col * CELL_W);
  const y = Math.round(frame.row * CELL_H);
  return { x, y, w: Math.round((frame.col + frame.w) * CELL_W) - x, h: Math.round((frame.row + frame.h) * CELL_H) - y };
}

/** A frame clipped to the slide's safe area. */
function safeFrame(frame: VisualSpec["frame"]): Rect {
  const r = gridToPx(frame);
  const x0 = Math.max(r.x, LAYOUT.margin), y0 = Math.max(r.y, LAYOUT.margin);
  const x1 = Math.min(r.x + r.w, LAYOUT.slideW - LAYOUT.margin), y1 = Math.min(r.y + r.h, LAYOUT.slideH - LAYOUT.margin);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

interface Ctx {
  spec: ReportSpec;
  values: Map<string, ResolvedValue>;
  params: IssueParams;
  theme: ThemeTokens;
  m: TextMeasurer;
  measures: Map<string, MeasureSpec>;
  issues: EngineIssue[];
  figures: LayoutFigure[];
}

type TablePage = (slide: number, continued: boolean) => LayoutBox[];

export function layoutReport(
  spec: ReportSpec, resolved: ResolvedVisual[], values: Map<string, ResolvedValue>, params: IssueParams,
  theme: ThemeTokens, m: TextMeasurer,
): LayoutDoc {
  const ctx: Ctx = {
    spec, values, params, theme, m, measures: new Map(spec.model.measures.map((x) => [x.id, x])), issues: [], figures: [],
  };
  const slides: LayoutSlide[] = [];
  spec.pages.forEach((page, pi) => {
    const byId = new Map(resolved.filter((r) => r.pageIndex === pi + 1).map((r) => [r.visualId, r]));
    const sorted = page.visuals.map((v, i) => ({ v, i })).sort((a, b) => a.v.frame.z - b.v.frame.z || a.i - b.i);
    const tables = new Map(sorted.filter(({ v }) => v.type === "table")
      .map(({ v }) => [v, tablePages(ctx, v, byId.get(v.visualId))] as const));
    const extra = Math.max(0, ...[...tables.values()].map((p) => p.length - 1));
    slides.push(makeSlide(ctx, page, slides.length + 1, false, (slide) => sorted.flatMap(({ v }) => {
      const pages = tables.get(v);
      return pages ? (pages[0]?.(slide, false) ?? []) : visualBoxes(ctx, slide, v, byId.get(v.visualId));
    })));
    for (let k = 1; k <= extra; k++) {
      slides.push(makeSlide(ctx, page, slides.length + 1, true, (slide) =>
        [...tables.values()].flatMap((p) => p[k]?.(slide, true) ?? [])));
    }
  });
  if (slides.length > LIMITS.maxSlides) {
    ctx.issues.push({ rule: "limit.slides", detail: `${slides.length} > ${LIMITS.maxSlides}` });
  }
  return { width: LAYOUT.slideW, height: LAYOUT.slideH, slides, figures: ctx.figures, issues: ctx.issues };
}

function makeSlide(ctx: Ctx, page: PageSpec, index: number, continued: boolean, body: (slide: number) => LayoutBox[]): LayoutSlide {
  const title = continued ? `${page.title}${CONTINUED}` : page.title;
  const row0 = safeFrame({ col: 0, row: 0, w: 24, h: 1, z: 0 });
  const frame = { ...row0, h: row0.h - LAYOUT.ruleGap };
  const titleBox = textBox(ctx, index, `s${index}-title`, "title", frame, title, {
    sizePx: LAYOUT.titlePx, weight: 700, color: ctx.theme.ink.navy, maxLines: 1,
  }, [], false);
  const rule: LayoutBox = {
    kind: "rule", id: `s${index}-rule`, x: frame.x, y: frame.y + frame.h + (LAYOUT.ruleGap - LAYOUT.ruleH) / 2,
    w: frame.w, color: ctx.theme.ink.gold,
  };
  return { index, pageId: page.pageId, title, boxes: [titleBox, rule, ...body(index)] };
}

function pushFit(ctx: Ctx, r: FitResult, page: number, visual: string | undefined): void {
  const issue = fitIssue(r, visual === undefined ? { page } : { page, visual });
  if (issue) ctx.issues.push(issue);
}

function figure(ctx: Ctx, slide: number, boxId: string, rv: ResolvedValue): void {
  ctx.figures.push({ slide, boxId, valueKey: rv.key, display: rv.display });
}

/** One fitted text box. It never grows past its frame: no widening is offered, and a miss is a located issue. */
function textBox(
  ctx: Ctx, slide: number, id: string, visualId: string, frame: Rect, text: string,
  style: { sizePx: number; weight: 400 | 700; color: string; maxLines: 1 | 2 }, valueKeys: string[], located = true,
): TextBox {
  // Lines that cannot fit the frame height at this size are not offered (at least one line always is).
  const maxLines = Math.max(1, Math.min(style.maxLines, Math.floor(frame.h / lineHeightPx(style.sizePx)))) as 1 | 2;
  const fit = fitText(text, { w: frame.w, basePx: style.sizePx, weight: style.weight, maxLines }, ctx.m);
  pushFit(ctx, fit, slide, located ? visualId : undefined);
  return {
    kind: "text", id, visualId, ...frame,
    sizePx: fit.sizePx, weight: style.weight, color: style.color, lines: fit.lines.map(splitRuns), valueKeys,
  };
}

function visualBoxes(ctx: Ctx, slide: number, v: VisualSpec, r: ResolvedVisual | undefined): LayoutBox[] {
  const frame = safeFrame(v.frame);
  const id = (n: number) => `s${slide}-${v.visualId}-${n}`;
  const tone = (fallback: "primary" | "neutral") => ctx.theme.tones[v.format?.tone ?? fallback];
  const cells = r?.cells ?? [];
  if (v.type === "text") {
    const used: ResolvedValue[] = [];
    const text = (v.text ?? "")
      .replace(MEASURE_REF, (_, mid: string) => {
        const rv = cells.find((c) => c.measureId === mid) ?? ctx.values.get(mid);
        if (!rv) return "-";
        if (!used.includes(rv)) used.push(rv);
        return rv.display;
      })
      .replace(PARAM_REF, (_, pid: string) => {
        const p = ctx.params.values[pid];
        return p === undefined ? "-" : String(p);
      });
    const box = textBox(ctx, slide, id(0), v.visualId, frame, text, {
      sizePx: v.format?.sizePx ?? LAYOUT.textPx, weight: v.format?.weight ?? 400, color: tone("neutral"), maxLines: 2,
    }, used.map((u) => u.key));
    for (const u of used) figure(ctx, slide, box.id, u);
    return [box];
  }
  if (v.type === "kpiBand") {
    const n = Math.max(1, cells.length);
    const tileW = Math.floor((frame.w - LAYOUT.kpiGap * (n - 1)) / n);
    const out: LayoutBox[] = [];
    let k = 0;
    cells.forEach((c, i) => {
      // Logical order runs right to left on an RTL slide.
      const x = frame.x + frame.w - (i + 1) * tileW - i * LAYOUT.kpiGap;
      out.push({ kind: "rect", id: id(k++), x, y: frame.y, w: tileW, h: frame.h, fill: ctx.theme.ink.panel });
      const inner = { x: x + LAYOUT.cellPad, w: Math.max(0, tileW - 2 * LAYOUT.cellPad) };
      const valueH = Math.round(frame.h * 0.55);
      const valueBox = textBox(ctx, slide, id(k++), v.visualId, { ...inner, y: frame.y, h: valueH }, c.display, {
        sizePx: LAYOUT.kpiValuePx, weight: 700, color: tone("primary"), maxLines: 1,
      }, [c.key]);
      figure(ctx, slide, valueBox.id, c);
      const label = ctx.measures.get(c.measureId)?.label ?? c.measureId;
      const labelBox = textBox(ctx, slide, id(k++), v.visualId, { ...inner, y: frame.y + valueH, h: frame.h - valueH }, label, {
        sizePx: LAYOUT.kpiLabelPx, weight: 400, color: ctx.theme.ink.muted, maxLines: 2,
      }, []);
      out.push(valueBox, labelBox);
    });
    return out;
  }
  if (v.type === "barChart") {
    const lead = cells[0]?.measureId;
    const series = cells.filter((c) => c.measureId === lead);
    const box: LayoutBox = {
      kind: "bar", id: id(0), visualId: v.visualId, ...frame, categories: [...(r?.categories ?? [])],
      values: series.map((c) => c.value), valueKeys: series.map((c) => c.key),
      format: ctx.measures.get(lead ?? "")?.format ?? { kind: "int", digits: 0 }, color: tone("primary"),
    };
    for (const c of series) figure(ctx, slide, box.id, c);
    return [box];
  }
  return [];
}

/** The group part of a value key: everything after `measureId@`. Same encoding as `valueKey`. */
function groupKeyOf(rv: ResolvedValue): string {
  return rv.key.slice(rv.measureId.length + 1);
}

interface BodyCell { text: string; key?: string; groupKey?: string; rv?: ResolvedValue }

/** Fit a table once, then split its rows into pages; each page repeats the header; the total row ends the last page. */
function tablePages(ctx: Ctx, v: VisualSpec, r: ResolvedVisual | undefined): TablePage[] {
  const frame = safeFrame(v.frame);
  const cells = r?.cells ?? [];
  const fields = (["rows", "axis", "columns", "legend"] as const)
    .flatMap((w) => (v.wells[w] ?? []).flatMap((x) => ("field" in x ? [x.field] : [])));
  const measureIds = (v.wells.values ?? []).flatMap((x) => ("measure" in x ? [x.measure] : []))
    .filter((id, i, all) => all.indexOf(id) === i && ctx.measures.has(id));
  const datasetId = cells[0]?.provenance.datasetId;
  const columns = ctx.spec.datasets.find((d) => d.id === datasetId)?.columns ?? [];
  const headers = [
    ...fields.map((f) => columns.find((c) => c.id === f)?.label ?? f),
    ...measureIds.map((id) => ctx.measures.get(id)!.label),
  ];
  const nCols = headers.length;
  if (nCols === 0) return [];

  // Rows are built from the group key, never from cell order.
  const groups = new Map<string, Map<string, ResolvedValue>>();
  if (fields.length > 0) {
    for (const c of cells) {
      const gk = groupKeyOf(c);
      if (!groups.has(gk)) groups.set(gk, new Map());
      groups.get(gk)!.set(c.measureId, c);
    }
  }
  const measureCell = (rv: ResolvedValue | undefined): BodyCell =>
    rv ? { text: rv.display, key: rv.key, rv } : { text: "-" };
  const body: BodyCell[][] = [...groups].map(([gk, byMeasure]) => {
    const any = [...byMeasure.values()][0];
    return [
      ...fields.map((f) => ({ text: any.group[f] ?? "-", groupKey: gk })),
      ...measureIds.map((id) => measureCell(byMeasure.get(id))),
    ];
  });
  const totalsSrc = fields.length > 0 ? (r?.totals ?? []) : cells;
  const totals: BodyCell[] | null = totalsSrc.length === 0 ? null : [
    ...fields.map((_, i) => ({ text: i === 0 ? TOTAL_LABEL : "" })),
    ...measureIds.map((id) => measureCell(totalsSrc.find((t) => t.measureId === id))),
  ];
  const allRows = totals ? [...body, totals] : body;

  // One-time (first-slide) issues: frame, columns and header fit.
  const once: ((slide: number) => void)[] = [];
  const pad = 2 * LAYOUT.cellPad;
  const inner = Math.max(0, frame.w - pad * nCols);
  const colInner = Array.from({ length: nCols }, (_, i) => Math.floor(inner / nCols) + (i < inner % nCols ? 1 : 0));
  const minInner = Array.from({ length: nCols }, (_, c) =>
    Math.max(0, ...allRows.map((row) => Math.ceil(ctx.m.width(row[c].text, LAYOUT.tablePx, 400) * FIT_SAFETY))));
  const fitted = fitTableHeaders(headers, colInner, minInner, LAYOUT.tablePx, ctx.m);
  let innerW = fitted.colW;
  if (innerW.reduce((a, b) => a + b, 0) > inner || minInner.reduce((a, b) => a + b, 0) > inner) {
    innerW = colInner; // never spill past the frame; the cells that do not fit report below
    once.push((slide) => ctx.issues.push({ rule: "fit.tooLong", page: slide, visual: v.visualId, detail: "columns wider than frame" }));
  }
  const colW = innerW.map((w) => w + pad);
  const headerFits = innerW === fitted.colW
    ? fitted.fits
    : headers.map((h, i) => fitText(h, { w: innerW[i], basePx: LAYOUT.tablePx, weight: 700, maxLines: 2 }, ctx.m));
  once.push((slide) => headerFits.forEach((f, c) => {
    const issue = fitIssue(f, { page: slide, visual: v.visualId, detail: `header c${c}` });
    if (issue) ctx.issues.push(issue);
  }));

  const geometric = Math.floor((frame.h - LAYOUT.headerH) / LAYOUT.rowH);
  if (geometric < 1) {
    once.push((slide) => ctx.issues.push({ rule: "fit.tooLong", page: slide, visual: v.visualId, detail: "table frame shorter than one row" }));
  }
  const perPage = Math.max(1, Math.min(geometric, Math.floor(LIMITS.maxTableCellsPerPage / nCols)));
  const chunks: BodyCell[][][] = [];
  for (let start = 0; start < body.length; start += perPage) chunks.push(body.slice(start, start + perPage));
  if (chunks.length === 0) chunks.push([]);
  if (totals) {
    // The total row does not count toward the split; it gets its own page only when the last one is full.
    const last = chunks[chunks.length - 1];
    if (last.length < perPage) last.push(totals);
    else chunks.push([totals]);
  }

  return chunks.map((chunk) => (slide: number, continued: boolean): LayoutBox[] => {
    if (!continued) for (const f of once) f(slide);
    const boxId = `s${slide}-${v.visualId}-0`;
    const header: TextCell[] = headerFits.map((f, c) => ({
      id: `${boxId}-r0c${c}`, lines: f.lines.map(splitRuns), sizePx: f.sizePx, weight: 700,
    }));
    const rows: TextCell[][] = chunk.map((row, ri) => row.map((cell, c) => {
      const fit = fitText(cell.text, { w: innerW[c], basePx: LAYOUT.tablePx, weight: 400, maxLines: 1 }, ctx.m);
      pushFit(ctx, fit, slide, v.visualId);
      const id = `${boxId}-r${ri + 1}c${c}`;
      const out: TextCell = { id, lines: fit.lines.map(splitRuns), sizePx: fit.sizePx, weight: row === totals ? 700 : 400 };
      if (cell.rv) {
        out.valueKey = cell.rv.key;
        figure(ctx, slide, id, cell.rv);
      }
      if (cell.groupKey !== undefined) out.groupKey = cell.groupKey;
      return out;
    }));
    const box: TableBox = {
      kind: "table", id: boxId, visualId: v.visualId, x: frame.x, y: frame.y, colW, rowH: LAYOUT.rowH, header, rows, continued,
    };
    return [box];
  });
}
