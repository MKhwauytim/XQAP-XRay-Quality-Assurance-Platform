/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManagedLoginUser } from "../../../../auth/userManagement";
import type { AuthActivityLogEntry } from "../../../../auth/authActivityLog";
import type { WorkspaceActionEntry } from "../../../../data/audit/actionLog";
import { PerformanceSection } from "./PerformanceSection";

afterEach(cleanup);

const SARA: ManagedLoginUser = {
  id: "u1",
  username: "sara",
  displayName: "Sara Q",
  passwordHash: { algorithm: "argon2id", encoded: "x" },
  role: "employee",
  isActive: true,
  hasCertScanLicense: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function activityEntry(over: Partial<AuthActivityLogEntry> = {}): AuthActivityLogEntry {
  return {
    id: "auth-1",
    username: "sara",
    role: "employee",
    signedInAt: "2026-06-01T06:00:00.000Z",
    lastSeenAt: "2026-06-01T09:00:00.000Z",
    signedOutAt: "2026-06-01T09:00:00.000Z",
    durationMs: 3 * 60 * 60 * 1000,
    closeReason: "logout",
    ...over,
  };
}

function actionEntry(over: Partial<WorkspaceActionEntry> = {}): WorkspaceActionEntry {
  return {
    id: "act-1",
    at: "2026-06-01T06:30:00.000Z",
    actor: "sara",
    actorRole: "employee",
    action: "answer-submitted",
    target: "IMG-1",
    ...over,
  };
}

describe("PerformanceSection", () => {
  it("shows the no-workspace message distinctly from the generic empty message", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[]}
        actionEntries={[]}
        isLoading={false}
        hasWorkspace={false}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText(/لا يوجد مجلد عمل متصل/)).toBeInTheDocument();
  });

  it("shows the empty-data message when a workspace is connected but there is no data yet", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[]}
        actionEntries={[]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );
    expect(screen.getByText("لا توجد بيانات كافية لعرض الإحصاءات ضمن التصفية الحالية.")).toBeInTheDocument();
  });

  it("renders the employee comparison table, ranked by samples, from real data", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[activityEntry()]}
        actionEntries={[actionEntry()]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );
    const nameCell = screen.getAllByText("Sara Q").find((el) => el.closest("tr") !== null)!;
    const row = nameCell.closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    // # | employee | samples | effective | pace | gaps | status
    expect(cells[0]).toHaveTextContent("1"); // rank
    expect(cells[2]).toHaveTextContent("1"); // samples finished
  });

  it("keeps the comparison table scoped to the shared date range only — selecting an employee does not collapse it", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[activityEntry()]}
        actionEntries={[actionEntry()]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );
    fireEvent.change(screen.getByLabelText("الموظف"), { target: { value: "sara" } });
    const row = screen.getAllByText("Sara Q").find((el) => el.closest("tr") !== null);
    expect(row).toBeDefined();
  });

  it("shows a team-mode monthly gaps bar chart by default, and switches to per-day rows once an employee is selected", () => {
    // Five 5-minute gaps establish a 5-minute monthly baseline
    // (MIN_GAP_SAMPLES_FOR_BASELINE = 5), so the trailing ~2h gap classifies
    // as "large" rather than "unclassified" and shows up in the monthly chart.
    const baselineFinishes = ["06:05", "06:10", "06:15", "06:20", "06:25"].map((time, i) =>
      actionEntry({ id: `base-${i}`, at: `2026-06-01T${time}:00.000Z` })
    );
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[activityEntry({ signedInAt: "2026-06-01T06:00:00.000Z", lastSeenAt: "2026-06-01T06:25:00.000Z" })]}
        actionEntries={[...baselineFinishes, actionEntry({ id: "large-gap", at: "2026-06-01T08:30:00.000Z" })]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );

    // Team mode: the monthly bar chart (SVG), not per-day/per-employee rows.
    expect(document.querySelector(".um-perf-chart--hours svg")).toBeInTheDocument();
    expect(document.querySelector(".um-perf-hour-row-label")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الموظف"), { target: { value: "sara" } });

    // Per-employee mode: back to one row per day.
    const dayLabel = document.querySelector(".um-perf-hour-row-label")!;
    expect(dayLabel).not.toHaveTextContent("Sara Q");
    expect(dayLabel.textContent).toMatch(/\d/);
  });

  it("aggregates every day in a calendar month into a single monthly bar in team mode, instead of one row per employee per day", () => {
    // Five 5-minute gaps on day 1 establish a 5-minute monthly baseline
    // (MIN_GAP_SAMPLES_FOR_BASELINE = 5); the day-2 and day-3 gaps are then
    // far enough past that baseline to classify as "large".
    const baselineFinishes = ["06:05", "06:10", "06:15", "06:20", "06:25"].map((time, i) =>
      actionEntry({ id: `base-${i}`, at: `2026-06-01T${time}:00.000Z` })
    );
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[
          activityEntry({ id: "auth-d1", signedInAt: "2026-06-01T06:00:00.000Z", lastSeenAt: "2026-06-01T06:25:00.000Z" }),
          activityEntry({ id: "auth-d2", signedInAt: "2026-06-02T06:00:00.000Z", lastSeenAt: "2026-06-02T07:15:00.000Z" }),
          activityEntry({ id: "auth-d3", signedInAt: "2026-06-03T06:00:00.000Z", lastSeenAt: "2026-06-03T07:20:00.000Z" }),
        ]}
        actionEntries={[
          ...baselineFinishes,
          actionEntry({ id: "d2-finish", at: "2026-06-02T07:15:00.000Z" }),
          actionEntry({ id: "d3-finish", at: "2026-06-03T07:20:00.000Z" }),
        ]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );

    // No per-day/per-employee rows in team mode — a single month, one bar.
    expect(document.querySelectorAll(".um-perf-hour-row-label").length).toBe(0);
    const monthRows = document
      .querySelector(".um-perf-chart--hours table.um-perf-sr-only")!
      .querySelectorAll("tbody tr");
    expect(monthRows.length).toBe(1);
  });

  it("calls onRefresh when the refresh button is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[]}
        actionEntries={[]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={onRefresh}
      />
    );
    fireEvent.click(screen.getByText("تحديث"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
