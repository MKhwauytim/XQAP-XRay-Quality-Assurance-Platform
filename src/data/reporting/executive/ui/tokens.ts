// Centralized design tokens for the executive-report visual system.
// Single source of truth for spacing, type scale, and the color-role map.
// References the CSS variable names defined in theme.ts (--gold, --blue, …) so
// charts/icons theme automatically. Pure data + tiny string helpers — no DOM,
// no React, no side effects.

/** Spacing scale (px). Used for page/chart padding, gaps, and gutters. */
export const SPACE = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;
export type SpaceKey = keyof typeof SPACE;

/** Type scale (px). Chart labels/values pick from this so sizing stays uniform. */
export const TYPE = {
  micro: 9,
  caption: 11,
  body: 13,
  label: 15,
  subtitle: 18,
  title: 24,
  display: 42,
} as const;
export type TypeKey = keyof typeof TYPE;

/** Font-weight scale matching the Somar faces shipped in theme.ts. */
export const WEIGHT = {
  light: 300,
  regular: 400,
  medium: 500,
  bold: 700,
  black: 900,
} as const;

/** Border-radius scale (px). */
export const RADIUS = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

/**
 * Color-role map. Each role resolves to a CSS variable name from theme.ts so
 * SVG fills/strokes can read `var(--…)` and inherit the active theme. Use
 * `cssVar(role)` to get the `var(--…)` string for an SVG attribute.
 */
export const COLOR_ROLE = {
  // brand / accents
  primary: "gold",
  primaryAlt: "gold-2",
  info: "blue",
  success: "green",
  danger: "coral",
  neutral: "slate",
  accentCyan: "cyan",
  accentPurple: "purple",
  // surfaces / text
  surface: "navy",
  surfaceAlt: "navy-2",
  panel: "panel",
  text: "white",
  muted: "muted",
  line: "line",
} as const;
export type ColorRole = keyof typeof COLOR_ROLE;

/**
 * Ordered palette used to color multi-series charts (grouped/stacked bars,
 * donut segments). Cycles when there are more series than entries.
 */
export const SERIES_ROLES: ColorRole[] = [
  "primary",
  "info",
  "success",
  "danger",
  "accentCyan",
  "accentPurple",
  "neutral",
];

/** The font stack used by chart text (mirrors theme.ts body font). */
export const FONT_FAMILY =
  '"Somar","IBM Plex Sans Arabic","Noto Kufi Arabic","Tahoma","Arial",sans-serif';

/** Resolve a color role to the theme CSS-variable name (e.g. "gold"). */
export function colorVarName(role: ColorRole): string {
  return COLOR_ROLE[role];
}

/** Resolve a color role to a `var(--…)` string for SVG fill/stroke attributes. */
export function cssVar(role: ColorRole): string {
  return `var(--${COLOR_ROLE[role]})`;
}

/** Pick a series color (by index, cycling) as a `var(--…)` string. */
export function seriesColor(index: number): string {
  const role = SERIES_ROLES[index % SERIES_ROLES.length];
  return cssVar(role);
}

/**
 * Emit the token scales as a CSS custom-property block. Optional helper for any
 * builder that wants the scale available as CSS variables on a wrapper element.
 * Returns the inner declarations only (no selector braces).
 */
export function tokensCss(): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(SPACE)) lines.push(`--space-${k}:${v}px;`);
  for (const [k, v] of Object.entries(TYPE)) lines.push(`--type-${k}:${v}px;`);
  for (const [k, v] of Object.entries(RADIUS)) lines.push(`--radius-${k}:${v}px;`);
  return lines.join("");
}

/** Clamp a number into [min,max]; NaN → min. Shared by chart math. */
export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return n < min ? min : n > max ? max : n;
}

/** Clamp a percentage into 0–100; null stays null (rendered as "—"). */
export function clampPct(n: number | null): number | null {
  if (n === null || Number.isNaN(n)) return null;
  return clamp(n, 0, 100);
}
