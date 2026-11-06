import type { EngineIssue } from "../errors";
import type { MeasureSpec } from "../spec/types";
import type { Run } from "./bidiRuns";

/** Absolute layout model. Every position and size is in px on the 1920x1080 slide. */

export interface TextBox {
  kind: "text";
  id: string;
  visualId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sizePx: number;
  weight: 400 | 700;
  color: string;
  lines: Run[][];
  valueKeys: string[];
}

/** `id = {boxId}-r{row}c{col}`; row 0 is the header (C24). */
export interface TextCell {
  id: string;
  lines: Run[][];
  sizePx: number;
  weight: 400 | 700;
  valueKey?: string;
  /** Dimension cells: the row's group, encoded as in the value key (the part after `measureId@`). */
  groupKey?: string;
}

export interface TableBox {
  kind: "table";
  id: string;
  visualId: string;
  x: number;
  y: number;
  colW: number[];
  rowH: number;
  header: TextCell[];
  rows: TextCell[][];
  /** True on every page of the table after the first. */
  continued: boolean;
}

export interface BarChartBox {
  kind: "bar";
  id: string;
  visualId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  categories: string[];
  values: (number | null)[];
  valueKeys: string[];
  format: MeasureSpec["format"];
  color: string;
}

export interface RectBox {
  kind: "rect";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

export interface RuleBox {
  kind: "rule";
  id: string;
  x: number;
  y: number;
  w: number;
  color: string;
}

export type LayoutBox = TextBox | TableBox | BarChartBox | RectBox | RuleBox;

export interface LayoutSlide {
  /** 1-based (C24). */
  index: number;
  pageId: string;
  title: string;
  boxes: LayoutBox[];
}

export interface LayoutFigure {
  /** 1-based slide index. */
  slide: number;
  /** The text box id, or the table cell id for a table figure. */
  boxId: string;
  valueKey: string;
  display: string;
}

/**
 * Text a slide shows that is not a figure but holds digits: a rendered param value, static template text such
 * as a year, a title, a dimension label or a chart category. The figure-parity gate expects these digits too.
 */
export interface NonFigureSpan {
  slide: number;
  boxId: string;
  text: string;
}

export interface LayoutDoc {
  width: 1920;
  height: 1080;
  slides: LayoutSlide[];
  figures: LayoutFigure[];
  nonFigureSpans: NonFigureSpan[];
  /** Fit errors and `limit.slides`. */
  issues: EngineIssue[];
}
