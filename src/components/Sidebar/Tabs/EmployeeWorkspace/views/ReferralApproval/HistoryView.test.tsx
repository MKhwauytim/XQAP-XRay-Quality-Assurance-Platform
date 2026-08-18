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
import { appendReferralRequest, appendReopenRequest } from "../../../../../../data/referral/referralStorage";
import type { ReferralRequest, ReopenRequest } from "../../../../../../data/referral/referralTypes";
import { saveAdhocImportRecord } from "../../../../../../data/adhocImport/adhocImportStorage";
import { adhocMonthFolderName } from "../../../../../../data/adhocImport/adhocImportTypes";
import type {
  AdhocImportRecord,
  AdhocImportRow,
} from "../../../../../../data/adhocImport/adhocImportTypes";
import type { NormalizedRiskRow } from "../../../Population/riskData/riskDataTypes";
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

// The all-months history walked `listMonthFolders` only, which reports
// `{m}-{MonthName}-{yyyy}` folders under `1-population/`. A request filed
// against an ad-hoc import lives in `2-samples/adhoc-{importId}/`, so it was
// invisible here too — the exact blind spot useApprovalData's docblock claims
// the history tab covers.
describe("HistoryView ad-hoc import stores", () => {
  const IMPORT_ID = "adh-1";
  const ADHOC_FOLDER = adhocMonthFolderName(IMPORT_ID);
  const ADHOC_XRAY_ID = `ADHOC-${IMPORT_ID}-XR-1`;

  function adhocRow(): AdhocImportRow {
    const mapped = {
      movementType: "s1", portCode: null, portName: "ميناء جدة", portType: "بحري",
      movementNumber: null, movementDate: null, movementHijriDate: null,
      declarationNumber: "DEC-1", transitDeclarationNumber: null, declarationDate: null,
      declarationHijriDate: null, manifestNumber: null, manifestType: null, manifestDate: null,
      plateOrContainerNumber: null, finalDestination: null, entryDate: null, exitDate: null,
      chassisNumber: null, reportNumber: null, hasReport: false,
      xrayLevelOneResult: "سليمة", xrayLevelTwoResult: "اشتباه", inspectorResult: null,
      oppositeInspectorResult: null, liveMeansResult: null, xrayImageId: "XR-1",
      xrayEntryDate: null, targetedByRiskEngine: null, riskMessage: null,
      stage: "المستوى الأول", sourceSheetName: "s1", sourceRowNumber: 2,
    } satisfies NormalizedRiskRow;
    return {
      rowKey: "s1:2", mapped, validation: { valid: true }, excludedByAdmin: false,
      assigned: true, assignedTo: "emp-a", assignedAt: new Date().toISOString(),
      namespacedXrayImageId: ADHOC_XRAY_ID,
    };
  }

  it("lists a decided reopen request that was filed against an ad-hoc import", async () => {
    const root = await seed(["IMG-1"]);
    const record: AdhocImportRecord = {
      importId: IMPORT_ID,
      fileName: "adh-1.xlsx",
      importedBy: "admin",
      importedAt: new Date().toISOString(),
      status: "open",
      rows: [adhocRow()],
    };
    await saveAdhocImportRecord(root, record);

    const reopen: ReopenRequest = {
      requestId: "reo-adhoc-1",
      monthFolderName: ADHOC_FOLDER,
      xrayImageId: ADHOC_XRAY_ID,
      employeeUsername: "emp-a",
      requestedBy: "emp-a",
      requestedAt: "2026-08-14T05:42:25.182Z",
      reason: "بحاجة لتصحيح",
      status: "denied",
      reviewedBy: "sup-1",
      reviewedAt: "2026-08-14T06:00:00.000Z",
      history: [],
    };
    const appended = await appendReopenRequest(root, ADHOC_FOLDER, reopen);
    if (!appended.ok) throw new Error(`seed failed: ${appended.error}`);

    renderHistory(root);

    await waitFor(() =>
      expect(screen.getByText(`إعادة فتح: ${ADHOC_XRAY_ID}`)).toBeInTheDocument()
    );
    // The real month's own history is still there alongside it.
    expect(screen.getByText("1 عينة → emp-b")).toBeInTheDocument();
  });
});
