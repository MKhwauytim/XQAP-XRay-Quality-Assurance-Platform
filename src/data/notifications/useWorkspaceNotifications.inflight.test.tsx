/* @vitest-environment jsdom */
// A8: the notifications poll has at most ONE read in flight per client (a request that
// arrives meanwhile coalesces into one follow-up), reloads on the `notifications`
// family only (an answer save or a colleague's answer does not read), and always on manual.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import type { AuthSession } from "../../auth/authTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { broadcastDataRefresh, notifyLocalDataChange, type DataRefreshFamily } from "../workspace/dataRefreshSignal";

const gate = vi.hoisted(() => ({ calls: 0, active: 0, maxActive: 0, releases: [] as Array<() => void> }));
vi.mock("./notificationStorage", () => ({
  loadNotifications: () => {
    gate.calls += 1;
    gate.active += 1;
    gate.maxActive = Math.max(gate.maxActive, gate.active);
    return new Promise((resolve) => {
      gate.releases.push(() => {
        gate.active -= 1;
        resolve([]);
      });
    });
  },
}));

import { useWorkspaceNotifications } from "./useWorkspaceNotifications";

const session = { role: "employee", username: "emp1", loginAt: new Date().toISOString() } as AuthSession;
const dir = { name: "root" } as unknown as DirectoryHandleLike;

afterEach(() => {
  cleanup();
  gate.calls = 0; gate.active = 0; gate.maxActive = 0; gate.releases = [];
});

async function drain(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10 && gate.releases.length > 0; i += 1) {
      gate.releases.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
  });
}

describe("useWorkspaceNotifications (A8)", () => {
  it("never has two reads in flight and coalesces a burst into one follow-up", async () => {
    renderHook(() => useWorkspaceNotifications(session, dir));
    await drain(); // initial load
    gate.calls = 0; gate.maxActive = 0;
    act(() => {
      for (let i = 0; i < 6; i += 1) broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["notifications"]) });
    });
    await drain();
    await drain();
    expect(gate.maxActive).toBeLessThanOrEqual(1);
    expect(gate.calls).toBeLessThanOrEqual(2);
    expect(gate.calls).toBeGreaterThanOrEqual(1);
  });

  it("does not read for an answer save or a colleague's answers, but does for manual and notifications", async () => {
    renderHook(() => useWorkspaceNotifications(session, dir));
    await drain();
    gate.calls = 0;
    act(() => notifyLocalDataChange(["answers"]));
    act(() => broadcastDataRefresh({ source: "periodic", changed: new Set<DataRefreshFamily>(["answers", "requests"]) }));
    await drain();
    expect(gate.calls).toBe(0);
    act(() => broadcastDataRefresh("manual"));
    await drain();
    expect(gate.calls).toBe(1);
  });
});
