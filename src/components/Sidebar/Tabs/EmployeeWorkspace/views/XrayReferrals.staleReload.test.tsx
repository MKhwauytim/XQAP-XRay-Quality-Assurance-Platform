/* @vitest-environment jsdom */
// A1 field report (2026-09-28): an employee submits, the row stays pending,
// submits again, "same thing". A silent background reload that read the
// answers BEFORE the submit's write landed and committed AFTER it replaced the
// just-submitted answer with the pre-write copy. This pins that such a stale
// reload can no longer downgrade the row.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

/** Holds ONE loadEmployeeAnswers result (already read from disk) until released. */
const gate = vi.hoisted(() => ({
  armed: false,
  held: 0,
  release: null as null | (() => void),
}));

vi.mock("../../../../../data/answers/answerStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../data/answers/answerStorage")>();
  return {
    ...actual,
    loadEmployeeAnswers: async (...args: Parameters<typeof actual.loadEmployeeAnswers>) => {
      const result = await actual.loadEmployeeAnswers(...args);
      if (gate.armed) {
        gate.armed = false;
        gate.held += 1;
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
      return result;
    },
  };
});

import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import {
  XRAY_REFERRALS_TEST_MONTH,
  ResizeObserverStub,
  seedXrayReferralsWorkspace,
  renderXrayReferrals,
  simulateRefreshBroadcast,
  readDoneCount,
} from "./XrayReferrals.testSupport";

vi.mock("../../../../../data/month/useGlobalMonth", () => ({
  useGlobalMonth: () => ({
    months: [{ month: 5, year: 2026, folderName: XRAY_REFERRALS_TEST_MONTH }],
    selection: { kind: "existing", month: 5, year: 2026, folderName: XRAY_REFERRALS_TEST_MONTH },
    isSelectedMonthClosed: false,
    setSelectedMonth: () => true,
    startNewMonth: () => true,
    refreshMonths: async () => {},
    registerMonthChangeGuard: () => () => {},
  }),
}));

vi.mock("../../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: {}, status: "ready" }),
}));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  setReadOnlyMode(false);
  invalidateMonthLockCache();
  gate.armed = false;
  gate.held = 0;
  gate.release = null;
});

afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  resetBootProgress();
});

describe("XrayReferrals — a stale background reload after a submit", () => {
  it("does not flip the submitted row back to pending", async () => {
    writeSession({ role: "employee", username: "emp-a", loginAt: new Date().toISOString() });
    writeUserManagementState(createEmptyUserManagementState(), false);
    const root = createMemoryDirectory("root");
    await seedXrayReferralsWorkspace(root);

    renderXrayReferrals(root);
    await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));
    const note = (await waitFor(() => screen.getByLabelText("ملاحظة"))) as HTMLInputElement;
    fireEvent.change(note, { target: { value: "تمت المراجعة" } });

    // A background refresh starts and reads the answers BEFORE the submit…
    gate.armed = true;
    simulateRefreshBroadcast();
    await waitFor(() => expect(gate.held).toBe(1));

    // …the submit then lands…
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: "تقديم الفحص" })));
    await waitFor(() => expect(screen.getByText("تم التقديم.")).toBeInTheDocument());
    await waitFor(() => expect(readDoneCount()).toBe("1"));

    // …and only THEN does the stale reload commit.
    await act(async () => {
      gate.release?.();
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(readDoneCount()).toBe("1");
  });
});
