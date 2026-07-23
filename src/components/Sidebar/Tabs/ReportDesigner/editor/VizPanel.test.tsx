/* @vitest-environment jsdom */
// B6 — VizPanel must disable "add element" affordances (click AND drag-start) for a
// view-only user, and forward canEdit down into Inspector so the selected element's
// properties render disabled too.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VizPanel from "./VizPanel";
import type { Element } from "../../../../../data/reportDesigner/reportTypes";

afterEach(cleanup);

function selectedTextElement(): Element {
  return {
    elementId: "el-1",
    type: "text",
    name: "عنصر نصي",
    x: 0, y: 0, w: 100, h: 40, z: 0,
    style: {},
    config: { kind: "text", text: "مرحبا" },
  };
}

describe("VizPanel — B6 canEdit gating", () => {
  it("disables all four viz-type buttons when canEdit=false", () => {
    render(
      <VizPanel selectedElement={null} onAddElement={vi.fn()} onImageSelected={vi.fn()} onUpdate={vi.fn()} canEdit={false} />
    );
    for (const label of ["نص", "شكل", "صورة", "خط"]) {
      expect(screen.getByTitle(label)).toBeDisabled();
    }
  });

  it("does not call onAddElement when a disabled viz button is clicked", () => {
    const onAddElement = vi.fn();
    render(
      <VizPanel selectedElement={null} onAddElement={onAddElement} onImageSelected={vi.fn()} onUpdate={vi.fn()} canEdit={false} />
    );
    fireEvent.click(screen.getByTitle("نص"));
    expect(onAddElement).not.toHaveBeenCalled();
  });

  it("marks draggable viz buttons non-draggable when canEdit=false", () => {
    render(
      <VizPanel selectedElement={null} onAddElement={vi.fn()} onImageSelected={vi.fn()} onUpdate={vi.fn()} canEdit={false} />
    );
    expect(screen.getByTitle("نص").getAttribute("draggable")).toBe("false");
    expect(screen.getByTitle("شكل").getAttribute("draggable")).toBe("false");
  });

  it("enables the viz-type buttons and calls onAddElement when canEdit=true", () => {
    const onAddElement = vi.fn();
    render(
      <VizPanel selectedElement={null} onAddElement={onAddElement} onImageSelected={vi.fn()} onUpdate={vi.fn()} canEdit={true} />
    );
    const textBtn = screen.getByTitle("نص");
    expect(textBtn).not.toBeDisabled();
    expect(textBtn.getAttribute("draggable")).toBe("true");
    fireEvent.click(textBtn);
    expect(onAddElement).toHaveBeenCalledWith("text");
  });

  it("forwards canEdit=false into Inspector so the selected element's fields render disabled", () => {
    const { container } = render(
      <VizPanel selectedElement={selectedTextElement()} onAddElement={vi.fn()} onImageSelected={vi.fn()} onUpdate={vi.fn()} canEdit={false} />
    );
    const nameInput = screen.getByDisplayValue("عنصر نصي");
    expect(nameInput).toBeDisabled();
    // Sanity: Inspector actually rendered (not just an empty panel).
    expect(container.querySelector(".rd-inspector")).toBeTruthy();
  });

  it("forwards canEdit=true into Inspector so the selected element's fields render enabled", () => {
    render(
      <VizPanel selectedElement={selectedTextElement()} onAddElement={vi.fn()} onImageSelected={vi.fn()} onUpdate={vi.fn()} canEdit={true} />
    );
    expect(screen.getByDisplayValue("عنصر نصي")).not.toBeDisabled();
  });
});
