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

const SLIDE_W = 1920;
const SLIDE_H = 1080;
const CELL_W = SLIDE_W / 24;
const CELL_H = SLIDE_H / 14;

const TITLE_PX = 40;
const TEXT_PX = 28;
const KPI_VALUE_PX = 48;
const KPI_LABEL_PX = 24;
const KPI_GAP = 16;
const TABLE_PX = 22;
const ROW_H = 50;
const HEADER_H = 60;
const CELL_PAD = 8;
const CONTINUED = " (يتبع)";

const MEASURE_REF = /\{\{measure:([^}]+)\}\}/g;
const PARAM_REF = /\{\{param:([^}]+)\}\}/g;

/** Grid units to px: a cell is 1920/24 by 1080/14 px; edges round to whole px so adjacent frames share edges. */
export function gridToPx(frame: VisualSpec["frame"]): { x: number; y: number; w: number; h: number } {
  const x = Math.round(frame.col * CELL_W);
  const y = Math.round(frame.row * CELL_H);
  return { x, y, w: Math.round((frame.col + frame.w) * CELL_W) - x, h: Math.round((frame.row + frame.h) * CELL_H) - y };
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

/** A page's boxes before slide numbering: the first slide plus one box list per continuation slide. */
interface PageBoxes {
  first: (slide: number) => LayoutBox[];
  continuations: ((slide: number) => LayoutBox[])[];
}

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
    const tables = sorted.filter(({ v }) => v.type === "table").map(({ v }) => ({ v, pages: tablePages(ctx, v, byId.get(v.visualId)) }));
    const extra = Math.max(0, ...tables.map((t) => t.pages.length - 1));
    const pb: PageBoxes = {
      first: (slide) => sorted.flatMap(({ v }) => {
        const r = byId.get(v.visualId);
        if (v.type === "table") return tables.find((t) => t.v === v)!.pages[0]?.(slide, false) ?? [];
        return visualBoxes(ctx, slide, v, r);
      }),
      continuations: Array.from({ length: extra }, (_, k) => (slide: number) =>
        tables.flatMap((t) => t.pages[k + 1]?.(slide, true) ?? [])),
    };
    slides.push(makeSlide(ctx, page, slides.length + 1, false, pb.first));
    for (const c of pb.continuations) slides.push(makeSlide(ctx, page, slides.length + 1, true, c));
  });
  if (slides.length > LIMITS.maxSlides) {
    ctx.issues.push({ rule: "limit.slides", detail: `${slides.length} > ${LIMITS.maxSlides}` });
  }
  return { width: SLIDE_W, height: SLIDE_H, slides, figures: ctx.figures, issues: ctx.issues };
}

function makeSlide(ctx: Ctx, page: PageSpec, index: number, continued: boolean, body: (slide: number) => LayoutBox[]): LayoutSlide {
  const title = continued ? `${page.title}${CONTINUED}` : page.title;
  const frame = gridToPx({ col: 0, row: 0, w: 24, h: 1, z: 0 });
  const fit = fitText(title, { w: frame.w, basePx: TITLE_PX, weight: 700, maxLines: 1 }, ctx.m);
  pushFit(ctx, fit, index, undefined);
  const titleBox: TextBox = {
    kind: "text", id: `s${index}-title`, visualId: "title", ...frame, sizePx: fit.sizePx, weight: 700,
    color: ctx.theme.ink.navy, lines: fit.lines.map(splitRuns), valueKeys: [],
  };
  const rule: LayoutBox = { kind: "rule", id: `s${index}-rule`, x: 0, y: frame.y + frame.h, w: SLIDE_W, color: ctx.theme.ink.gold };
  return { index, pageId: page.pageId, title, boxes: [titleBox, rule, ...body(index)] };
}

function pushFit(ctx: Ctx, r: FitResult, page: number, visual: string | undefined): void {
  const issue = fitIssue(r, visual === undefined ? { page } : { page, visual });
  if (issue) ctx.issues.push(issue);
}

