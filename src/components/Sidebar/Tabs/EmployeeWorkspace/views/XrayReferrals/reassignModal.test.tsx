/* @vitest-environment jsdom */
// Overlay regression: ReassignModal renders an unbounded body (the id list, an
// expandable per-sample preview, the eligibility/skip breakdown) directly into
// `.ew-replace-modal`, which is a bounded flex column with `overflow: hidden`.
// With no internal scroller a large selection clipped the body and pushed the
// action row past the panel — the dialog became unsubmittable.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { ReassignModal } from "./subComponents";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import type { EmployeeMirrorRowStub } from "../../../../../../data/population/populationTypes";

afterEach(cleanup);

function stubRow(): EmployeeMirrorRowStub {
  return {
    stage: "المستوى الأول",
    portName: "ميناء الرياض",
    xrayEntryDate: "2026-05-01",
    plateOrContainerNumber: "ABC-1",
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    certScanStatus: "NonCertscan",
    declarationNumber: "",
    declarationDate: "",
    chassisNumber: "",
    movementType: "",
    portCode: "",
    portType: "",
    targetedByRiskEngine: "",
    riskMessage: "",
    biEnrichmentStatus: "BI Not Provided",
    reportNumber: "",
  };
}

function entry(id: string): DistributionEntry {
  return {
    xrayImageId: id,
    assignedTo: "alice",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-05-01T10:00:00.000Z",
    row: stubRow(),
  };
}

describe("ReassignModal — internal scroll", () => {
  it("scrolls its body, keeping the action row outside the scroller", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `IMG-${i}`);
    render(
      <ReassignModal
        state={{ xrayImageIds: ids, source: "selected", sourceRequestId: "req-1" }}
        entries={ids.map(entry)}
        visibleColumns={[]}
        dateFmt={{}}
        answersMap={new Map()}
        currentUser="bob"
        busy={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const dialog = screen.getByRole("dialog");
    const scroller = within(dialog).getByTestId("reassign-modal-scroll");
    expect(scroller.style.overflowY).toBe("auto");
    expect(scroller.style.minHeight).toBe("0px");

    // The id list scrolls with the body; the submit/cancel row does not.
    expect(scroller.contains(within(dialog).getByText(/عرض معرفات العينات/))).toBe(true);
    expect(scroller.contains(within(dialog).getByRole("button", { name: "إرسال طلب الإحالة" }))).toBe(false);
    expect(scroller.contains(within(dialog).getByRole("button", { name: "إلغاء" }))).toBe(false);
  });
});
