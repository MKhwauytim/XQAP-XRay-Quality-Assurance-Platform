import type { ExecutiveRenderContext } from "./context";
import { buildViewerHtml } from "./viewer";

export function assembleReport(
  ctx: ExecutiveRenderContext,
  pageBuilders: Array<(ctx: ExecutiveRenderContext) => string>,
): string {
  const slides = pageBuilders.map(fn => fn(ctx)).join("\n");
  return buildViewerHtml(slides, ctx.monthLabel);
}
