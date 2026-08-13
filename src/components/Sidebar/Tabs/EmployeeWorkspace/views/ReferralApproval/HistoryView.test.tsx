/* @vitest-environment jsdom */
// The history table's `التفاصيل` column can only carry a count for a
// multi-sample request ("1,564 عينة → X"), which makes an approved bulk
// reassignment unauditable on its own: nobody can tell WHICH samples moved.
// These tests pin that expanding a history row lists the ids themselves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../../../../../../data/storage/memoryDirectory";
import { safeWriteJson } from "../../../../../../data/storage/safeWrite";
import { getPopulationMonthDir } from "../../../../../../data/workspace/workspacePaths";
import type { MonthManifestData } from "../../../../../../data/population/monthTypes";
import { appendReferralRequest } from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest } from "../../../../../../data/referral/referralTypes";
import { invalidateMonthLockCache } from "../../../../../../data/population/monthLock";
import HistoryView from "./HistoryView";

const MONTH = "5-may-2026";

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  invalidateMonthLockCache();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function seed(ids: string[]) {
  const root = createMemoryDirectory("root");
  const monthDir = await getPopulationMonthDir(root, MONTH, true);
  const manifest: MonthManifestData = {
    monthFolderName: MONTH, month: 5, year: 2026,
    processedAt: new Date().toISOString(), processedBy: "admin",
    riskFileName: null, biFileName: null, certScanUsed: false,
    templateVersion: null, rngSeed: null, totalRawRows: 0, totalProcessedRows: ids.length,
    status: "distributed",
  };
  await safeWriteJson(monthDir, "month.manifest.json", manifest);

  const request: ReferralRequest = {
    requestId: "bulk-1--emp-a",
    monthFolderName: MONTH,
    fromEmployee: "emp-a",
    toEmployee: "emp-b",
    xrayImageIds: ids,
    reason: "إعادة تعيين جماعية بطلب من sup-1",
    requestedAt: "2026-08-13T05:42:25.182Z",
    requestedBy: "sup-1",
    status: "approved",
    reviewedBy: "sup-1",
    reviewedAt: "2026-08-13T05:42:37.630Z",
  };
  const result = await appendReferralRequest(root, MONTH, request);
  if (!result.ok) throw new Error(`seed failed: ${result.error}`);
  return root;
}

function renderHistory(root: ReturnType<typeof createMemoryDirectory>) {
  return render(
    <HistoryView
      directoryHandle={root}
      username="sup-1"
      canApproveReferrals
      canApproveReplacements
      canApproveReopens
      userDisplayMap={{}}
    />
  );
}

describe("HistoryView sample ids", () => {
  it("lists every sample id of an approved request when the row is expanded", async () => {
    const root = await seed(["IMG-1", "IMG-2", "IMG-3"]);
    renderHistory(root);

    await waitFor(() => expect(screen.getByText("3 عينة → emp-b")).toBeInTheDocument());
    // Collapsed: the count is on screen, the ids are not.
    expect(screen.queryByText("IMG-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("3 عينة → emp-b"));

    await waitFor(() => expect(screen.getByText("IMG-1")).toBeInTheDocument());
    expect(screen.getByText("IMG-2")).toBeInTheDocument();
    expect(screen.getByText("IMG-3")).toBeInTheDocument();
    expect(screen.getByText(/العينات \(3\)/)).toBeInTheDocument();
  });

  it("caps the initial render of a large batch and reveals the rest on demand", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `IMG-${String(i + 1).padStart(4, "0")}`);
    const root = await seed(ids);
    renderHistory(root);

    await waitFor(() => expect(screen.getByText("250 عينة → emp-b")).toBeInTheDocument());
    fireEvent.click(screen.getByText("250 عينة → emp-b"));

    // First 200 rendered, the 201st withheld behind the "show all" affordance.
    await waitFor(() => expect(screen.getByText("IMG-0200")).toBeInTheDocument());
    expect(screen.queryByText("IMG-0201")).not.toBeInTheDocument();
    expect(screen.getByText(/معروض 200 من 250/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /عرض كل 250/ }));

    await waitFor(() => expect(screen.getByText("IMG-0250")).toBeInTheDocument());
    expect(screen.queryByText(/معروض 200 من 250/)).not.toBeInTheDocument();
  });
});
