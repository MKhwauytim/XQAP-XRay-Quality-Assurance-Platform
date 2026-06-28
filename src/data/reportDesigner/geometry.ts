export type Rect = { x: number; y: number; w: number; h: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function snap(value: number, grid: number): number {
  if (grid <= 0) return value;
  return Math.round(value / grid) * grid;
}

export function snapRect(rect: Rect, grid: number): Rect {
  return { x: snap(rect.x, grid), y: snap(rect.y, grid), w: snap(rect.w, grid), h: snap(rect.h, grid) };
}

export function resize(rect: Rect, handle: ResizeHandle, dx: number, dy: number, minW = 8, minH = 8): Rect {
  let { x, y, w, h } = rect;
  if (handle.includes("e")) w = Math.max(minW, w + dx);
  if (handle.includes("s")) h = Math.max(minH, h + dy);
  if (handle.includes("w")) { const nw = Math.max(minW, w - dx); x += w - nw; w = nw; }
  if (handle.includes("n")) { const nh = Math.max(minH, h - dy); y += h - nh; h = nh; }
  return { x, y, w, h };
}

export function hitTest(rect: Rect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}
