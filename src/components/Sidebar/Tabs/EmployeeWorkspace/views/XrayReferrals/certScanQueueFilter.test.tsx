/* @vitest-environment jsdom */
// C2: a CertScan chip in the employee case queue that COMPOSES with the case
// chips (applied after them), plus a certScanStatus status-filter column —
// both through the one predicate in src/data/population/certScanFilter.ts.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { DistributionEntry } from "../../../../../../data/distribution/distributionTypes";
import { DEFAULT_LABELS } from "../../../../../../data/labels/labelsStore";
import { makeRow } from "../../../../../../data/reporting/reportTestFixtures";
import {
  countCertScanFilters,
  filterByCertScan,
  matchesCertScanFilter,
} from "../../../../../../data/population/certScanFilter";
import { certScanStatusFilterProps } from "../certScanColumn";
import { useCaseFilter, type CaseFilterState } from "./caseFilter";
import { buildXrayColumns, CaseFilterBar, ReferralWorkspaceShell } from "./subComponents";

afterEach(() => cleanup());

function entry(id: string, certScanStatus: "Certscan" | "NonCertscan"): DistributionEntry {
  return {
    xrayImageId: id,
    assignedTo: "emp-1",
    status: "pending",
    replacedById: null,
    lastEventAt: "2026-05-04T09:00:00.000Z",
    row: makeRow(id, "منفذ أ", { certScanStatus }),
  };
}

const ENTRIES: DistributionEntry[] = [
  entry("C-1", "Certscan"),
  entry("N-1", "NonCertscan"),
  entry("C-2", "Certscan"),
];

describe("CertScan predicate (C2)", () => {
  it("matches on the processed certScanStatus", () => {
    expect(matchesCertScanFilter("Certscan", "certscan")).toBe(true);
    expect(matchesCertScanFilter("NonCertscan", "certscan")).toBe(false);
    expect(matchesCertScanFilter("NonCertscan", "noncertscan")).toBe(true);
    expect(matchesCertScanFilter(null, "noncertscan")).toBe(true);
    expect(matchesCertScanFilter("Certscan", "any")).toBe(true);
  });

  it("counts and filters; 'any' is identity-stable", () => {
    expect(countCertScanFilters(ENTRIES)).toEqual({ any: 3, certscan: 2, noncertscan: 1 });
    expect(filterByCertScan(ENTRIES, "noncertscan").map((e) => e.xrayImageId)).toEqual(["N-1"]);
    expect(filterByCertScan(ENTRIES, "any")).toBe(ENTRIES);
  });
});

describe("useCaseFilter — the CertScan chip composes with the case chips (C2)", () => {
  it("narrows the visible entries and keeps its counts over the case-filtered set", () => {
    const { result } = renderHook(() => useCaseFilter(ENTRIES));
    expect(result.current.certScan).toBe("any");
    expect(result.current.certScanCounts).toEqual({ any: 3, certscan: 2, noncertscan: 1 });

    act(() => result.current.setCertScan("certscan"));
    expect(result.current.entries.map((e) => e.xrayImageId)).toEqual(["C-1", "C-2"]);

    act(() => result.current.setValue("adhoc"));
    expect(result.current.entries).toEqual([]);
    expect(result.current.certScanCounts).toEqual({ any: 0, certscan: 0, noncertscan: 0 });
  });
});

describe("CaseFilterBar (C2)", () => {
  it("renders the CertScan chips beside the case chips and reports a click", () => {
    const calls: string[] = [];
    const state: CaseFilterState = {
      value: "all",
      setValue: () => {},
      certScan: "any",
      setCertScan: (next) => calls.push(next),
      entries: ENTRIES,
      counts: { all: 3, "risk-targeted": 3, adhoc: 0 },
      certScanCounts: { any: 3, certscan: 2, noncertscan: 1 },
    };
    render(<CaseFilterBar state={state} />);

    expect(screen.getByRole("group", { name: DEFAULT_LABELS.ew_case_filter_aria })).toBeInTheDocument();
    const group = screen.getByRole("group", { name: DEFAULT_LABELS.certscan_filter_aria });
    fireEvent.click(within(group).getByRole("button", { name: /^CertScan/ }));
    expect(calls).toEqual(["certscan"]);
  });
});

describe("certScanStatus DataTable column (C2)", () => {
  it("is a status filter whose option values are the row's own certScanStatus values", () => {
    const column = buildXrayColumns(DEFAULT_LABELS).find((c) => c.id === "certScanStatus")!;
    expect(column.filterKind).toBe("status");
    expect(column.statusOptions?.map((option) => option.value)).toEqual(["all", "Certscan", "NonCertscan"]);
    expect(column.accessor(ENTRIES[0]!)).toBe("Certscan");
    expect(certScanStatusFilterProps(DEFAULT_LABELS)).toEqual({
      filterKind: column.filterKind,
      statusOptions: column.statusOptions,
    });
  });
});

describe("ReferralWorkspaceShell — empty notice and stats title follow the CertScan chip (C2)", () => {
  function shellState(certScan: CaseFilterState["certScan"]): CaseFilterState {
    return {
      value: "all",
      setValue: () => {},
      certScan,
      setCertScan: () => {},
      entries: [],
      counts: { all: 3, "risk-targeted": 3, adhoc: 0 },
      certScanCounts: { any: 3, certscan: 0, noncertscan: 3 },
    };
  }
  function renderShell(certScan: CaseFilterState["certScan"]) {
    render(
      <ReferralWorkspaceShell
        stats={{ assigned: 0, submitted: 0, onHold: 0, notStarted: 0, replaced: 0, active: 0 } as never}
        quota={null}
        username="emp-1"
        scope="own"
        scopeEmployeeName=""
        showingRetainedDraft={false}
        caseFilter={shellState(certScan)}
        labels={DEFAULT_LABELS}
        table={null}
      />,
    );
  }

  it("names both escape chips when the CertScan chip emptied the queue, and suffixes the stats title", () => {
    renderShell("certscan");
    expect(screen.getByText(DEFAULT_LABELS.ew_case_filter_empty_certscan)).toBeInTheDocument();
    expect(screen.queryByText(DEFAULT_LABELS.ew_case_filter_empty)).toBeNull();
    expect(
      screen.getByText((text) => text.includes(DEFAULT_LABELS.ew_stats_case_suffix.replace("{filter}", "CertScan"))),
    ).toBeInTheDocument();
  });

  it("keeps the original notice when only the case chip is active", () => {
    renderShell("any");
    expect(screen.getByText(DEFAULT_LABELS.ew_case_filter_empty)).toBeInTheDocument();
  });
});
