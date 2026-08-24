import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { appendUserErrors } from "./errorLogStorage";
import { ERROR_EXPORT_HEADERS, buildErrorLogExportRows, gatherErrorLogRows } from "./errorLogExport";
import type { PersistedErrorEntry } from "./errorLogTypes";

function entry(overrides: Partial<PersistedErrorEntry> = {}): PersistedErrorEntry {
  return {
    id: `err-${Math.random().toString(36).slice(2)}`,
    at: "2026-08-24T10:00:00.000Z",
    username: "alice",
    page: "population/browse",
    action: "population:save",
    context: "population:save",
    message: "boom",
    ...overrides,
  };
}

describe("errorLogExport", () => {
  it("emits one row per entry, aligned with the header row", () => {
    const rows = buildErrorLogExportRows([
      {
        id: "err-1",
        at: "2026-08-24T10:30:00.000Z",
        username: "alice",
        role: "employee",
        page: "population/browse",
        action: "population:save",
        context: "population:save [XQ-IO-032]",
        message: "boom",
        errorCode: "XQ-IO-032",
        stack: "at foo",
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(ERROR_EXPORT_HEADERS.length);
    expect(rows[0]).toEqual([
      "2026-08-24 10:30:00",
      "alice",
      "employee",
      "population/browse",
      "population:save",
      "XQ-IO-032",
      "population:save [XQ-IO-032]",
      "boom",
      "at foo",
    ]);
  });

  it("renders a missing optional field as an empty cell, never as 'undefined'", () => {
    const [row] = buildErrorLogExportRows([{
      id: "err-1", at: "2026-08-24T10:30:00.000Z", username: "alice",
      page: "unknown", action: "x", context: "x", message: "boom",
    }]);
    expect(row).not.toContain("undefined");
    expect(row!.filter((c) => c === "")).toHaveLength(3); // role, errorCode, stack
  });

  it("is deterministic — the same entries always produce the same rows", () => {
    const entries = [
      { id: "b", at: "2026-08-24T11:00:00.000Z", username: "bob", page: "p", action: "a", context: "c", message: "m" },
      { id: "a", at: "2026-08-24T10:00:00.000Z", username: "alice", page: "p", action: "a", context: "c", message: "m" },
    ];
    expect(buildErrorLogExportRows(entries)).toEqual(buildErrorLogExportRows(entries));
  });

  it("gathers every user's live entries and, when asked, the archives too", async () => {
    const dir = createMemoryDirectory("root");
    await appendUserErrors(dir, "alice", [entry({ id: "a1" })]);
    await appendUserErrors(dir, "bob", [entry({ id: "b1", username: "bob" })]);

    const live = await gatherErrorLogRows(dir, { includeArchives: false });
    expect(live.rowCount).toBe(2);
  });

  it("returns zero rows rather than throwing on a workspace that has never logged an error", async () => {
    const result = await gatherErrorLogRows(createMemoryDirectory("root"), { includeArchives: true });
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });
});
