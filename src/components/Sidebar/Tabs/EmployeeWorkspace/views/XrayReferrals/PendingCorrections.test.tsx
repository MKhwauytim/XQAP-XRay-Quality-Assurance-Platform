/* @vitest-environment jsdom */
// Regression coverage for three F4 audit findings in PendingCorrections.tsx:
//
//  (a) Worker request race — a single `Worker` instance's `onmessage` is
//      reassigned on every file selection with no request id, so an
//      out-of-order / misattributed response could clobber a newer preview
//      with a stale one. The fix adds a monotonic generation ref, checked
//      both when the "done"/"error" message arrives and again after the
//      async population-index lookup. This suite exercises it two ways:
//      end-to-end (the mid-flight guard blocks a second selection while a
//      parse is in progress, so only one request is ever outstanding) and
//      directly (capturing a stale `onmessage` closure and replaying it
//      after a newer generation exists, asserting it's a no-op) — the
//      second is the only way to reach the generation check itself, since
//      the mid-flight guard makes true concurrent requests unreachable
//      through the UI alone.
//  (b) The worker was never `.terminate()`'d on unmount.
//  (c) The bulk-reopen confirm handler has no protection against a second
//      click landing before the first (sequential, multi-step) reopen pass
//      finishes, since `ConfirmDialog` exposes no disabled/busy prop.
//
// Same WORKER BOUNDARY limitation as usePopulationBrowseWorker.test.ts:
// jsdom cannot run a real DedicatedWorker, so the `?worker&inline` import is
// mocked with a stub that records `postMessage`/`terminate` calls and exposes
// each constructed instance so tests can drive `onmessage` directly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { ItemAnswer } from "../../../../../../data/answers/answerTypes";
import { getLabels } from "../../../../../../data/labels/labelsStore";
import { createMemoryDirectory } from "../../../../../../data/storage/memoryDirectory";

interface WorkerStubInstance {
  onmessage: ((ev: MessageEvent) => void) | null;
  posted: unknown[];
  terminated: boolean;
}

const workerInstances = vi.hoisted((): WorkerStubInstance[] => []);

vi.mock("../../../../../../workers/pendingCorrectionsImportWorker?worker&inline", () => {
  class WorkerStub implements WorkerStubInstance {
    onmessage: ((ev: MessageEvent) => void) | null = null;
    posted: unknown[] = [];
    terminated = false;
    constructor() {
      workerInstances.push(this);
    }
    postMessage(msg: unknown): void {
      this.posted.push(msg);
    }
    terminate(): void {
      this.terminated = true;
    }
    addEventListener(): void {}
    removeEventListener(): void {}
  }
  return { default: WorkerStub };
});

const pendingCorrectionsMock = vi.hoisted(() => ({
  isPendingReferralEntry: vi.fn(() => true),
  buildPendingExportRows: vi.fn(() => []),
  exportPendingCorrectionsXlsx: vi.fn(),
}));
vi.mock("../../../../../../data/population/pendingCorrections", () => pendingCorrectionsMock);

const populationCorrectionsMock = vi.hoisted(() => ({
  // Pass the fabricated rows straight through so each fake worker "done"
  // response's rows are traceable into `computeCorrectionPreview`'s input.
  parseImportRows: vi.fn((rows: unknown) => rows),
  computeCorrectionPreview: vi.fn((parsedRows: { xrayImageId: string }[]) => ({
    matchedIds: parsedRows.map((r) => r.xrayImageId),
    changes: [],
    unchangedIds: [],
    unmatchedIds: parsedRows.map((r) => r.xrayImageId),
  })),
  loadCorrectionPopulationIndex: vi.fn(async () => new Map()),
  applyPopulationFieldCorrections: vi.fn(async () => ({ ok: true as const })),
}));
vi.mock("../../../../../../data/population/populationCorrections", () => populationCorrectionsMock);

const bulkReopenMock = vi.hoisted(() => ({
  bulkReopenPendingItems: vi.fn(),
}));
vi.mock("../../../../../../data/answers/pendingBulkReopen", () => bulkReopenMock);

vi.mock("../../../../../../data/audit/actionLog", () => ({
  appendWorkspaceAction: vi.fn(async () => {}),
}));

import PendingCorrections from "./PendingCorrections";

function fakeEntry(id: string): DistributionEntry {
  return {
    xrayImageId: id,
    assignedTo: "emp1",
    status: "assigned",
    replacedById: null,
    lastEventAt: new Date(0).toISOString(),
  } as unknown as DistributionEntry;
}

