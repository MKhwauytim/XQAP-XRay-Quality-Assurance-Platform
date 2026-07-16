/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { WorkspaceContext, emptyLoadedFiles, type WorkspaceContextValue } from "../workspace/WorkspaceContext";
import { GlobalMonthProvider } from "./GlobalMonthProvider";
import { useGlobalMonth } from "./useGlobalMonth";
import { GLOBAL_MONTH_STORAGE_KEY } from "./globalMonthLogic";

async function makeWorkspace(monthFolders: string[]): Promise<DirectoryHandleLike> {
  const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
  const population = await root.getDirectoryHandle("1-population", { create: true });
  for (const name of monthFolders) {
    await population.getDirectoryHandle(name, { create: true });
  }
  return root;
}

function makeWrapper(directoryHandle: DirectoryHandleLike | null) {
  const workspaceValue = {
    status: "ready",
    directoryHandle,
    selectedDirectoryName: "root",
    loadedFiles: emptyLoadedFiles,
    missingItems: [],
    invalidItems: [],
    message: "",
    isSupported: true,
    pendingReconnect: false,
    selectWorkspace: async () => {},
    reconnectWorkspace: async () => {},
    reloadWorkspace: async () => {},
    createInitialStructure: async () => {},
    clearWorkspace: () => {},
    enterDemoWorkspace: async () => {},
  } as WorkspaceContextValue;
  return ({ children }: { children: ReactNode }) => (
    <WorkspaceContext.Provider value={workspaceValue}>
      <GlobalMonthProvider>{children}</GlobalMonthProvider>
    </WorkspaceContext.Provider>
  );
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("GlobalMonthProvider", () => {
  it("defaults to the latest existing month", async () => {
    const root = await makeWorkspace(["4-april-2026", "5-may-2026"]);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.selection.kind).toBe("existing"));
    expect(result.current.selection).toMatchObject({ folderName: "5-may-2026" });
    expect(result.current.months).toHaveLength(2);
  });

  it("restores a valid sessionStorage selection", async () => {
    sessionStorage.setItem(GLOBAL_MONTH_STORAGE_KEY, "4-april-2026");
    const root = await makeWorkspace(["4-april-2026", "5-may-2026"]);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.selection.kind).toBe("existing"));
    expect(result.current.selection).toMatchObject({ folderName: "4-april-2026" });
  });

  it("setSelectedMonth switches and persists", async () => {
    const root = await makeWorkspace(["4-april-2026", "5-may-2026"]);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.months).toHaveLength(2));
    act(() => result.current.setSelectedMonth("4-april-2026"));
    expect(result.current.selection).toMatchObject({ folderName: "4-april-2026" });
    expect(sessionStorage.getItem(GLOBAL_MONTH_STORAGE_KEY)).toBe("4-april-2026");
  });

  it("a guard message + declined confirm blocks the switch", async () => {
    const root = await makeWorkspace(["4-april-2026", "5-may-2026"]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.months).toHaveLength(2));
    let unregister: () => void;
    act(() => { unregister = result.current.registerMonthChangeGuard(() => "unsaved!"); });
    let ok: boolean;
    act(() => { ok = result.current.setSelectedMonth("4-april-2026"); });
    expect(confirmSpy).toHaveBeenCalledWith("unsaved!");
    expect(result.current.selection).toMatchObject({ folderName: "5-may-2026" });
    expect(ok!).toBe(false);
    confirmSpy.mockReturnValue(true);
    act(() => { ok = result.current.setSelectedMonth("4-april-2026"); });
    expect(result.current.selection).toMatchObject({ folderName: "4-april-2026" });
    expect(ok!).toBe(true);
    act(() => unregister!());
  });

  it("startNewMonth creates a pending selection; refreshMonths promotes it once the folder exists", async () => {
    const root = await makeWorkspace(["5-may-2026"]);
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(root) });
    await waitFor(() => expect(result.current.months).toHaveLength(1));
    let ok: boolean;
    act(() => { ok = result.current.startNewMonth(6, 2026); });
    expect(ok!).toBe(true);
    expect(result.current.selection).toMatchObject({ kind: "pending", folderName: "6-june-2026" });
    act(() => { ok = result.current.startNewMonth(6, 2026); });
    expect(ok!).toBe(false); // no-op: already the current selection
    expect(result.current.selection).toMatchObject({ kind: "pending", folderName: "6-june-2026" });
    const population = await root.getDirectoryHandle("1-population");
    await population.getDirectoryHandle("6-june-2026", { create: true });
    await act(async () => { await result.current.refreshMonths(); });
    expect(result.current.selection).toMatchObject({ kind: "existing", folderName: "6-june-2026" });
    expect(result.current.months).toHaveLength(2);
  });

  it("selection is none without a workspace", async () => {
    const { result } = renderHook(() => useGlobalMonth(), { wrapper: makeWrapper(null) });
    expect(result.current.selection.kind).toBe("none");
    expect(result.current.months).toHaveLength(0);
  });
});
