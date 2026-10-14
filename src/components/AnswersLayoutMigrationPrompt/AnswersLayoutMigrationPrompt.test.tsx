/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { createMemoryDirectory } from "../../data/storage/memoryDirectory";
import { getLabels } from "../../data/labels/labelsStore";
import type { AuthSession } from "../../auth/authTypes";

const mocks = vi.hoisted(() => ({ probe: vi.fn(), migrate: vi.fn() }));
vi.mock("../../data/answers/migration/answerLayoutMigrationProbe", () => ({ probeAnswerLayoutMigrations: mocks.probe }));
vi.mock("../../data/answers/migration/flatToPerAssignee", () => ({ migrateMonthToPerAssignee: mocks.migrate }));
vi.mock("../../data/query/monthFoldersQuery", () => ({
  monthFoldersQueryOptions: () => ({ queryKey: ["months-test"], queryFn: async () => [{ month: 5, year: 2026, folderName: "5-may-2026" }] }),
}));

import { AnswersLayoutMigrationPrompt } from "./AnswersLayoutMigrationPrompt";

function renderWith(ui: ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}
const admin: AuthSession = { role: "admin", username: "admin", loginAt: "2026-10-13T08:00:00.000Z" };

describe("AnswersLayoutMigrationPrompt", () => {
  afterEach(cleanup);
  beforeEach(() => {
    mocks.probe.mockReset().mockResolvedValue([{ monthFolderName: "5-may-2026", kind: "flat", flatSegments: 2000, assignees: 12, estimateMs: 300_000 }]);
    mocks.migrate.mockReset().mockResolvedValue({ status: "migrated", marker: {}, quarantinedLines: 0 });
  });

  it("offers the migration to an admin with segment and assignee counts, and runs it on confirm", async () => {
    const dir = createMemoryDirectory("ui");
    renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={dir} workspaceReady />);
    await screen.findByText(/2000/);
    fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_confirm }));
    await waitFor(() => expect(mocks.migrate).toHaveBeenCalledWith(dir, "5-may-2026", expect.objectContaining({ actor: "admin" })));
    await screen.findByText(getLabels().answers_layout_migration_done);
  });

  describe("unreadable flat segments (option C): the admin decides before anything is moved", () => {
    type Decide = (names: readonly string[]) => Promise<"finish" | "postpone">;
    function migrateThatAsks(names: string[]) {
      mocks.migrate.mockImplementation(async (_dir: unknown, _month: string, options: { onUnreadable?: Decide }) => {
        const decision = await options.onUnreadable!(names);
        return decision === "finish"
          ? { status: "migrated", marker: {}, quarantinedLines: 0, unfolded: names, unmovable: names }
          : { status: "postponed", unreadable: names };
      });
    }

    it("shows the unreadable names and the two choices; Postpone reports the month as postponed, not done", async () => {
      migrateThatAsks(["dead-a.ndjson", "dead-b.ndjson"]);
      renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={createMemoryDirectory("ui6")} workspaceReady />);
      await screen.findByText(/2000/);
      fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_confirm }));
      const ask = await screen.findByText(/dead-a\.ndjson/);
      expect(ask.textContent).toContain("dead-b.ndjson");
      expect(ask.textContent).toContain("2");
      fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_postpone }));
      const status = await screen.findByRole("status");
      await waitFor(() => expect(status.textContent).toContain("5-may-2026"));
      expect(status.textContent).toContain(getLabels().answers_layout_migration_postponed.split("{")[0]!.trim());
      expect(status.textContent).not.toContain(getLabels().answers_layout_migration_done);
    });

    it("Finish anyway commits and still names the unfolded files", async () => {
      migrateThatAsks(["dead-a.ndjson"]);
      renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={createMemoryDirectory("ui7")} workspaceReady />);
      await screen.findByText(/2000/);
      fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_confirm }));
      await screen.findByText(/dead-a\.ndjson/);
      fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_finish_anyway }));
      const status = await screen.findByRole("status");
      await waitFor(() => expect(status.textContent).toContain("dead-a.ndjson"));
      expect(status.textContent).not.toContain(getLabels().answers_layout_migration_done);
    });
  });

  it("names unfolded and unmovable segments in the done text instead of reporting a clean success (review finding 3)", async () => {
    mocks.migrate.mockResolvedValue({ status: "migrated", marker: {}, quarantinedLines: 0, unfolded: ["dead-a.ndjson"], unmovable: ["dead-a.ndjson", "stuck-b.ndjson"] });
    renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={createMemoryDirectory("ui5")} workspaceReady />);
    await screen.findByText(/2000/);
    fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_confirm }));
    const status = await screen.findByRole("status");
    await waitFor(() => expect(status.textContent).toContain("dead-a.ndjson"));
    expect(status.textContent).toContain("stuck-b.ndjson");
    expect(status.textContent).not.toContain(getLabels().answers_layout_migration_done);
  });

  it("never probes or prompts for a non-admin", async () => {
    renderWith(<AnswersLayoutMigrationPrompt session={{ ...admin, role: "employee", username: "emp1" }} directoryHandle={createMemoryDirectory("ui2")} workspaceReady />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays hidden while the admin boot integrity report is open, then appears (coexists with the .tmp heal)", async () => {
    const dir = createMemoryDirectory("ui4");
    const view = renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={dir} workspaceReady holdWhile />);
    await waitFor(() => expect(mocks.probe).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <AnswersLayoutMigrationPrompt session={admin} directoryHandle={dir} workspaceReady holdWhile={false} />
      </QueryClientProvider>
    );
    await screen.findByText(/2000/);
    expect(mocks.probe).toHaveBeenCalledTimes(1);
  });

  describe("v154.0 field report: failure reason, per-file progress, close guard", () => {
    async function start(name: string) {
      renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={createMemoryDirectory(name)} workspaceReady />);
      await screen.findByText(/2000/);
      fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_confirm }));
    }

    it("a failed month shows the Arabic reason and the technical detail (error name, message, file name)", async () => {
      const error = Object.assign(new Error("Event segment(s) listed but could not be read: seg-a.ndjson"), { name: "EventSegmentUnreadableError", segmentNames: ["seg-a.ndjson"] });
      mocks.migrate.mockRejectedValue(error);
      await start("ui-fail");
      const status = await screen.findByRole("status");
      await waitFor(() => expect(status.textContent).toContain(getLabels().answers_layout_migration_reason_segment_unreadable));
      const detail = await screen.findByTestId("answers-migration-detail");
      expect(detail.textContent).toContain("EventSegmentUnreadableError");
      expect(detail.textContent).toContain("seg-a.ndjson");
    });

    it("a DOMException-style NotAllowedError maps to the permission reason", async () => {
      mocks.migrate.mockRejectedValue(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
      await start("ui-perm");
      const status = await screen.findByRole("status");
      await waitFor(() => expect(status.textContent).toContain(getLabels().answers_layout_migration_reason_not_allowed));
    });

    it("per-file progress is shown while running, and closing the tab is guarded until the run ends", async () => {
      let finish: () => void = () => {};
      mocks.migrate.mockImplementation(async (_d: unknown, _m: string, options: { onProgress?: (p: { phase: string; done: number; total: number }) => Promise<void> | void }) => {
        await options.onProgress?.({ phase: "move", done: 7, total: 40 });
        await new Promise<void>((resolve) => { finish = resolve; });
        return { status: "migrated", marker: {}, quarantinedLines: 0 };
      });
      await start("ui-progress");
      const status = await screen.findByRole("status");
      await waitFor(() => expect(status.textContent).toContain("7/40"));
      expect(status.textContent).toContain(getLabels().answers_layout_migration_phase_move);
      const guarded = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(guarded);
      expect(guarded.defaultPrevented).toBe(true);
      finish();
      await screen.findByText(getLabels().answers_layout_migration_done);
      await waitFor(() => {
        const after = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(after);
        expect(after.defaultPrevented).toBe(false);
      });
    });
  });

  it("Later closes without migrating", async () => {
    renderWith(<AnswersLayoutMigrationPrompt session={admin} directoryHandle={createMemoryDirectory("ui3")} workspaceReady />);
    await screen.findByText(/2000/);
    fireEvent.click(screen.getByRole("button", { name: getLabels().answers_layout_migration_later }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.migrate).not.toHaveBeenCalled();
  });
});
