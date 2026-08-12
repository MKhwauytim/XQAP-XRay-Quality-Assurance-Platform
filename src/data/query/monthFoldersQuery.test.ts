import { describe, it, expect } from "vitest";
import { monthFoldersQueryKey } from "./monthFoldersQuery";
import { workspaceScopeId } from "../storage/inFlightReads";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

describe("monthFoldersQueryKey — re-keyed onto workspaceScopeId (H6, A7 commit 1b)", () => {
  it("keys on workspaceScopeId(directoryHandle), not directoryHandle.name", () => {
    const root = createMemoryDirectory("same-name") as unknown as DirectoryHandleLike;
    const key = monthFoldersQueryKey(root);
    expect(key).toEqual(["monthFolders", workspaceScopeId(root)]);
  });

  it("two distinct handles sharing the same .name get distinct keys", () => {
    // Two different workspace connections can legitimately share a folder
    // name (e.g. reconnecting the same on-disk folder in a fresh session) --
    // the OLD directoryHandle.name key would have collided; scopeId must not.
    const rootA = createMemoryDirectory("workspace") as unknown as DirectoryHandleLike;
    const rootB = createMemoryDirectory("workspace") as unknown as DirectoryHandleLike;
    expect(monthFoldersQueryKey(rootA)).not.toEqual(monthFoldersQueryKey(rootB));
  });

  it("returns a stable key for the same handle across calls", () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    expect(monthFoldersQueryKey(root)).toEqual(monthFoldersQueryKey(root));
  });

  it("returns a null-scoped key for a null directoryHandle", () => {
    expect(monthFoldersQueryKey(null)).toEqual(["monthFolders", null]);
  });
});
