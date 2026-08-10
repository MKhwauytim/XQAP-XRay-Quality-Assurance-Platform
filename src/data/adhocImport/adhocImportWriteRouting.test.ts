import { describe, expect, it } from "vitest";
import { adhocMonthFolderName } from "./adhocImportTypes";
import {
  isAdhocEntry,
  monthFolderForEntry,
  type AdhocDistributionEntry,
} from "./adhocImportEmployeeView";
import type { DistributionEntry } from "../distribution/distributionTypes";

/**
 * Write-path routing for ad-hoc imported rows.
 *
 * EmployeeWorkspace renders the union of the selected month's entries and every
 * ad-hoc import's entries, but the two live in different stores:
 * `2-samples/{month}/` vs `2-samples/adhoc-{importId}/`. Every write for a row —
 * its answer, and any referral/replacement/reopen request — must land in the
 * store that row actually came from.
 *
 * Both directions of leakage are damaging, which is why both are pinned here:
 *  - an ad-hoc row written into the real month contaminates a genuine audit
 *    trail with rows from an unrelated population;
 *  - a real row written into an ad-hoc store silently disappears from the month
 *    it belongs to.
 */

const REAL_MONTH = "5-may-2026";

function realEntry(xrayImageId: string): DistributionEntry {
  return {
    xrayImageId,
    assignedTo: "emp-1",
    status: "assigned",
    replacedById: null,
    lastEventAt: "2026-05-01T00:00:00.000Z",
    row: null,
  } as unknown as DistributionEntry;
}

function adhocEntry(xrayImageId: string, importId: string): AdhocDistributionEntry {
  return {
    ...realEntry(xrayImageId),
    adhocImportId: importId,
    adhocFileName: "extra-population.xlsx",
  } as AdhocDistributionEntry;
}

describe("ad-hoc write routing", () => {
  it("routes a real row's writes to the selected month", () => {
    expect(monthFolderForEntry(realEntry("IMG-1"), REAL_MONTH)).toBe(REAL_MONTH);
  });

  it("routes an ad-hoc row's writes to its own import store, never the real month", () => {
    const folder = monthFolderForEntry(adhocEntry("ADHOC-imp1-IMG-9", "imp1"), REAL_MONTH);
    expect(folder).toBe(adhocMonthFolderName("imp1"));
    expect(folder).not.toBe(REAL_MONTH);
  });

  it("keeps two different ad-hoc imports in separate stores", () => {
    const a = monthFolderForEntry(adhocEntry("ADHOC-impA-1", "impA"), REAL_MONTH);
    const b = monthFolderForEntry(adhocEntry("ADHOC-impB-1", "impB"), REAL_MONTH);
    expect(a).not.toBe(b);
  });

  it("never produces a folder that could collide with a real month name", () => {
    // Real month folders are `{month}-{MonthName}-{year}`; the ad-hoc namespace
    // is structurally incompatible, so an ad-hoc store can never be mistaken for
    // — or overwrite — a real month.
    const realMonthPattern = /^\d{1,2}-[A-Za-z]+-\d{4}$/;
    expect(REAL_MONTH.toLowerCase()).toMatch(/^\d{1,2}-[a-z]+-\d{4}$/);
    expect(adhocMonthFolderName("imp1")).not.toMatch(realMonthPattern);
  });

  it("identifies ad-hoc entries without misclassifying real ones", () => {
    expect(isAdhocEntry(adhocEntry("ADHOC-imp1-1", "imp1"))).toBe(true);
    expect(isAdhocEntry(realEntry("IMG-1"))).toBe(false);
  });

  it("falls back to the selected month for an entry with no ad-hoc marker", () => {
    // Conservative default: a real row is the only thing that can be missing an
    // ad-hoc marker while still being actionable, so an unmarked row must never
    // be routed into an ad-hoc store.
    const stripped = { ...adhocEntry("IMG-2", "imp1") } as Partial<AdhocDistributionEntry>;
    delete stripped.adhocImportId;
    expect(monthFolderForEntry(stripped as DistributionEntry, REAL_MONTH)).toBe(REAL_MONTH);
  });
});
