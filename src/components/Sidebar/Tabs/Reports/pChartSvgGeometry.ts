export const P_CHART_SVG = {
  width: 960,
  height: 320,
  plot: { top: 16, right: 888, bottom: 242, left: 24 },
} as const;

export type SvgPoint = {
  x: number;
  pY: number;
  uclY: number;
  lclY: number;
};

export type PChartSvgGeometry = {
  points: SvgPoint[];
  centerY: number;
  upperPath: string;
  lowerPath: string;
  bandPath: string;
};

type PChartGeometryInput = {
  pPct: number;
  uclPct: number;
  lclPct: number;
};

function svgNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function stepPath(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points
    .slice(1)
    .reduce(
      (path, point) =>
        `${path} H ${svgNumber(point.x)} V ${svgNumber(point.y)}`,
      `M ${svgNumber(points[0]!.x)} ${svgNumber(points[0]!.y)}`,
    );
}

/** Pure geometry helper kept separate for deterministic chart regression tests. */
export function buildPChartSvgGeometry(
  values: readonly PChartGeometryInput[],
  centerPct: number,
): PChartSvgGeometry {
  const { plot } = P_CHART_SVG;
  const plotWidth = plot.right - plot.left;
  const plotHeight = plot.bottom - plot.top;
  const clampPct = (value: number) => Math.max(0, Math.min(100, value));
  const yFor = (value: number) =>
    plot.top + ((100 - clampPct(value)) / 100) * plotHeight;
  const xFor = (index: number) =>
    values.length === 1
      ? plot.left + plotWidth / 2
      : plot.right - (index * plotWidth) / Math.max(1, values.length - 1);

  const points = values.map((value, index) => ({
    x: xFor(index),
    pY: yFor(value.pPct),
    uclY: yFor(value.uclPct),
    lclY: yFor(value.lclPct),
  }));
  const upper = points.map((point) => ({ x: point.x, y: point.uclY }));
  const lower = points.map((point) => ({ x: point.x, y: point.lclY }));
  const upperPath = stepPath(upper);
  const lowerPath = stepPath(lower);
  const reversedLower = [...lower].reverse();
  const bandPath =
    points.length === 0
      ? ""
      : `${upperPath} L ${svgNumber(reversedLower[0]!.x)} ${svgNumber(reversedLower[0]!.y)} ${reversedLower
          .slice(1)
          .map((point) => `H ${svgNumber(point.x)} V ${svgNumber(point.y)}`)
          .join(" ")} Z`;

  return {
    points,
    centerY: yFor(centerPct),
    upperPath,
    lowerPath,
    bandPath,
  };
}
