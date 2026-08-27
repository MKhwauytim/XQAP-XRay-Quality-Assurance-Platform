/**
 * Demo debug tools — main-thread responsiveness sampling.
 *
 * Two independent samplers, both OFF until `startResponsivenessMonitor()` is
 * called (by `DemoDebugPanel`'s mount effect) and both OFF again on
 * `stopResponsivenessMonitor()` (its unmount effect) — this must cost nothing
 * for the overwhelming majority of sessions that never open the debug panel:
 *
 * - Frame delta: a `requestAnimationFrame` loop records the time between
 *   consecutive frames. A healthy tab holds close to the 16.6ms (60fps)
 *   budget; a period of jank (a slow synchronous render, a big JSON parse on
 *   the main thread) shows up directly as a spike, which is the closest
 *   browser-side proxy for "is the UI responsive right now" without pulling
 *   in `PerformanceObserver` long-task support (patchy across engines).
 * - Click latency: a capturing, passive click listener timestamps the click,
 *   then timestamps again on the next animation frame — the gap is roughly
 *   "how long before the browser could next paint after this interaction",
 *   a rough stand-in for click-to-paint responsiveness.
 *
 * Both feed bounded ring buffers (`ringBufferStore.ts`) so a long demo
 * session never grows this state unbounded.
 */
import { createRingBufferStore } from "./ringBufferStore";

export type FrameSample = { at: number; deltaMs: number };
export type ClickLatencySample = { at: number; latencyMs: number };

// ~3s of history at 60fps — enough to see a recent stutter without keeping a
// long tail of stale samples.
const MAX_FRAME_SAMPLES = 180;
const MAX_CLICK_SAMPLES = 20;

const frameStore = createRingBufferStore<FrameSample>(MAX_FRAME_SAMPLES);
const clickStore = createRingBufferStore<ClickLatencySample>(MAX_CLICK_SAMPLES);

export function getFrameSamples(): FrameSample[] {
  return frameStore.getAll();
}
export function subscribeFrameSamples(fn: () => void): () => void {
  return frameStore.subscribe(fn);
}
export function getClickLatencySamples(): ClickLatencySample[] {
  return clickStore.getAll();
}
export function subscribeClickLatencySamples(fn: () => void): () => void {
  return clickStore.subscribe(fn);
}

let rafHandle: number | null = null;
let lastFrameAt: number | null = null;
let clickListenerAttached = false;

function frameLoop(now: number): void {
  if (lastFrameAt !== null) {
    frameStore.push({ at: Date.now(), deltaMs: now - lastFrameAt });
  }
  lastFrameAt = now;
  rafHandle = requestAnimationFrame(frameLoop);
}

function handleClick(): void {
  const clickedAt = performance.now();
  requestAnimationFrame(() => {
    clickStore.push({ at: Date.now(), latencyMs: performance.now() - clickedAt });
  });
}

function hasRaf(): boolean {
  return typeof requestAnimationFrame === "function";
}

/** Idempotent — a second call while already running is a no-op. */
export function startResponsivenessMonitor(): void {
  if (!hasRaf()) return;
  if (rafHandle === null) {
    lastFrameAt = null;
    rafHandle = requestAnimationFrame(frameLoop);
  }
  if (!clickListenerAttached && typeof document !== "undefined") {
    document.addEventListener("click", handleClick, { passive: true, capture: true });
    clickListenerAttached = true;
  }
}

/** Idempotent — safe to call when not running. */
export function stopResponsivenessMonitor(): void {
  if (rafHandle !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(rafHandle);
  }
  rafHandle = null;
  lastFrameAt = null;
  if (clickListenerAttached && typeof document !== "undefined") {
    document.removeEventListener("click", handleClick, { capture: true });
    clickListenerAttached = false;
  }
}

/** @internal test-only. */
export function __resetResponsivenessMonitorForTests(): void {
  stopResponsivenessMonitor();
  frameStore.clear();
  clickStore.clear();
}
