/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("renders summary cards and the samples-finished count from real data", () => {
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
    expect(screen.getByText("العينات المُنجزة")).toBeInTheDocument();
    // One sample finished by sara.
    expect(screen.getByText("العينات المُنجزة").closest("article")).toHaveTextContent("1");
  });

  it("shows the working-hours empty message until a single employee is selected", () => {
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
    expect(screen.getByText("اختر موظفاً واحداً لعرض ساعات عمله اليومية.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الموظف"), { target: { value: "sara" } });
    expect(
      screen.queryByText("اختر موظفاً واحداً لعرض ساعات عمله اليومية.")
    ).not.toBeInTheDocument();
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