function baseProps() {
  return {
    directoryHandle: createMemoryDirectory(),
    monthFolderName: "5-May-2026",
    entries: [fakeEntry("1001")],
    answersMap: new Map<string, ItemAnswer>(),
    template: null,
    username: "admin",
    role: "admin",
    labels: getLabels(),
    canManage: true,
    onChanged: vi.fn(async () => {}),
  };
}

function pickFile(name: string): File {
  return new File(["x"], name, { type: "application/vnd.ms-excel" });
}

function selectFile(input: HTMLInputElement, file: File): void {
  act(() => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

describe("PendingCorrections", () => {
  beforeEach(() => {
    pendingCorrectionsMock.isPendingReferralEntry.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    workerInstances.length = 0;
    vi.clearAllMocks();
  });

  it("terminates the worker on unmount (Fix 2)", async () => {
    const { unmount, container } = render(<PendingCorrections {...baseProps()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    // Worker is created lazily, on first file selection.
    selectFile(input, pickFile("a.xlsx"));
    expect(workerInstances).toHaveLength(1);
    expect(workerInstances[0].terminated).toBe(false);

    unmount();

    expect(workerInstances[0].terminated).toBe(true);
  });

  it("does not spawn a worker (nothing to terminate) if no file was ever picked", () => {
    const { unmount } = render(<PendingCorrections {...baseProps()} />);
    unmount();
    expect(workerInstances).toHaveLength(0);
  });

  it("blocks a second file selection while a parse is already in flight (Fix 1, mid-flight guard)", async () => {
    const { container } = render(<PendingCorrections {...baseProps()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    selectFile(input, pickFile("a.xlsx"));
    const instance = workerInstances[0];
    expect(instance.posted).toHaveLength(1);

    // A second selection arrives before file A's worker has responded at all.
    selectFile(input, pickFile("b.xlsx"));
    expect(instance.posted).toHaveLength(1); // still just A's request
    expect(screen.getByRole("status")).toHaveTextContent(getLabels().ew_pending_import_parsing);
  });

  it("discards a response whose generation is no longer current (Fix 1, generation check)", async () => {
    const { container } = render(<PendingCorrections {...baseProps()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    // --- Request A ---
    selectFile(input, pickFile("a.xlsx"));
    const instance = workerInstances[0];
    const handlerForA = instance.onmessage!;

    act(() => {
      handlerForA({
        data: { type: "done", headerRow: ["id"], rows: [{ xrayImageId: "A" }] },
      } as MessageEvent);
    });

    // File A's preview is now showing.
    expect(await screen.findByText(/A/)).toBeInTheDocument();

    // --- Request B, superseding A ---
    selectFile(input, pickFile("b.xlsx"));
    const handlerForB = instance.onmessage!;
    expect(handlerForB).not.toBe(handlerForA);

    // A stale/misattributed reply for the now-superseded request A arrives
    // (simulated by replaying the captured old closure directly, since a real
    // `Worker` only ever exposes its current `onmessage`). It must be a no-op.
    act(() => {
      handlerForA({
        data: { type: "done", headerRow: ["id"], rows: [{ xrayImageId: "STALE-A" }] },
      } as MessageEvent);
    });
    expect(populationCorrectionsMock.computeCorrectionPreview).not.toHaveBeenCalledWith(
      [{ xrayImageId: "STALE-A" }],
      expect.anything()
    );
    // Still parsing B — the stale reply did not push the state into a preview.
    expect(screen.getByRole("status")).toHaveTextContent(getLabels().ew_pending_import_parsing);

    // --- B resolves normally ---
    act(() => {
      handlerForB({
        data: { type: "done", headerRow: ["id"], rows: [{ xrayImageId: "B" }] },
      } as MessageEvent);
    });
    expect(await screen.findByText(/B/)).toBeInTheDocument();
  });

  it("guards bulk-reopen against a second confirm before the first call resolves (Fix 3)", async () => {
    let resolveReopen: ((v: {
      attempted: number; succeeded: number; failed: { xrayImageId: string; error: string }[];
    }) => void) | null = null;
    bulkReopenMock.bulkReopenPendingItems.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReopen = resolve;
        })
    );

    render(<PendingCorrections {...baseProps()} />);

    fireEvent.click(screen.getByText(getLabels().ew_pending_bulk_reopen_btn));
    const confirmBtn = await screen.findByText(getLabels().ew_pending_bulk_reopen_confirm_ok);

    // Two rapid clicks before the underlying call resolves.
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    expect(bulkReopenMock.bulkReopenPendingItems).toHaveBeenCalledTimes(1);

    resolveReopen!({ attempted: 1, succeeded: 1, failed: [] });

    await waitFor(() => {
      expect(bulkReopenMock.bulkReopenPendingItems).toHaveBeenCalledTimes(1);
    });
  });
});
