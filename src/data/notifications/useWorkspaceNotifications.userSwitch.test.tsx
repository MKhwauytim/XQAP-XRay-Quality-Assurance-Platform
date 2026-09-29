/* @vitest-environment jsdom */
// Round-3 review repro (A8 minor): after a user switch the OLD poll loop, still in flight, shares
// `againRef` with the new closure. It consumes a coalesced request meant for the new user and
// re-reads the OLD user's notifications, which then land last in state.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { AuthSession } from "../../auth/authTypes";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { broadcastDataRefresh } from "../workspace/dataRefreshSignal";

const gate = vi.hoisted(() => ({ reads: [] as string[], pending: [] as Array<{ user: string; release: () => void }> }));
vi.mock("./notificationStorage", () => ({
  loadNotifications: (_d: unknown, opts: { forUsername: string }) => {
    gate.reads.push(opts.forUsername);
    return new Promise((resolve) => {
      gate.pending.push({ user: opts.forUsername, release: () => resolve([{ id: `for-${opts.forUsername}`, message: "m", postedBy: "a", postedAt: "2026-01-01", acceptances: [], audience: "all" }]) });
    });
  },
}));
import { useWorkspaceNotifications } from "./useWorkspaceNotifications";

afterEach(() => { cleanup(); gate.reads = []; gate.pending = []; });
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
async function releaseFirst(): Promise<void> {
  const p = gate.pending.shift()!;
  await act(async () => { p.release(); for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
}

it("after a user switch the new user's list is not overwritten by the old user's follow-up", async () => {
  const dir = { name: "root" } as unknown as DirectoryHandleLike;
  const s1 = { role: "employee", username: "emp1", loginAt: new Date().toISOString() } as AuthSession;
  const { result, rerender } = renderHook(({ s }) => useWorkspaceNotifications(s, dir), { initialProps: { s: s1 } });
  await releaseFirst(); // initial emp1 load
  act(() => broadcastDataRefresh("manual")); // emp1 poll in flight (old loop)
  rerender({ s: { ...s1, username: "emp2" } as AuthSession }); // user switch: initial emp2 load
  act(() => broadcastDataRefresh("manual")); // new loop: emp2 read in flight
  act(() => broadcastDataRefresh("manual")); // coalesced follow-up for emp2
  for (let i = 0; i < 8 && gate.pending.length > 0; i += 1) await releaseFirst();
  await flush();
  expect((result.current.notifications as Array<{ id: string }>).map((n) => n.id)).toEqual(["for-emp2"]);
  expect(gate.reads.slice(2)).not.toContain("emp1"); // nothing after the switch reads the old user
});
