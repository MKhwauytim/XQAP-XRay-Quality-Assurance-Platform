import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDirectory } from "./memoryDirectory";
import {
  dedupeInFlight,
  workspaceScopeId,
  bumpWorkspaceEpoch,
  workspaceEpoch,
  __clearInFlightForTests,
} from "./inFlightReads";

describe("dedupeInFlight", () => {
  beforeEach(() => __clearInFlightForTests());

  it("coalesces overlapping calls with the same key into one execution", async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return new Promise<number>((resolve) => setTimeout(() => resolve(42), 10));
    };
    const [a, b] = await Promise.all([
      dedupeInFlight("k", run),
      dedupeInFlight("k", run),
    ]);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(calls).toBe(1);
  });

  it("a call started after the previous one settled performs fresh work", async () => {
    let calls = 0;
    const run = () => { calls += 1; return Promise.resolve(calls); };
    const first = await dedupeInFlight("k2", run);
    const second = await dedupeInFlight("k2", run);
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(calls).toBe(2);
  });

  it("a rejection is shared by overlapping callers, and the entry is removed so the next call retries", async () => {
    let attempt = 0;
    const run = () => {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error("boom")) : Promise.resolve("ok");
    };
    await expect(Promise.all([dedupeInFlight("k3", run), dedupeInFlight("k3", run)])).rejects.toThrow("boom");
    const retried = await dedupeInFlight("k3", run);
    expect(retried).toBe("ok");
  });

  it("different keys never coalesce", async () => {
    let calls = 0;
    const run = () => { calls += 1; return Promise.resolve(calls); };
    await Promise.all([dedupeInFlight("x", run), dedupeInFlight("y", run)]);
    expect(calls).toBe(2);
  });
});

describe("workspaceScopeId", () => {
  it("returns a stable id for the same root across repeated calls", () => {
    const root = createMemoryDirectory();
    expect(workspaceScopeId(root)).toBe(workspaceScopeId(root));
  });

  it("returns different ids for two different roots", () => {
    const rootA = createMemoryDirectory("A");
    const rootB = createMemoryDirectory("B");
    expect(workspaceScopeId(rootA)).not.toBe(workspaceScopeId(rootB));
  });
});

describe("workspaceEpoch / bumpWorkspaceEpoch", () => {
  it("starts at 0 for an unbumped (root, month) pair and increments on bump", () => {
    const root = createMemoryDirectory();
    expect(workspaceEpoch(root, "5-May-2026")).toBe(0);
    bumpWorkspaceEpoch(root, "5-May-2026");
    expect(workspaceEpoch(root, "5-May-2026")).toBe(1);
    bumpWorkspaceEpoch(root, "5-May-2026");
    expect(workspaceEpoch(root, "5-May-2026")).toBe(2);
  });

  it("bumping one month does not affect another month's epoch on the same root", () => {
    const root = createMemoryDirectory();
    bumpWorkspaceEpoch(root, "5-May-2026");
    expect(workspaceEpoch(root, "6-June-2026")).toBe(0);
  });
});
