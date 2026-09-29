/* @vitest-environment jsdom */
// A9: an employee's queue must NOT reload because a COLLEAGUE saved their own answer
// (the every-tick case at N >= 3), but MUST reload for everything that can change what
// this employee sees: a distribution change / reassignment, a request change, a manual
// refresh, an answer change that names this employee as owner (a supervisor's on-behalf
// answer, reopen or quality note), and an unknown owner set. Oversight users see everything.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../workers/populationQueryWorker?worker&inline", async () => {
  const { createPopulationQueryWorkerStubClass } = await import(
    "../../Population/populationQueryWorkerTestStub"
  );
  return { default: createPopulationQueryWorkerStubClass() };
});

import { act, cleanup, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../data/storage/memoryDirectory";
import { clearSession, writeSession } from "../../../../../auth/authSession";
import { createEmptyUserManagementState, writeUserManagementState } from "../../../../../auth/userManagement";
import { invalidateMonthLockCache } from "../../../../../data/population/monthLock";
import { setReadOnlyMode } from "../../../../../data/storage/readOnlyMode";
import { resetBootProgress } from "../../../../../data/workspace/bootProgress";
import * as answerStorage from "../../../../../data/answers/answerStorage";
import { broadcastDataRefresh, type DataRefreshFamily } from "../../../../../data/workspace/dataRefreshSignal";
import {
  XRAY_REFERRALS_TEST_MONTH,
  ResizeObserverStub,
  seedXrayReferralsWorkspace,
  renderXrayReferrals,
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
});
afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetBootProgress();
});

const periodic = (families: DataRefreshFamily[], owners?: string[] | null) =>
  broadcastDataRefresh({
    source: "periodic",
    changed: new Set(families),
    ...(owners === undefined ? {} : { answerOwners: owners === null ? null : new Set(owners) }),
  });

async function mount(role: "employee" | "supervisor") {
  writeSession({ role, username: role === "employee" ? "emp-a" : "sup-1", loginAt: new Date().toISOString() });
  writeUserManagementState(createEmptyUserManagementState(), false);
  const root = createMemoryDirectory("root");
  await seedXrayReferralsWorkspace(root);
  const spy = vi.spyOn(answerStorage, "loadEmployeeAnswers");
  const loadAll = vi.spyOn(answerStorage, "loadAllEmployeeFiles");
  renderXrayReferrals(root);
  if (role === "employee") await waitFor(() => expect(screen.getAllByText("IMG-001").length).toBeGreaterThan(0));
  await act(async () => { await new Promise((r) => setTimeout(r, role === "employee" ? 50 : 600)); });
  spy.mockClear(); loadAll.mockClear();
  const reloads = () => spy.mock.calls.length + loadAll.mock.calls.length;
  const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 80)); });
  return { reloads, settle };
}

describe("XrayReferrals employee queue reload scope (A9)", () => {
  it("does not reload for an unrelated colleague's own answer, nor for notifications/feedback", async () => {
    const { reloads, settle } = await mount("employee");
    act(() => periodic(["answers"], ["emp-b"]));
    act(() => periodic(["notifications", "feedback"]));
    await settle();
    expect(reloads()).toBe(0);
  });

  it.each([
    ["a manual refresh", () => broadcastDataRefresh("manual")],
    ["a distribution change / reassignment", () => periodic(["distribution"])],
    ["a request change", () => periodic(["requests"])],
    ["a manifest change", () => periodic(["manifest"])],
    ["a supervisor's on-behalf answer, reopen or note on this employee (owner emp-a)", () => periodic(["answers"], ["emp-b", "emp-a"])],
    ["an answer change whose owners are unknown", () => periodic(["answers"], null)],
    ["a local answers echo with no owner information", () => periodic(["answers"])],
  ])("reloads for %s", async (_label, fire) => {
    const { reloads, settle } = await mount("employee");
    act(() => fire());
    await settle();
    expect(reloads()).toBeGreaterThan(0);
  });

  it("an oversight user still reloads for any answer change", async () => {
    const { reloads, settle } = await mount("supervisor");
    act(() => periodic(["answers"], ["emp-b"]));
    await settle();
    expect(reloads()).toBeGreaterThan(0);
  });
});
