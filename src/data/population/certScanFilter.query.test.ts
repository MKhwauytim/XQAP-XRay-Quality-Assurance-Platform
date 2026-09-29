// C2: Population Browse's CertScan chip is an ordinary certScanStatus column
// filter, so the worker-backed path (populationQueryWorker "query") and the
// main-thread fallback (runPopulationQuery) filter identically.
import { describe, expect, it } from "vitest";
import { createInitialWorkerState, handleWorkerMessage } from "../../workers/populationQueryWorker";
import { getBrowseDisplayValue } from "../../components/Sidebar/Tabs/Population/browseDisplayValue";
import { runPopulationQuery, type PopulationQueryParams } from "./populationQuery";
import {
  CERTSCAN_STATUS_COLUMN,
  certScanFilterFromColumnFilters,
  withCertScanFilter,
} from "./certScanFilter";

const ROWS: Array<Record<string, unknown>> = [
  { xrayImageId: "1", certScanStatus: "Certscan", portName: "ميناء أ" },
  { xrayImageId: "2", certScanStatus: "NonCertscan", portName: "ميناء أ" },
  { xrayImageId: "3", certScanStatus: "Certscan", portName: "ميناء ب" },
];

function envelope(rows: Array<Record<string, unknown>>): string {
  return JSON.stringify({
    metadata: {
      schemaVersion: 1,
      revision: 1,
      contentHash: "irrelevant-for-this-test",
      writtenAt: "2026-09-28T00:00:00.000Z",
    },
    data: {
      sourceMonthFolder: "5-May-2026",
      processedAt: "2026-09-28T00:00:00.000Z",
      processedBy: "tester",
      totalRows: rows.length,
      certScanRows: 2,
      nonCertScanRows: 1,
      rows,
    },
  });
}

function params(columnFilters: Record<string, string[]>): PopulationQueryParams {
  return { search: "", columnFilters, sort: null, page: 1 };
}

describe("CertScan chip ↔ Browse column filters (C2)", () => {
  it("maps each chip to a certScanStatus column filter and back", () => {
    expect(CERTSCAN_STATUS_COLUMN).toBe("certScanStatus");
    expect(withCertScanFilter({}, "certscan")).toEqual({ certScanStatus: ["Certscan"] });
    expect(withCertScanFilter({ portName: ["ميناء أ"] }, "noncertscan")).toEqual({
      portName: ["ميناء أ"],
      certScanStatus: ["NonCertscan"],
    });
    expect(withCertScanFilter({ certScanStatus: ["Certscan"], portName: ["ميناء أ"] }, "any")).toEqual({
      portName: ["ميناء أ"],
    });
    expect(certScanFilterFromColumnFilters({ certScanStatus: ["Certscan"] })).toBe("certscan");
    expect(certScanFilterFromColumnFilters({ certScanStatus: ["NonCertscan"] })).toBe("noncertscan");
    expect(certScanFilterFromColumnFilters({ certScanStatus: ["Certscan", "NonCertscan"] })).toBe("any");
    expect(certScanFilterFromColumnFilters({})).toBe("any");
  });

  it("worker path: the CertScan chip returns only CertScan rows", () => {
    const loaded = handleWorkerMessage(createInitialWorkerState(), {
      type: "load",
      requestId: 1,
      rawJsonText: envelope(ROWS),
    });
    const queried = handleWorkerMessage(loaded.state, {
      type: "query",
      requestId: 2,
      params: params(withCertScanFilter({}, "certscan")),
    });
    if (queried.response.type !== "result") throw new Error("expected a result response");
    expect(queried.response.result.pageRows.map((row) => row["xrayImageId"])).toEqual(["1", "3"]);
  });

  it("fallback path: the same chip over runPopulationQuery returns the same rows", () => {
    const result = runPopulationQuery(ROWS, params(withCertScanFilter({}, "certscan")), (row, key) =>
      getBrowseDisplayValue(row as never, key),
    );
    expect(result.pageRows.map((row) => row["xrayImageId"])).toEqual(["1", "3"]);
  });
});
