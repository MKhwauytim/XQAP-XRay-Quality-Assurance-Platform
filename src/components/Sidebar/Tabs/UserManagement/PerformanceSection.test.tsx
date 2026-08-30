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

  it("shows a team-mode working-hours row per employee by default, and switches to a per-day row once an employee is selected", () => {
    render(
      <PerformanceSection
        users={[SARA]}
        activityEntries={[activityEntry()]}
        actionEntries={[
          actionEntry({ id: "act-1", at: "2026-06-01T06:05:00.000Z" }),
          // A > 60min gap after the first finish classifies as "large" once
          // a reliable per-employee-month baseline exists (5+ gaps); with
          // only two finishes here the gap is "unclassified" and drawn as
          // a large enough span not to matter for this assertion, which
          // only checks the row label switches — not the tier coloring.
          actionEntry({ id: "act-2", at: "2026-06-01T08:00:00.000Z" }),
        ]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );

    // Team mode: one row labeled with the employee's display name.
    expect(document.querySelector(".um-perf-hour-row-label")).toHaveTextContent("Sara Q");

    fireEvent.change(screen.getByLabelText("الموظف"), { target: { value: "sara" } });

    // Per-employee mode: rows are now labeled by day, not by employee name.
    const dayLabel = document.querySelector(".um-perf-hour-row-label")!;
    expect(dayLabel).not.toHaveTextContent("Sara Q");
    expect(dayLabel.textContent).toMatch(/\d/);
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
