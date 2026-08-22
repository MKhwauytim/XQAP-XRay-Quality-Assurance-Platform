/* @vitest-environment jsdom */
// The Actions viewer's filter bar.
//
// `actionCatalog.test.ts` already pins the filtering itself; what is left to
// prove here is that the controls are wired to it and that the DEFAULT is the
// one the volume decision depends on: `answer-submitted` is roughly 6,500
// entries a month, so it has to arrive hidden and still be one click away. A
// default that silently withheld rows with no way to reveal them — or with no
// sign that it was withholding anything — would be worse than not filtering.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceActionEntry } from "../../../../data/audit/actionLog";
import { getLabels } from "../../../../data/labels/labelsStore";
import { ActionsSection } from "./AuditSections";

afterEach(cleanup);

const L = getLabels();

let seq = 0;
function entry(over: Partial<WorkspaceActionEntry> = {}): WorkspaceActionEntry {
  seq += 1;
  return {
    id: `act-${seq}`,
    at: "2026-05-10T09:00:00.000Z",
    actor: "sara",
    actorRole: "employee",
    action: "sample-drawn",
    monthFolderName: "5-may-2026",
    target: `IMG-${seq}`,
    ...over,
  };
}

const ENTRIES: WorkspaceActionEntry[] = [
  entry({ actor: "sara", action: "sample-drawn", at: "2026-05-01T08:00:00.000Z", target: "IMG-SAMPLE" }),
  entry({ actor: "omar", action: "month-closed", at: "2026-05-20T08:00:00.000Z", target: "IMG-MONTH" }),
  entry({ actor: "sara", action: "answer-submitted", at: "2026-05-02T08:00:00.000Z", target: "IMG-ANSWER" }),
  entry({
    actor: "omar",
    action: "answer-submitted-on-behalf",
    at: "2026-06-05T08:00:00.000Z",
    target: "IMG-BEHALF",
    details: { assignee: "sara" },
  }),
];

function renderLog(entries = ENTRIES) {
  return render(
    <ActionsSection entries={entries} isLoading={false} hasWorkspace={true} onRefresh={vi.fn()} />
  );
}

/** The one row-identifying cell each entry renders — its target. */
function visibleTargets(): string[] {
  const rows = screen.queryAllByRole("row").slice(1); // drop the header row
  return rows.map((row) => within(row).getAllByRole("cell")[4]?.textContent ?? "");
}

function typeCheckbox(labelText: string): HTMLInputElement {
  return screen.getByRole("checkbox", { name: labelText }) as HTMLInputElement;
}

describe("ActionsSection — filtering", () => {
  it("hides the high-volume answer-submitted rows on first render, and shows everything else", () => {
    renderLog();
    expect(visibleTargets()).toContain("IMG-SAMPLE");
    expect(visibleTargets()).toContain("IMG-MONTH");
    expect(visibleTargets()).not.toContain("IMG-ANSWER");
    // The on-behalf record is NOT high volume and must stay visible — it is the
    // accountability entry the log exists to surface.
    expect(visibleTargets()).toContain("IMG-BEHALF");
  });

  it("says that a filter is active, so the withheld rows are not withheld silently", () => {
    renderLog();
    expect(screen.getByText(L.um_actions_filter_active)).toBeInTheDocument();
  });

  it("counts the shown rows against the total", () => {
    renderLog();
    expect(screen.getByText("3 من 4 سجل")).toBeInTheDocument();
  });

  it("reveals the high-volume rows when their type is switched on", () => {
    renderLog();
    const box = typeCheckbox(L.um_action_type_answer_submitted);
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    expect(visibleTargets()).toContain("IMG-ANSWER");
    expect(screen.getByText("4 من 4 سجل")).toBeInTheDocument();
  });

  it("narrows by action type on its own", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: L.um_actions_filter_select_none }));
    expect(visibleTargets()).toEqual([]);
    fireEvent.click(typeCheckbox(L.um_action_type_month_closed));
    expect(visibleTargets()).toEqual(["IMG-MONTH"]);
  });

  it("narrows by actor", () => {
    renderLog();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "omar" } });
    expect(visibleTargets()).toEqual(expect.arrayContaining(["IMG-MONTH", "IMG-BEHALF"]));
    expect(visibleTargets()).not.toContain("IMG-SAMPLE");
  });

  it("narrows by date range", () => {
    const { container } = renderLog();
    const dates = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(dates[0]!, { target: { value: "2026-05-15" } });
    expect(visibleTargets()).toEqual(expect.arrayContaining(["IMG-MONTH", "IMG-BEHALF"]));
    expect(visibleTargets()).not.toContain("IMG-SAMPLE");
    fireEvent.change(dates[1]!, { target: { value: "2026-05-31" } });
    expect(visibleTargets()).toEqual(["IMG-MONTH"]);
  });

  it("narrows by free text over target and details", () => {
    const { container } = renderLog();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    fireEvent.change(search, { target: { value: "IMG-MONTH" } });
    expect(visibleTargets()).toEqual(["IMG-MONTH"]);
    // `details` is searchable too — this string appears nowhere else on the row.
    fireEvent.change(search, { target: { value: "assignee" } });
    expect(visibleTargets()).toEqual(["IMG-BEHALF"]);
  });

  it("composes the actor, date and text filters together", () => {
    const { container } = renderLog();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "omar" } });
    const dates = container.querySelectorAll<HTMLInputElement>('input[type="date"]');
    fireEvent.change(dates[0]!, { target: { value: "2026-06-01" } });
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="search"]')!, {
      target: { value: "sara" },
    });
    // Each filter alone leaves more than one row; only their intersection is
    // the on-behalf entry (actor omar, June, "sara" in its details).
    expect(visibleTargets()).toEqual(["IMG-BEHALF"]);
    expect(screen.getByText("1 من 4 سجل")).toBeInTheDocument();
  });

  it("explains an empty result as a filter miss, not as an empty log", () => {
    const { container } = renderLog();
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="search"]')!, {
      target: { value: "nothing-matches-this" },
    });
    expect(screen.getByText(L.um_actions_no_match)).toBeInTheDocument();
    expect(screen.queryByText(L.um_actions_empty)).not.toBeInTheDocument();
  });

  it("still says the log is empty when it genuinely is", () => {
    renderLog([]);
    expect(screen.getByText(L.um_actions_empty)).toBeInTheDocument();
    expect(screen.queryByText(L.um_actions_no_match)).not.toBeInTheDocument();
  });

  it("resets back to the defaults, high-volume types included", () => {
    const { container } = renderLog();
    fireEvent.click(typeCheckbox(L.um_action_type_answer_submitted));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "omar" } });
    fireEvent.change(container.querySelector<HTMLInputElement>('input[type="search"]')!, {
      target: { value: "IMG" },
    });

    fireEvent.click(screen.getByRole("button", { name: L.um_actions_filter_reset }));

    expect(typeCheckbox(L.um_action_type_answer_submitted).checked).toBe(false);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
    expect(container.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe("");
    expect(screen.getByText("3 من 4 سجل")).toBeInTheDocument();
  });

  it("selects every type at once, including the high-volume ones", () => {
    renderLog();
    fireEvent.click(screen.getByRole("button", { name: L.um_actions_filter_select_all }));
    expect(screen.getByText("4 من 4 سجل")).toBeInTheDocument();
    expect(screen.queryByText(L.um_actions_filter_active)).not.toBeInTheDocument();
  });
});
