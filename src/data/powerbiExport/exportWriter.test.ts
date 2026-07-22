import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { WorkspacePermissionError } from "../storage/workspaceWriteAccess";
import { writeCsvExport } from "./exportWriter";

describe("writeCsvExport", () => {
  it("writes CSV files and returns manifest", async () => {
    const root = createMemoryDirectory("root");
    const manifest = await writeCsvExport(root, "5-May-2026", [
      { fileName: "population.csv", headers: ["id", "port"], rows: [{ id: "X1", port: "ميناء A" }] },
    ]);
    expect(manifest.month).toBe("5-May-2026");
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].fileName).toBe("population.csv");
    expect(manifest.files[0].rowCount).toBe(1);
  });

  it("creates nested export directory and writes file", async () => {
    const root = createMemoryDirectory("root");
    await writeCsvExport(root, "5-May-2026", [
      { fileName: "sample.csv", headers: ["id"], rows: [{ id: "A" }, { id: "B" }] },
    ]);
    // navigate into 5-system/powerbi-export/5-May-2026/
    const sys = await root.getDirectoryHandle("5-system", { create: false });
    const exp = await sys.getDirectoryHandle("powerbi-export", { create: false });
    const month = await exp.getDirectoryHandle("5-May-2026", { create: false });
    const fh = await month.getFileHandle("sample.csv", { create: false });
    expect(fh).toBeTruthy();
  });

  it("requests write permission and succeeds on a freshly-restored read-only workspace", async () => {
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "granted",
    });

    await expect(
      writeCsvExport(root, "5-May-2026", [
        { fileName: "population.csv", headers: ["id"], rows: [{ id: "X1" }] },
      ])
    ).resolves.toMatchObject({ month: "5-May-2026" });

    // Confirms the file actually landed (not just "the manifest object looked
    // right") — a withWorkspaceWriteAccess that resolved without invoking the
    // wrapped operation would pass the assertion above but fail this one.
    const sys = await root.getDirectoryHandle("5-system", { create: false });
    const exp = await sys.getDirectoryHandle("powerbi-export", { create: false });
    const month = await exp.getDirectoryHandle("5-May-2026", { create: false });
    const fh = await month.getFileHandle("population.csv", { create: false });
    expect(fh).toBeTruthy();
  });

  it("rejects with the Arabic permission message, not a raw browser error, when write access is declined", async () => {
    const root = createMemoryDirectory("root", {
      initialWritePermission: "prompt",
      writePermissionRequestOutcome: "denied",
    });

    await expect(
      writeCsvExport(root, "5-May-2026", [
        { fileName: "population.csv", headers: ["id"], rows: [{ id: "X1" }] },
      ])
    ).rejects.toThrow(new WorkspacePermissionError().message);
  });
});
