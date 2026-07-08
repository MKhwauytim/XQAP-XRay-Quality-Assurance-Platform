import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  saveUserBrowseDatasetPreset,
  saveAdminBrowseDatasetPreset,
  loadUserBrowsePreset,
  loadAdminBrowsePreset,
} from "./browsePresetStorage";

function makeRoot() {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

// Fails fast with a clear message if a save self-deadlocks, instead of hanging
// until the whole suite times out. Before the v41.36 fix the outer read-modify-write
// lock collided with safeWriteJson's internal lock and never resolved.
function withTimeout<T>(p: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${ms}ms (deadlock?)`)), ms)
    ),
  ]);
}

describe("browsePresetStorage — save does not self-deadlock", () => {
  it("resolves a single user preset save and persists it", async () => {
    const root = makeRoot();
    await withTimeout(
      saveUserBrowseDatasetPreset(root, "alice", "risk-raw", {
        columnOrder: ["a", "b"],
        visibleColumns: ["a"],
      })
    );
    const loaded = await loadUserBrowsePreset(root, "alice");
    expect(loaded.browseData["risk-raw"]?.columnOrder).toEqual(["a", "b"]);
  });

  it("resolves an admin shared preset save and persists it", async () => {
    const root = makeRoot();
    await withTimeout(
      saveAdminBrowseDatasetPreset(root, "xray-referrals", {
        columnOrder: ["x"],
        visibleColumns: ["x"],
      })
    );
    const loaded = await loadAdminBrowsePreset(root);
    expect(loaded.browseData["xray-referrals"]?.visibleColumns).toEqual(["x"]);
  });

  it("serializes concurrent same-user saves without dropping a dataset", async () => {
    const root = makeRoot();
    await withTimeout(
      Promise.all([
        saveUserBrowseDatasetPreset(root, "alice", "population", {
          columnOrder: ["a"],
          visibleColumns: ["a"],
        }),
        saveUserBrowseDatasetPreset(root, "alice", "sample", {
          columnOrder: ["s"],
          visibleColumns: ["s"],
        }),
      ])
    );
    const loaded = await loadUserBrowsePreset(root, "alice");
    // The read-modify-write lock must keep both datasets — neither concurrent
    // save may clobber the other's update.
    expect(loaded.browseData["population"]).toBeTruthy();
    expect(loaded.browseData["sample"]).toBeTruthy();
  });
});
