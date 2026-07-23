/* @vitest-environment jsdom */
// B6 — Canvas view-only decoupling: a supervisor without report-designer.edit can now
// reach the editor (see ReportDesigner/index.tsx canViewDesigns fix) and should be able
// to click an element to inspect it, but never drag/resize/mutate it. Canvas expresses
// this via a new `canEdit` prop that (when mode="edit") gates drag/resize separately from
// click-to-select.
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Canvas from "./Canvas";
import { createEmptyDocument, createElementId } from "../../../../../data/reportDesigner/reportTypes";
import type { Element, ReportDocument } from "../../../../../data/reportDesigner/reportTypes";

afterEach(cleanup);

function docWithOneElement(): { doc: ReportDocument; elementId: string } {
  const doc = createEmptyDocument("تقرير اختبار", "tester");
  const elementId = createElementId();
  const el: Element = {
    elementId,
    type: "text",
    name: "عنصر",
    x: 10, y: 10, w: 100, h: 40, z: 0,
    style: {},
    config: { kind: "text", text: "مرحبا" },
  };
  doc.pages[0].elements.push(el);
  return { doc, elementId };
}

describe("Canvas — B6 view-only decoupling", () => {
  it("still allows click-to-select for inspection when canEdit=false", () => {
    const { doc, elementId } = docWithOneElement();
    const onSelect = vi.fn();
    const { container } = render(
      <Canvas doc={doc} pageIndex={0} selectedId={null} onSelect={onSelect} mode="edit" canEdit={false} onElementChange={vi.fn()} />
    );
    const wrapper = container.querySelector(`[data-rd-id="${elementId}"]`) as HTMLElement;
    expect(wrapper).toBeTruthy();
    fireEvent.click(wrapper);
    expect(onSelect).toHaveBeenCalledWith(elementId);
  });

  it("hides resize handles for a selected element when canEdit=false", () => {
    const { doc, elementId } = docWithOneElement();
    const { container } = render(
      <Canvas doc={doc} pageIndex={0} selectedId={elementId} onSelect={vi.fn()} mode="edit" canEdit={false} onElementChange={vi.fn()} />
    );
    expect(container.querySelectorAll(".rd-resize-handle").length).toBe(0);
  });

  it("shows resize handles for a selected element when canEdit=true (default)", () => {
    const { doc, elementId } = docWithOneElement();
    const { container } = render(
      <Canvas doc={doc} pageIndex={0} selectedId={elementId} onSelect={vi.fn()} mode="edit" onElementChange={vi.fn()} />
    );
    expect(container.querySelectorAll(".rd-resize-handle").length).toBe(8);
  });

  it("never calls onElementChange from a pointer sequence when canEdit=false (no drag handler wired)", () => {
    const { doc, elementId } = docWithOneElement();
    const onElementChange = vi.fn();
    const { container } = render(
      <Canvas doc={doc} pageIndex={0} selectedId={null} onSelect={vi.fn()} mode="edit" canEdit={false} onElementChange={onElementChange} />
    );
    const wrapper = container.querySelector(`[data-rd-id="${elementId}"]`) as HTMLElement;
    fireEvent.pointerDown(wrapper, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(container.querySelector(".rd-canvas") as HTMLElement, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(container.querySelector(".rd-canvas") as HTMLElement, { clientX: 40, clientY: 40 });
    expect(onElementChange).not.toHaveBeenCalled();
  });

  it("uses a 'pointer' cursor (not 'move') on an unlocked element when canEdit=false", () => {
    const { doc, elementId } = docWithOneElement();
    const { container } = render(
      <Canvas doc={doc} pageIndex={0} selectedId={null} onSelect={vi.fn()} mode="edit" canEdit={false} onElementChange={vi.fn()} />
    );
    const wrapper = container.querySelector(`[data-rd-id="${elementId}"]`) as HTMLElement;
    expect(wrapper.style.cursor).toBe("pointer");
  });

  it("mode='view' (design-list thumbnail) stays fully inert even if canEdit is left at its true default", () => {
    const { doc, elementId } = docWithOneElement();
    const onSelect = vi.fn();
    const { container } = render(
      <Canvas doc={doc} pageIndex={0} selectedId={elementId} onSelect={onSelect} mode="view" zoom={0.3} />
    );
    const wrapper = container.querySelector(`[data-rd-id="${elementId}"]`) as HTMLElement;
    fireEvent.click(wrapper);
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelectorAll(".rd-resize-handle").length).toBe(0);
  });
});
