/* @vitest-environment jsdom */
// B6 — Inspector: (1) every control must render disabled for a view-only user
// (canEdit=false) instead of only being rejected ~800ms later by the editor's debounced
// autosave; (2) a new KPI config block (aggregation select + bound-field display +
// clear-grouping action) replaces the old blanket "لاحقاً" placeholder for kind="kpi".
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Inspector from "./Inspector";
import type { Element } from "../../../../../data/reportDesigner/reportTypes";

afterEach(cleanup);

function textElement(): Element {
  return {
    elementId: "el-1",
    type: "text",
    name: "عنصر نصي",
    x: 0, y: 0, w: 100, h: 40, z: 0,
    style: { fill: "#ffffff" },
    config: { kind: "text", text: "مرحبا" },
  };
}

function kpiElement(overrides: Partial<Element> = {}): Element {
  return {
    elementId: "el-kpi",
    type: "kpi",
    name: "عدد الصور",
    x: 0, y: 0, w: 160, h: 100, z: 0,
    style: {},
    config: { kind: "kpi", dataSourceId: "population", valueField: "xrayImageId", agg: "count" },
    ...overrides,
  };
}

describe("Inspector — B6 canEdit gating", () => {
  it("returns nothing when no element is selected", () => {
    const { container } = render(<Inspector element={null} onUpdate={vi.fn()} canEdit={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("disables every input/select/textarea when canEdit=false", () => {
    const { container } = render(<Inspector element={textElement()} onUpdate={vi.fn()} canEdit={false} />);
    const controls = container.querySelectorAll("input, select, textarea");
    expect(controls.length).toBeGreaterThan(0);
    for (const el of Array.from(controls)) {
      expect(el).toBeDisabled();
    }
  });

  it("enables the name field when canEdit=true", () => {
    render(<Inspector element={textElement()} onUpdate={vi.fn()} canEdit={true} />);
    expect(screen.getByDisplayValue("عنصر نصي")).not.toBeDisabled();
  });

  it("calling onUpdate from the name field still works when canEdit=true (no accidental block)", () => {
    const onUpdate = vi.fn();
    render(<Inspector element={textElement()} onUpdate={onUpdate} canEdit={true} />);
    const nameInput = screen.getByDisplayValue("عنصر نصي");
    fireEvent.change(nameInput, { target: { value: "اسم جديد" } });
    expect(onUpdate).toHaveBeenCalled();
  });
});

describe("Inspector — B6 KPI config block", () => {
  it("shows the bound field (read-only) and an aggregation select instead of the generic placeholder", () => {
    render(<Inspector element={kpiElement()} onUpdate={vi.fn()} canEdit={true} />);
    expect(screen.queryByText("سيتم الدعم في مرحلة لاحقة.")).not.toBeInTheDocument();
    const boundField = screen.getByDisplayValue("xrayImageId") as HTMLInputElement;
    expect(boundField).toBeDisabled();
    const aggSelect = screen.getByDisplayValue("عدد") as HTMLSelectElement;
    expect(aggSelect.tagName).toBe("SELECT");
  });

  it("changing the aggregation select calls onUpdate with the new agg", () => {
    const onUpdate = vi.fn();
    render(<Inspector element={kpiElement()} onUpdate={onUpdate} canEdit={true} />);
    const aggSelect = screen.getByDisplayValue("عدد");
    fireEvent.change(aggSelect, { target: { value: "sum" } });
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ config: expect.objectContaining({ agg: "sum" }) })
    );
  });

  it("disables the aggregation select and hides no groupBy row when there is no grouping", () => {
    render(<Inspector element={kpiElement()} onUpdate={vi.fn()} canEdit={false} />);
    const aggSelect = screen.getByDisplayValue("عدد") as HTMLSelectElement;
    expect(aggSelect).toBeDisabled();
    expect(screen.queryByText("إزالة")).not.toBeInTheDocument();
  });

  it("shows a clear-grouping action when groupByField is set, gated by canEdit", () => {
    const grouped = kpiElement({
      config: { kind: "kpi", dataSourceId: "population", valueField: "xrayImageId", agg: "count", groupByField: "portName", groupByLabel: "المنفذ" },
    });
    const onUpdate = vi.fn();
    render(<Inspector element={grouped} onUpdate={onUpdate} canEdit={true} />);
    expect(screen.getByDisplayValue("المنفذ")).toBeDisabled();
    const clearBtn = screen.getByText("إزالة");
    expect(clearBtn).not.toBeDisabled();
    fireEvent.click(clearBtn);
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ groupByField: undefined, groupByLabel: undefined }),
      })
    );
  });

  it("disables the clear-grouping button when canEdit=false", () => {
    const grouped = kpiElement({
      config: { kind: "kpi", dataSourceId: "population", valueField: "xrayImageId", agg: "count", groupByField: "portName", groupByLabel: "المنفذ" },
    });
    render(<Inspector element={grouped} onUpdate={vi.fn()} canEdit={false} />);
    expect(screen.getByText("إزالة")).toBeDisabled();
  });

  it("still shows the generic placeholder for table/chart element kinds", () => {
    const tableEl: Element = {
      elementId: "el-table",
      type: "table",
      name: "جدول",
      x: 0, y: 0, w: 200, h: 100, z: 0,
      style: {},
      config: { kind: "table", dataSourceId: "population", columns: [], groupBy: [], filters: [] },
    };
    render(<Inspector element={tableEl} onUpdate={vi.fn()} canEdit={true} />);
    expect(screen.getByText("سيتم الدعم في مرحلة لاحقة.")).toBeInTheDocument();
  });
});