function figure(ctx: Ctx, slide: number, boxId: string, rv: ResolvedValue): void {
  ctx.figures.push({ slide, boxId, valueKey: rv.key, display: rv.display });
}

/** One fitted text box; RTL boxes that widen grow to the left. */
function textBox(
  ctx: Ctx, slide: number, id: string, visualId: string, frame: { x: number; y: number; w: number; h: number },
  text: string, style: { sizePx: number; weight: 400 | 700; color: string; maxLines: 1 | 2 }, valueKeys: string[],
): TextBox {
  const fit = fitText(text, { w: frame.w, basePx: style.sizePx, weight: style.weight, maxLines: style.maxLines }, ctx.m);
  pushFit(ctx, fit, slide, visualId);
  const w = Math.max(frame.w, fit.widthPx);
  return {
    kind: "text", id, visualId, x: Math.max(0, frame.x + frame.w - w), y: frame.y, w, h: frame.h,
    sizePx: fit.sizePx, weight: style.weight, color: style.color, lines: fit.lines.map(splitRuns), valueKeys,
  };
}

function visualBoxes(ctx: Ctx, slide: number, v: VisualSpec, r: ResolvedVisual | undefined): LayoutBox[] {
  const frame = gridToPx(v.frame);
  const id = (n: number) => `s${slide}-${v.visualId}-${n}`;
  const tone = (fallback: "primary" | "neutral") => ctx.theme.tones[v.format?.tone ?? fallback];
  const cells = r?.cells ?? [];
  if (v.type === "text") {
    const keys: string[] = [];
    const text = (v.text ?? "")
      .replace(MEASURE_REF, (_, mid: string) => {
        const rv = cells.find((c) => c.measureId === mid) ?? ctx.values.get(mid);
        if (!rv) return "-";
        if (!keys.includes(rv.key)) keys.push(rv.key);
        return rv.display;
      })
      .replace(PARAM_REF, (_, pid: string) => {
        const p = ctx.params.values[pid];
        return p === undefined ? "-" : String(p);
      });
    const box = textBox(ctx, slide, id(0), v.visualId, frame, text, {
      sizePx: v.format?.sizePx ?? TEXT_PX, weight: v.format?.weight ?? 400, color: tone("neutral"), maxLines: 2,
    }, keys);
    for (const k of keys) figure(ctx, slide, box.id, ctx.values.get(k) ?? cells.find((c) => c.key === k)!);
    return [box];
  }
  if (v.type === "kpiBand") {
    const n = Math.max(1, cells.length);
    const tileW = Math.floor((frame.w - KPI_GAP * (n - 1)) / n);
    const out: LayoutBox[] = [];
    let k = 0;
    cells.forEach((c, i) => {
      // Logical order runs right to left on an RTL slide.
      const x = frame.x + frame.w - (i + 1) * tileW - i * KPI_GAP;
      out.push({ kind: "rect", id: id(k++), x, y: frame.y, w: tileW, h: frame.h, fill: ctx.theme.ink.panel });
      const inner = { x: x + CELL_PAD, w: tileW - 2 * CELL_PAD };
      const valueH = Math.round(frame.h * 0.55);
      const valueBox = textBox(ctx, slide, id(k++), v.visualId, { ...inner, y: frame.y, h: valueH }, c.display, {
        sizePx: KPI_VALUE_PX, weight: 700, color: tone("primary"), maxLines: 1,
      }, [c.key]);
      figure(ctx, slide, valueBox.id, c);
      const label = ctx.measures.get(c.measureId)?.label ?? c.measureId;
      const labelBox = textBox(ctx, slide, id(k++), v.visualId, { ...inner, y: frame.y + valueH, h: frame.h - valueH }, label, {
        sizePx: KPI_LABEL_PX, weight: 400, color: ctx.theme.ink.muted, maxLines: 2,
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

type TablePage = (slide: number, continued: boolean) => LayoutBox[];

/** Fit a table once, then split its rows into pages; each page repeats the header. */
function tablePages(ctx: Ctx, v: VisualSpec, r: ResolvedVisual | undefined): TablePage[] {
  const frame = gridToPx(v.frame);
  const cells = r?.cells ?? [];
  const fields = (["rows", "axis", "columns", "legend"] as const)
    .flatMap((w) => (v.wells[w] ?? []).flatMap((x) => ("field" in x ? [x.field] : [])));
  const measureIds = [...new Set(cells.map((c) => c.measureId))];
  const perRow = (v.wells.values ?? []).filter((x) => "measure" in x).length || measureIds.length;
  const nRows = perRow === 0 ? 0 : Math.ceil(cells.length / perRow);
  const datasetId = cells[0]?.provenance.datasetId;
  const columns = ctx.spec.datasets.find((d) => d.id === datasetId)?.columns ?? [];
  const headers = [
    ...fields.map((f) => columns.find((c) => c.id === f)?.label ?? f),
    ...cells.slice(0, perRow).map((c) => ctx.measures.get(c.measureId)?.label ?? c.measureId),
  ];
  const body: { text: string; key?: string }[][] = Array.from({ length: nRows }, (_, ri) => {
    const row = cells.slice(ri * perRow, (ri + 1) * perRow);
    return [
      ...fields.map((f) => ({ text: row[0]?.group[f] ?? "-" })),
      ...row.map((c) => ({ text: c.display, key: c.key })),
    ];
  });
  const nCols = headers.length;
  if (nCols === 0) return [];

  const inner = Math.max(0, frame.w - 2 * CELL_PAD * nCols);
  const colInner = Array.from({ length: nCols }, (_, i) => Math.floor(inner / nCols) + (i < inner % nCols ? 1 : 0));
  const minInner = Array.from({ length: nCols }, (_, c) =>
    Math.max(0, ...body.map((row) => Math.ceil(ctx.m.width(row[c].text, TABLE_PX, 400) * FIT_SAFETY))));
  const fitted = fitTableHeaders(headers, colInner, minInner, TABLE_PX, ctx.m);
  const colW = fitted.colW.map((w) => w + 2 * CELL_PAD);

  const geometric = Math.floor((frame.h - HEADER_H) / ROW_H);
  const byCells = Math.floor(LIMITS.maxTableCellsPerPage / nCols);
  const perPage = Math.max(1, Math.min(geometric, byCells));
  const chunks: number[] = [];
  for (let start = 0; start < Math.max(1, nRows); start += perPage) chunks.push(start);

  return chunks.map((start) => (slide: number, continued: boolean): LayoutBox[] => {
    const boxId = `s${slide}-${v.visualId}-0`;
    if (geometric < 1) ctx.issues.push({ rule: "fit.tooLong", page: slide, visual: v.visualId, detail: "table frame shorter than one row" });
    const header: TextCell[] = fitted.fits.map((f, c) => {
      pushFit(ctx, f, slide, v.visualId);
      return { id: `${boxId}-r0c${c}`, lines: f.lines.map(splitRuns), sizePx: f.sizePx, weight: 700 };
    });
    const rows: TextCell[][] = body.slice(start, start + perPage).map((row, ri) => row.map((cell, c) => {
      const fit = fitText(cell.text, { w: fitted.colW[c], basePx: TABLE_PX, weight: 400, maxLines: 1 }, ctx.m);
      pushFit(ctx, fit, slide, v.visualId);
      const id = `${boxId}-r${ri + 1}c${c}`;
      if (cell.key !== undefined) {
        const rv = ctx.values.get(cell.key) ?? cells.find((x) => x.key === cell.key)!;
        figure(ctx, slide, id, rv);
      }
      const out: TextCell = { id, lines: fit.lines.map(splitRuns), sizePx: fit.sizePx, weight: 400 };
      if (cell.key !== undefined) out.valueKey = cell.key;
      return out;
    }));
    const box: TableBox = { kind: "table", id: boxId, visualId: v.visualId, x: frame.x, y: frame.y, colW, rowH: ROW_H, header, rows, continued };
    return [box];
  });
}
