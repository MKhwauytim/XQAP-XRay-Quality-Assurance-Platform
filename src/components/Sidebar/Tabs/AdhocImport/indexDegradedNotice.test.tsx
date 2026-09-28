/* @vitest-environment jsdom */
// Task E4, review round 1, "minor" requirement: when an assign's shared index
// refresh degrades (assignAdhocPlan's result.indexDegraded), the tab must
// surface it as a WARNING appended to the success notice — never through the
// error banner. Confirms the UI wiring added in handleAssign, end to end
// through a real (memory-backed) assignAdhocPlan call, not a mock.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { clearSession, writeSession } from "../../../../auth/authSession";
import { createMemoryDirectory, setSimulatedFaults } from "../../../../data/storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../../data/storage/fileSystemAccess";
import { DEFAULT_LABELS as L } from "../../../../data/labels/labelsStore";
import { ADHOC_FIELD_CATALOG } from "../../../../data/adhocImport/adhocFieldCatalog";
import { saveAdhocRecord } from "../../../../data/adhocImport/adhocImportStorage";
import type { AdhocRecord, AdhocRow } from "../../../../data/adhocImport/adhocImportModel";

const testDir: DirectoryHandleLike = createMemoryDirectory("adhoc-import-degraded-notice-root");
const INDEX_FILE = "adhoc-imports.index.json";

vi.mock("../../../../data/workspace/useWorkspace", () => ({
  useWorkspace: () => ({ directoryHandle: testDir, status: "ready" }),
}));

afterEach(() => {
  cleanup();
  clearSession();
  setSimulatedFaults(testDir, []);
});

function seededRow(): AdhocRow {
  return {
    rowKey: "s1:2",
    mapped: {
      xrayImageId: "XR-notice-1",
      portName: "ميناء جدة",
      xrayLevelOneResult: "سليمة",
      xrayLevelTwoResult: "اشتباه",
    },
    validation: { valid: true },
    excludedByAdmin: false,
    assignments: [],
  };
}

async function seedOpenImport(importId: string): Promise<void> {
  const record: AdhocRecord = {
    importId,
    schemaVersion: 2,
    fileName: `${importId}.xlsx`,
    importedBy: "admin-user",
    importedAt: new Date().toISOString(),
    status: "open",
    kind: "sample",
    sourceKind: "file",
    mapping: { fields: {}, valueMappings: {} },
    fieldCatalog: ADHOC_FIELD_CATALOG,
    monthBinding: { kind: "isolated" },
    rows: [seededRow()],
  };
  await saveAdhocRecord(testDir, record);
}

describe("AdhocImportTab — assign with a degraded index refresh", () => {
  it("appends the degraded-index warning to the success notice and does not show the error banner", async () => {
    const importId = "adh-notice-degraded-1";
    await seedOpenImport(importId);

    writeSession({ role: "admin", username: "admin-user", loginAt: new Date().toISOString() });
    const { default: AdhocImportTab } = await import("./index");
    const { container } = render(<AdhocImportTab />);

    fireEvent.click((await screen.findByText(`${importId}.xlsx`)).closest("tr")!);
    await screen.findByText(L.adhoc_review_note);

    // Select the one eligible row, then the default "explicit" mode's employee.
    fireEvent.click(screen.getByRole("button", { name: L.adhoc_import_select_all }));
    fireEvent.change(screen.getByLabelText(L.adhoc_import_assign_to_label), {
      target: { value: "jalgahamdi" },
    });

    // Only the shared index write fails — the record and the distribution
    // events commit normally, so this is the degraded-success path, not a
    // real failure.
    setSimulatedFaults(testDir, [
      { operation: "readFile", name: INDEX_FILE, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);

    fireEvent.click(screen.getByRole("button", { name: L.adhoc_assign_submit }));

    const notice = await waitFor(() => {
      // Scoped by class, not just role="status" — AssignmentPanel's own
      // distribution-preview panel carries that role too.
      const element = container.querySelector(".adhoc-import-notice");
      expect(element).not.toBeNull();
      expect(element!.textContent).toContain(L.adhoc_import_assign_index_degraded);
      return element!;
    });
    expect(notice.textContent).toContain(
      L.adhoc_import_assign_success.replace("{count}", "1")
    );

    // The false-failure this task fixes: no error banner for a committed assign.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
