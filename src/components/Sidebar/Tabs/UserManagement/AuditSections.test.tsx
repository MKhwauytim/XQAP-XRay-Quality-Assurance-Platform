/* @vitest-environment jsdom */
// B9 — Activity/Actions loading flags + distinct "no workspace connected" messaging.
//
// index.tsx's load effects previously never flipped isActivityLoading /
// isActionsLoading to `true` before starting the async read, so the loading
// indicator these components already render (via `isLoading`) never actually
// appeared on the automatic tab-switch load (only on a manual refresh click).
// These tests lock down that `isLoading` still drives the loading text here
// (the presentational half of that fix), and that the new `hasWorkspace` prop
// distinguishes "no workspace connected" from "log is empty".
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManagedLoginUser } from "../../../../auth/userManagement";
import { ActionsSection, ActivitySection } from "./AuditSections";

afterEach(cleanup);

const USER: ManagedLoginUser = {
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

describe("ActivitySection", () => {
  it("shows a distinct message when no workspace is connected (not the generic empty-log message)", () => {
    render(
      <ActivitySection
        users={[USER]}
        entries={[]}
        isLoading={false}
        hasWorkspace={false}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText(/لا يوجد مجلد عمل متصل/)).toBeInTheDocument();
    expect(screen.queryByText("لا توجد سجلات نشاط محفوظة بعد.")).not.toBeInTheDocument();
  });

  it("shows the genuine empty-log message when a workspace is connected but has no entries", () => {
    render(
      <ActivitySection
        users={[USER]}
        entries={[]}
        isLoading={false}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText("لا توجد سجلات نشاط محفوظة بعد.")).toBeInTheDocument();
    expect(screen.queryByText(/لا يوجد مجلد عمل متصل/)).not.toBeInTheDocument();
  });

  it("renders the loading indicator whenever isLoading is true", () => {
    render(
      <ActivitySection
        users={[USER]}
        entries={[]}
        isLoading={true}
        hasWorkspace={true}
        onRefresh={vi.fn()}
      />
    );

    expect(screen.getByText("جاري تحميل الأنشطة...")).toBeInTheDocument();
  });
});

describe("ActionsSection", () => {
  it("shows a distinct message when no workspace is connected (not the generic empty-log message)", () => {
    render(
      <ActionsSection entries={[]} isLoading={false} hasWorkspace={false} onRefresh={vi.fn()} />
    );

    expect(screen.getByText(/لا يوجد مجلد عمل متصل/)).toBeInTheDocument();
    expect(screen.queryByText("لا توجد إجراءات مسجلة بعد.")).not.toBeInTheDocument();
  });

  it("shows the genuine empty-log message when a workspace is connected but has no entries", () => {
    render(
      <ActionsSection entries={[]} isLoading={false} hasWorkspace={true} onRefresh={vi.fn()} />
    );

    expect(screen.getByText("لا توجد إجراءات مسجلة بعد.")).toBeInTheDocument();
    expect(screen.queryByText(/لا يوجد مجلد عمل متصل/)).not.toBeInTheDocument();
  });

  it("renders the loading indicator whenever isLoading is true", () => {
    render(
      <ActionsSection entries={[]} isLoading={true} hasWorkspace={true} onRefresh={vi.fn()} />
    );

    expect(screen.getByText("جاري تحميل السجل...")).toBeInTheDocument();
  });
});
