/* @vitest-environment jsdom */
// The admin surface for an unreadable supervisor decision file.
//
// Without it the data-layer recovery is unreachable, and the production
// workspace that sat blocked for a week (52 XQ-IO-029 entries naming one file,
// 2026-08-31 → 09-08) stays blocked. These tests cover the two scenarios the
// section exists to distinguish — the data is still recoverable, and it is not
// — plus the refusal that matters most: a share that is merely not answering
// must never be "repaired".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { createMemoryDirectory } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { clearSession, writeSession } from "../../../../auth/authSession";
import {
  createEmptyUserManagementState,
  writeUserManagementState,
} from "../../../../auth/userManagement";
import { appendDecisionEvent, loadSupervisorDecisions } from "../../../../data/approvals/approvalStorage";
import {
  getPopulationMonthDir,
  getSampleApprovalsDir,
} from "../../../../data/workspace/workspacePaths";
import { DEFAULT_LABELS } from "../../../../data/labels/labelsStore";
import { setReadOnlyMode } from "../../../../data/storage/readOnlyMode";
import { DecisionRepairSection } from "./DecisionRepairSection";

const MONTH = "9-september-2026";
const SUP = "malrogi";
const FILE = "malrogi.decisions.json";

let root: DirectoryHandleLike;

vi.mock("../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 9, year: 2026, folderName: MONTH }],
    selection: { kind: "existing", month: 9, year: 2026, folderName: MONTH },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: root, status: "ready" }),
}));

async function seed(count: number): Promise<void> {
  // The month picker lists real month folders, so the month has to exist as one.
  await getPopulationMonthDir(root, MONTH, true);
  for (let i = 0; i < count; i++) {
    const result = await appendDecisionEvent(root, MONTH, SUP, {
      requestId: `req-${i}`, kind: "referral", status: "approved",
      reviewedBy: SUP, reviewedAt: `2026-09-0${i + 1}T10:00:00.000Z`,
    });
    if (!result.ok) throw new Error(result.error);
  }
}

async function writeRawBytes(name: string, text: string): Promise<void> {
  const dir = await getSampleApprovalsDir(root, MONTH, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

/** Open the panel and wait for the month list to arrive off disk. */
async function openSectionAndScan(): Promise<void> {
  render(<DecisionRepairSection />);
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(DEFAULT_LABELS.decision_repair_title) })
  );
  await screen.findByRole("option", { name: MONTH });
  fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.decision_repair_scan_btn }));
}

beforeEach(() => {
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  setReadOnlyMode(false);
  writeSession({ role: "admin", username: "admin", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
});

afterEach(() => {
  cleanup();
  clearSession();
});

describe("DecisionRepairSection", () => {
  it("reports a healthy month rather than inventing work to do", async () => {
    await seed(2);
    await openSectionAndScan();

    await screen.findByText(DEFAULT_LABELS.decision_repair_all_ok);
  });

  it("scenario: the data still exists — restores it and names what came back", async () => {
    await seed(3);
    await writeRawBytes(FILE, "{ not json");

    await openSectionAndScan();

    const restore = await screen.findByRole("button", {
      name: DEFAULT_LABELS.decision_repair_restore_btn,
    });
    fireEvent.click(restore);

    // The notice states the count and the source rather than claiming everything
    // is back — `.bak` is the pre-commit snapshot, so it holds 2 of the 3.
    await screen.findByText(/تمت الاستعادة: 2 قرار من النسخة bak/);
    const recovered = await loadSupervisorDecisions(root, MONTH, SUP);
    expect(recovered.decisionEvents).toHaveLength(2);
  });

  it("scenario: the data does not exist — requires confirmation, then archives and restarts", async () => {
    await seed(1);
    await writeRawBytes(FILE, "{ not json");
    await writeRawBytes(`${FILE}.bak`, "{ also not json");
    await writeRawBytes(`${FILE}.tmp`, "{ nor this");

    await openSectionAndScan();

    await screen.findByText(DEFAULT_LABELS.decision_repair_state_blocked);
    // No restore offered — there is nothing to restore from.
    expect(
      screen.queryByRole("button", { name: DEFAULT_LABELS.decision_repair_restore_btn })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: DEFAULT_LABELS.decision_repair_reset_btn }));
    // Destructive, so it asks first.
    await screen.findByText(DEFAULT_LABELS.decision_repair_reset_confirm_body);
    const confirmButtons = screen.getAllByRole("button", {
      name: DEFAULT_LABELS.decision_repair_reset_btn,
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await screen.findByText(/بدأ سجل قرارات جديد/);
    // The supervisor can record decisions again.
    const appended = await appendDecisionEvent(root, MONTH, SUP, {
      requestId: "after", kind: "referral", status: "approved",
      reviewedBy: SUP, reviewedAt: "2026-09-09T10:00:00.000Z",
    });
    expect(appended.ok).toBe(true);
  });

  it("hides every repair control from a user who may not mutate", async () => {
    await seed(1);
    await writeRawBytes(FILE, "{ not json");
    writeSession({ role: "guest", username: "guest", loginAt: new Date().toISOString() });

    render(<DecisionRepairSection />);
    // The guest role has no view-error-log capability, so the section is absent
    // entirely rather than rendering a disabled repair button.
    expect(screen.queryByText(DEFAULT_LABELS.decision_repair_title)).not.toBeInTheDocument();
  });
});
