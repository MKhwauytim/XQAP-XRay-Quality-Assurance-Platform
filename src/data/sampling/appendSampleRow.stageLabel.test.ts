// C1 (sampleStorage.ts:179): a manual add / replacement into a stage the draw
// never allocated used to create the bucket with the RAW row text as its label
// ("THIRD_STAGE"), appended at the end. It must carry the Arabic label and sit
// in canonical first→fourth position like every draw-time allocation.
import { describe, expect, test } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { makeRow } from "../reporting/reportTestFixtures";
import type { SampleMasterData } from "./sampleTypes";
import { appendSampleRow, loadSampleMaster, saveSampleMaster } from "./sampleStorage";

const MONTH = "5-may-2026";

function sampleWithSecondOnly(): SampleMasterData {
  return {
    rngSeed: "seed-1",
    totalRequested: 1,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 1,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [
      {
        stageKey: "second",
        stageLabel: "المستوى الثاني",
        populationSize: 1,
        targetQuota: 1,
        actualDrawn: 1,
        certScanDrawn: 0,
        nonCertScanDrawn: 1,
      },
    ],
    drawnAt: "2026-05-02T00:00:00.000Z",
    drawnBy: "admin",
    rows: [makeRow("S-1", "بري", { stage: "SECOND_STAG" })],
  };
}

describe("appendSampleRow — new stage allocation label and order (C1)", () => {
  test("labels a new stage bucket in Arabic from its key, never with the raw row text", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, sampleWithSecondOnly());

    const result = await appendSampleRow(dir, MONTH, makeRow("S-2", "بري", { stage: "THIRD_STAGE" }));
    expect(result.ok).toBe(true);

    const saved = await loadSampleMaster(dir, MONTH);
    const third = saved?.stageAllocations.find((a) => a.stageKey === "third");
    expect(third?.stageLabel).toBe("المستوى الثالث");
    expect(third?.actualDrawn).toBe(1);
  });

  test("inserts a new bucket in canonical order", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, sampleWithSecondOnly());

    await appendSampleRow(dir, MONTH, makeRow("S-3", "بري", { stage: "FIRST_STAGE" }));

    const saved = await loadSampleMaster(dir, MONTH);
    expect(saved?.stageAllocations.map((a) => a.stageKey)).toEqual(["first", "second"]);
    expect(saved?.stageAllocations.map((a) => a.stageLabel)).toEqual(["المستوى الأول", "المستوى الثاني"]);
  });
});
