// This worker cannot be exercised through a real postMessage round-trip — Vitest's
// node/jsdom environment cannot run a real DedicatedWorker (same WORKER BOUNDARY
// limitation noted in populationQueryWorker.test.ts / Population.wizard.test.tsx).
// The module assigns its handler straight onto `globalThis.onmessage` (there is no
// extracted pure function to call directly, unlike populationQueryWorker.ts), so
// these tests drive it exactly that way: stub `globalThis.postMessage`, import the
// module (which installs `onmessage` as a side effect), then invoke it and read
// back what was posted. `xlsx` itself is mocked out — these tests are about the
// worker's own row-count ceiling (Fix 4), not SheetJS parsing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const xlsxMock = vi.hoisted(() => ({
  read: vi.fn(),
  sheetToJson: vi.fn(),
}));

vi.mock("xlsx", () => ({
  read: xlsxMock.read,
  utils: {
    sheet_to_json: xlsxMock.sheetToJson,
  },
}));

// Row cap the worker enforces (kept in sync manually — the worker does not
// export the constant, and duplicating "20000" here is clearer than reaching
// into the module's internals for one number).
const MAX_IMPORT_ROWS = 20_000;

function aoaWithDataRows(count: number): unknown[][] {
  const header = ["id"];
  const rows: unknown[][] = [header];
  for (let i = 0; i < count; i++) rows.push([String(i)]);
  return rows;
}

// A handful of real rows padded with a huge number of fully-blank rows — the
// scenario the raw-row-count fix targets: counting only non-blank rows would
// let this sail under the cap despite the worker still having to allocate and
// scan a massive array-of-arrays.
function aoaMostlyBlank(blankCount: number, nonBlankCount: number): unknown[][] {
  const header = ["id"];
  const rows: unknown[][] = [header];
  for (let i = 0; i < nonBlankCount; i++) rows.push([String(i)]);
  for (let i = 0; i < blankCount; i++) rows.push(["", ""]);
  return rows;
}

function fakeFile(): File {
  return { arrayBuffer: async () => new ArrayBuffer(0) } as unknown as File;
}

describe("pendingCorrectionsImportWorker row cap (Fix 4)", () => {
  let posted: unknown[] = [];

  beforeEach(async () => {
    posted = [];
    vi.stubGlobal("postMessage", (msg: unknown) => posted.push(msg));
    xlsxMock.read.mockReturnValue({ SheetNames: ["Sheet1"], Sheets: { Sheet1: {} } });
    // Import (not re-imported per test — module registry is shared across this
    // file's tests) is fine here since the handler reads `xlsxMock`/`postMessage`
    // fresh on every invocation; only the module's one-time `onmessage` assignment
    // needs to have happened at least once.
    await import("./pendingCorrectionsImportWorker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("parses a normal-sized sheet without hitting the cap", async () => {
    xlsxMock.sheetToJson.mockReturnValue(aoaWithDataRows(5));

    await (globalThis as unknown as { onmessage: (ev: MessageEvent) => unknown }).onmessage({
      data: { file: fakeFile() },
    } as MessageEvent);

    const done = posted.find((m) => (m as { type: string }).type === "done") as
      | { type: "done"; rows: unknown[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done!.rows).toHaveLength(5);
  });

  it("rejects a sheet over the row-count ceiling with an error message instead of the row set", async () => {
    xlsxMock.sheetToJson.mockReturnValue(aoaWithDataRows(MAX_IMPORT_ROWS + 1));

    await (globalThis as unknown as { onmessage: (ev: MessageEvent) => unknown }).onmessage({
      data: { file: fakeFile() },
    } as MessageEvent);

    // Same error-message convention as this worker's other failure cases: a
    // leading "progress" message (sent before the file is even parsed) followed
    // by exactly one `{ type: "error", error: <Arabic string> }` — never a "done".
    const errorMsg = posted.find((m) => (m as { type: string }).type === "error") as
      | { type: "error"; error: string }
      | undefined;
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.error).toContain((MAX_IMPORT_ROWS + 1).toLocaleString("ar-SA-u-nu-latn"));
    expect(posted.some((m) => (m as { type: string }).type === "done")).toBe(false);
  });

  it("accepts a sheet exactly at the ceiling (boundary is exclusive on the high side)", async () => {
    xlsxMock.sheetToJson.mockReturnValue(aoaWithDataRows(MAX_IMPORT_ROWS));

    await (globalThis as unknown as { onmessage: (ev: MessageEvent) => unknown }).onmessage({
      data: { file: fakeFile() },
    } as MessageEvent);

    const done = posted.find((m) => (m as { type: string }).type === "done") as
      | { type: "done"; rows: unknown[] }
      | undefined;
    expect(done).toBeDefined();
    expect(done!.rows).toHaveLength(MAX_IMPORT_ROWS);
  });

  it("rejects a sheet whose RAW row count exceeds the cap even though only a few rows are non-blank", async () => {
    // Only 5 non-blank rows (well under the cap) but the raw post-header row
    // count is over it. Under the old "count non-blank rows after building the
    // full record set" logic this would have sailed through with `rows.length
    // === 5`; the fix must reject it before ever reaching the per-row loop.
    xlsxMock.sheetToJson.mockReturnValue(aoaMostlyBlank(MAX_IMPORT_ROWS, 5));

    await (globalThis as unknown as { onmessage: (ev: MessageEvent) => unknown }).onmessage({
      data: { file: fakeFile() },
    } as MessageEvent);

    const errorMsg = posted.find((m) => (m as { type: string }).type === "error") as
      | { type: "error"; error: string }
      | undefined;
    expect(errorMsg).toBeDefined();
    // Raw count = 5 non-blank + MAX_IMPORT_ROWS blank rows.
    expect(errorMsg!.error).toContain((MAX_IMPORT_ROWS + 5).toLocaleString("ar-SA-u-nu-latn"));
    expect(posted.some((m) => (m as { type: string }).type === "done")).toBe(false);
  });
});
