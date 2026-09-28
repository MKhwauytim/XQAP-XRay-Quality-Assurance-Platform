/* @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { isPopulationReadFailure, useReplacementFlow, type ReplacementFlowInput } from "./useReplacementFlow";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { DirectoryHandleLike } from "../../../../../../data/storage/fileSystemAccess";

const entry = { xrayImageId: "IMG-1", assignedTo: "emp", status: "pending" } as unknown as DistributionEntry;

function setup(over: Partial<ReplacementFlowInput> = {}) {
  const setStatusMsg = vi.fn();
  const loadData = vi.fn(async () => {});
  const input: ReplacementFlowInput = {
    directoryHandle: {} as DirectoryHandleLike,
    username: "emp", role: "employee", selMonth: "5-May-2026",
    canRequestReplacement: true, sampleMaster: null, allEntries: [],
    pendingReplacementIds: new Set(), stageMappings: undefined,
    setSampleMaster: vi.fn(), setAllEntries: vi.fn(), setStatusMsg,
    folderForRow: () => "5-May-2026", loadData, selectEntry: vi.fn(),
    ...over,
  };
  return { ...renderHook(() => useReplacementFlow(input)), setStatusMsg, loadData };
}

describe("isPopulationReadFailure", () => {
  it("treats only an absent population as a plain miss", () => {
    expect(isPopulationReadFailure({ ok: false, reason: "absent" } as never)).toBe(false);
    expect(isPopulationReadFailure({ ok: false, reason: "unreadable" } as never)).toBe(true);
    expect(isPopulationReadFailure({ ok: true, row: null } as never)).toBe(false);
  });
});

describe("useReplacementFlow guards", () => {
  it("refuses to open the dialog without the permission and opens nothing", async () => {
    const { result, setStatusMsg } = setup({ canRequestReplacement: false });
    await act(async () => { await result.current.openReplacementDialog(entry); });
    expect(setStatusMsg).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(result.current.replacementDialog).toBeNull();
  });

  it("refuses to open the dialog for a row with a pending replacement request", async () => {
    const { result, setStatusMsg } = setup({ pendingReplacementIds: new Set(["IMG-1"]) });
    await act(async () => { await result.current.openReplacementDialog(entry); });
    expect(setStatusMsg).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(result.current.replacementDialog).toBeNull();
  });

  it("handleReplace without the permission reports an error and never reloads or goes busy", async () => {
    const { result, setStatusMsg, loadData } = setup({ canRequestReplacement: false });
    await act(async () => {
      await result.current.handleReplace(entry, { xrayImageId: "IMG-2" } as never, "r", true, "rep-1");
    });
    expect(setStatusMsg).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
    expect(loadData).not.toHaveBeenCalled();
    expect(result.current.replacementBusy).toBe(false);
  });
});
