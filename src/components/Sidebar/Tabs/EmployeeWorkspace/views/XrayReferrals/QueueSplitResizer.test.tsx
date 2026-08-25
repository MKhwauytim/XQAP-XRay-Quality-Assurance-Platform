/* @vitest-environment jsdom */
// The divider is pure geometry, and jsdom has none — so the fixture supplies
// it explicitly. That is the point: the two things that can actually be wrong
// here are (a) the RTL sign (dragging left must WIDEN the right-hand queue,
// not narrow it) and (b) the clamp against the two pixel minimums the CSS
// still enforces underneath. Both are computed in JS, both are testable, and
// neither is visible in a screenshot until it is already wrong.
//
// NOTE on deviations from the plan's literal test numbers: two adjustments
// were required to make this suite internally consistent with the design
// decision (also pinned by the "refuses to drag..." test below) that a drag
// must never push either column past its CSS pixel floor:
//   1. "RTL: dragging LEFT widens the queue column" originally targeted
//      clientX 500 (queueWidth 600/1000 = 60%), which is PAST the 55.6% max
//      this fixture's own floors allow (430px panel floor, 14px gutter, 1000px
//      container) -- the same bound the "refuses to drag..." test pins two
//      cases below. Retargeted to clientX 550 (55%), which still demonstrates
//      widening (> the 53.49% default) and stays inside the enforced range.
//   2. `offsetParent` cannot be used to detect the stacked/hidden state (see
//      QueueSplitResizer.tsx): it is permanently null under jsdom regardless
//      of visibility, which would fail every drag test below before it could
//      start. The component checks `getComputedStyle(...).display` instead.
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { __resetQueueSplitCacheForTests, getQueueSplit } from "../../../../../../data/preferences/queueSplitStore";
import QueueSplitResizer from "./QueueSplitResizer";

const GRID_LEFT = 100;
const GRID_WIDTH = 1000;   // right edge at 1100

function renderInGrid(direction: "rtl" | "ltr" = "rtl") {
  const grid = document.createElement("div");
  grid.className = "ew-ref-queue ew-xr-grid";
  grid.style.direction = direction;
  grid.getBoundingClientRect = () => ({
    left: GRID_LEFT, right: GRID_LEFT + GRID_WIDTH, width: GRID_WIDTH,
    top: 0, bottom: 800, height: 800, x: GRID_LEFT, y: 0, toJSON: () => ({}),
  }) as DOMRect;
  const panelCol = document.createElement("div");
  panelCol.className = "ew-xr-panel-col";
  grid.appendChild(panelCol);
  document.body.appendChild(grid);
  const view = render(<QueueSplitResizer />, { container: panelCol });
  return { grid, view };
}

beforeEach(() => { localStorage.clear(); __resetQueueSplitCacheForTests(); });
afterEach(() => { cleanup(); document.body.innerHTML = ""; });

it("applies the stored split to the grid on first paint, not after a delay", () => {
  // Applied from a layout effect: applying it from an ordinary effect would
  // paint one frame at the default and then jump, which reads as a layout bug
  // on every visit to this page.
  localStorage.setItem("xray_queue_split_v1", "0.62");
  __resetQueueSplitCacheForTests();
  const { grid } = renderInGrid();
  expect(grid.style.getPropertyValue("--ew-xr-queue-basis")).toBe("62%");
});

it("RTL: dragging LEFT widens the queue column", () => {
  const { grid, view } = renderInGrid("rtl");
  const handle = view.getByRole("separator");
  fireEvent.pointerDown(handle, { clientX: 635, pointerId: 1, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 550, pointerId: 1 });   // moved left
  // Queue occupies from the grid's RIGHT edge to the pointer: 1100 - 550 = 550
  // -> 55%, inside the 55.6% ceiling the panel's own 430px floor allows here,
  // and above the 53.49% default -- so this is unambiguously a widening drag.
  expect(grid.style.getPropertyValue("--ew-xr-queue-basis")).toBe("55%");
  fireEvent.pointerUp(handle, { clientX: 550, pointerId: 1 });
  expect(getQueueSplit()).toBeCloseTo(0.55, 3);
});

it("LTR: the same drag narrows it — direction comes from the container, not a constant", () => {
  const { grid, view } = renderInGrid("ltr");
  const handle = view.getByRole("separator");
  fireEvent.pointerDown(handle, { clientX: 635, pointerId: 1, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 });
  // Queue occupies from the grid's LEFT edge to the pointer: 500 - 100 = 400.
  expect(grid.style.getPropertyValue("--ew-xr-queue-basis")).toBe("40%");
});

it("refuses to drag either column below the minimum the CSS still enforces", () => {
  const { grid, view } = renderInGrid("rtl");
  const handle = view.getByRole("separator");
  fireEvent.pointerDown(handle, { clientX: 635, pointerId: 1, button: 0 });
  // Far past the right edge: would give the panel column ~0px.
  fireEvent.pointerMove(handle, { clientX: 90, pointerId: 1 });
  const basis = Number.parseFloat(grid.style.getPropertyValue("--ew-xr-queue-basis"));
  // 1000px container, 14px gutter, 430px panel floor ⇒ queue ≤ 55.6%.
  expect(basis).toBeLessThanOrEqual(55.6);
  // …and the opposite end respects the queue's own 340px floor.
  fireEvent.pointerMove(handle, { clientX: 1090, pointerId: 1 });
  expect(Number.parseFloat(grid.style.getPropertyValue("--ew-xr-queue-basis")))
    .toBeGreaterThanOrEqual(34);
});

it("persists only on release, never on every pointermove", () => {
  const { view } = renderInGrid("rtl");
  const handle = view.getByRole("separator");
  fireEvent.pointerDown(handle, { clientX: 635, pointerId: 1, button: 0 });
  fireEvent.pointerMove(handle, { clientX: 520, pointerId: 1 });
  expect(localStorage.getItem("xray_queue_split_v1")).toBeNull();
  fireEvent.pointerUp(handle, { clientX: 520, pointerId: 1 });
  expect(localStorage.getItem("xray_queue_split_v1")).not.toBeNull();
});

it("is operable from the keyboard, and Home resets it", () => {
  const { grid, view } = renderInGrid("rtl");
  const handle = view.getByRole("separator");
  // ArrowLeft moves the divider LEFT, which in RTL widens the queue.
  const before = Number.parseFloat(grid.style.getPropertyValue("--ew-xr-queue-basis"));
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(Number.parseFloat(grid.style.getPropertyValue("--ew-xr-queue-basis"))).toBeGreaterThan(before);
  fireEvent.keyDown(handle, { key: "Home" });
  expect(localStorage.getItem("xray_queue_split_v1")).toBeNull();
});

it("exposes its position to assistive tech", () => {
  const { view } = renderInGrid("rtl");
  const handle = view.getByRole("separator");
  expect(handle).toHaveAttribute("aria-orientation", "vertical");
  expect(handle).toHaveAttribute("aria-valuenow");
  expect(handle).toHaveAttribute("tabindex", "0");
});
