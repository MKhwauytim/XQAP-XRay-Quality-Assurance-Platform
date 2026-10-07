/* @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../../data/storage/memoryDirectory";
import type { TrackingRow } from "../../../../../../data/tracking/deadlineTracking";
import ResultsTracking from "./ResultsTracking";

afterEach(cleanup);

// October 2026 starts on a Thursday: Saturday-first, five blank cells precede day 1.
const LEAD = 5;
const NOW = new Date(2026, 9, 14);

function rows(spec: Array<["completed" | "hold" | "pending", string | null, number]>): TrackingRow[] {
  return spec.flatMap(([state, doneAt, n]) =>
    Array.from({ length: n }, () => ({ assignedTo: "emp1", state, doneAt })),
  );
}

const DATA = rows([
  ["completed", "2026-10-02T10:00:00", 4], // Friday — employees do work it
  ["completed", "2026-10-05T10:00:00", 6], // Monday
  ["hold", "2026-10-05T11:00:00", 2],
  ["pending", null, 28],
]);

function mount(canEditDeadline: boolean) {
  const root = createMemoryDirectory();
  const utils = render(
    <ResultsTracking
      monthFolder="10-october-2026"
      rows={DATA}
      assignedAtByUser={{ emp1: "2026-10-01T08:00:00" }}
      directoryHandle={root}
      canEditDeadline={canEditDeadline}
      username="admin"
      now={NOW}
    />,
  );
  const cell = (day: number) =>
    utils.container.querySelectorAll<HTMLButtonElement>(".trk-cell")[LEAD + day - 1];
  return { ...utils, cell };
}

describe("ResultsTracking", () => {
  it("shows the default deadline (last day − 3) with the default badge", () => {
    mount(true);
    expect(screen.getByText("افتراضي")).toBeTruthy();
    expect(screen.getByText(/28/, { selector: ".trk-deadline-date span" })).toBeTruthy();
  });

  it("an admin can edit and then reset the deadline; others see it read-only", async () => {
    const { unmount } = mount(true);
    fireEvent.click(screen.getByRole("button", { name: "تعديل الموعد" }));
    fireEvent.change(screen.getByLabelText("التاريخ الجديد"), { target: { value: "2026-10-20" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    await waitFor(() => expect(screen.getByText("معدّل")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "استعادة الافتراضي" }));
    await waitFor(() => expect(screen.getByText("افتراضي")).toBeTruthy());
    unmount();

    mount(false);
    expect(screen.queryByRole("button", { name: "تعديل الموعد" })).toBeNull();
    expect(screen.getByText("تعديل الموعد متاح للمدير فقط")).toBeTruthy();
  });

  it("rejects a date outside the month", async () => {
    mount(true);
    fireEvent.click(screen.getByRole("button", { name: "تعديل الموعد" }));
    fireEvent.change(screen.getByLabelText("التاريخ الجديد"), { target: { value: "2026-11-03" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));
    expect((await screen.findByRole("alert")).textContent).toContain("داخل الشهر");
  });

  it("clicking a day filters the summary and table to it; clicking it again shows every day", () => {
    const { cell } = mount(true);
    expect(screen.getByText("ملخّص التقدّم")).toBeTruthy();

    fireEvent.click(cell(5));
    expect(cell(5).getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText("ملخّص التقدّم")).toBeNull();
    expect(screen.getByText("مكتملة في هذا اليوم")).toBeTruthy();
    expect(screen.getByText("إلغاء التحديد ✕")).toBeTruthy();

    fireEvent.click(cell(5));
    expect(cell(5).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("ملخّص التقدّم")).toBeTruthy();
  });

  it("Friday and Saturday stay greyed but are clickable and show the numbers worked on them", () => {
    const { cell } = mount(true);
    const friday = cell(2);
    expect(friday.className).toContain("trk-cell--weekend");
    expect(friday.disabled).toBe(false);
    // 4 completed on the Friday, no quota target on a weekend
    expect(friday.textContent).toContain("4");

    fireEvent.click(friday);
    expect(friday.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("مكتملة في هذا اليوم")).toBeTruthy();
  });

  it("the tile row reflects the 0 weekend quota on a selected weekend day", () => {
    const { cell, container } = mount(true);
    fireEvent.click(cell(2));
    const tiles = [...container.querySelectorAll(".trk-tile")].map((t) => t.textContent ?? "");
    const quotaTile = tiles.find((t) => t.includes("حصة هذا اليوم"));
    expect(quotaTile).toContain("0");
    expect(quotaTile).toContain("خارج فترة العمل");
  });

  it("marks today and the deadline day on the calendar", () => {
    const { cell } = mount(true);
    expect(cell(14).className).toContain("trk-cell--today");
    expect(cell(28).className).toContain("trk-cell--deadline");
  });
});
