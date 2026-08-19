// Regression test: appendSampleRow must classify a replacement row against the
// SAME stage aliases the month was drawn under.
//
// The draw path threads config.stageMappings into getStageKey, and
// getReplacementCandidates does too -- but appendSampleRow used to call
// getStageKey(row.stage) with no mappings, so it silently fell back to
// DEFAULT_STAGE_MAPPINGS. In a workspace using custom stage aliases the
// replacement row then classified as "unknown", hit the
// `if (stageKey === "unknown") return allocations;` guard, and was dropped from
// stageAllocations entirely. The row still landed in rows[] and was distributed
// and answered normally, so nothing failed loudly -- but
// stageAllocations.actualDrawn / certScanDrawn / nonCertScanDrawn permanently
// under-counted by one per replacement, and those fields feed sampleReport.ts,
// executiveKpiProfiles.ts and the executive deck.

import { describe, expect, test } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import { resolveStageMappings, type StageAliasMappings } from "../population/stageHelpers";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { SampleMasterData } from "./sampleTypes";
import { appendSampleRow, loadSampleMaster, saveSampleMaster } from "./sampleStorage";

const MONTH = "5-may-2026";

// A workspace whose agency labels its first stage "Level A" -- a label that
// appears nowhere in DEFAULT_STAGE_MAPPINGS. resolveStageMappings replaces a
// stage's alias list wholesale on override, so under the defaults this value
// resolves to "unknown".
const CUSTOM_MAPPINGS: Partial<StageAliasMappings> = {
  first: ["Level A"],
};

function makeRow(id: string, stage: string | null, certScan = false): PreparedPopulationRow {
  return {
    xrayImageId: id,
    portName: "بري",
    certScanStatus: certScan ? "Certscan" : "NonCertscan",
    stage,
    xrayEntryDate: null,
    portCode: null,
    portType: null,
    declarationNumber: null,
    declarationDate: null,
    plateOrContainerNumber: null,
    chassisNumber: null,
    xrayLevelOneResult: "سليمة",
    xrayLevelTwoResult: "سليمة",
    movementType: "LAND",
    reportNumber: null,
    targetedByRiskEngine: null,
    riskMessage: null,
    levelOneEmployee: null,
    levelTwoEmployee: null,
    otherResults: {
      manual: { result: null, code: null, employeeId: null },
      opposite: { result: null, code: null, employeeId: null },
      liveMeans: { result: null, code: null, employeeId: null },
    },
    notes: null,
    certScanSnippet: null,
    originalCertScanSnippet: null,
    biEnrichmentStatus: "BI Not Provided",
    biMatched: false,
    biFilledFields: [],
    sourceSheetName: "بري",
    sourceRowNumber: 1,
  };
}

// A month drawn under CUSTOM_MAPPINGS: its stageAllocations already carry the
// "first" bucket, populated by the draw.
function makeSample(): SampleMasterData {
  return {
    rngSeed: "seed-1",
    totalRequested: 2,
    totalActual: 1,
    certScanRequested: 0,
    nonCertScanRequested: 2,
    certScanActual: 0,
    nonCertScanActual: 1,
    portAllocations: [],
    stageAllocations: [
      {
        stageKey: "first",
        stageLabel: "Level A",
        populationSize: 10,
        targetQuota: 2,
        actualDrawn: 1,
        certScanDrawn: 0,
        nonCertScanDrawn: 1,
      },
    ],
    drawnAt: "2026-07-14T10:00:00.000Z",
    drawnBy: "drawer",
    rows: [makeRow("A1", "Level A")],
  };
}

describe("appendSampleRow stage classification under custom stage mappings", () => {
  test("counts the replacement row into its mapped stage when mappings are passed", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSample());

    const result = await appendSampleRow(dir, MONTH, makeRow("A2", "Level A"), CUSTOM_MAPPINGS);
    expect(result.ok).toBe(true);

    const reloaded = await loadSampleMaster(dir, MONTH);
    const first = reloaded?.stageAllocations.find((s) => s.stageKey === "first");
    expect(first?.actualDrawn).toBe(2);
    expect(first?.nonCertScanDrawn).toBe(2);
    expect(first?.certScanDrawn).toBe(0);
    // The row itself is appended either way -- the bug was allocation-only.
    expect(reloaded?.rows).toHaveLength(2);
  });

  test("tracks the certScan split for a custom-alias replacement row", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSample());

    await appendSampleRow(dir, MONTH, makeRow("A2", "Level A", true), CUSTOM_MAPPINGS);

    const reloaded = await loadSampleMaster(dir, MONTH);
    const first = reloaded?.stageAllocations.find((s) => s.stageKey === "first");
    expect(first?.actualDrawn).toBe(2);
    expect(first?.certScanDrawn).toBe(1);
    expect(first?.nonCertScanDrawn).toBe(1);
  });

  test("without mappings a custom alias is unclassifiable -- the pre-fix behaviour", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSample());

    // Pins WHY the parameter has to be threaded: omitting it falls back to
    // DEFAULT_STAGE_MAPPINGS, "Level A" resolves to "unknown", and the
    // allocation silently does not move.
    await appendSampleRow(dir, MONTH, makeRow("A2", "Level A"));

    const reloaded = await loadSampleMaster(dir, MONTH);
    const first = reloaded?.stageAllocations.find((s) => s.stageKey === "first");
    expect(first?.actualDrawn).toBe(1);
    expect(reloaded?.rows).toHaveLength(2);
  });

  // ── stageMappingsSnapshot (v103) ──────────────────────────────────────────
  //
  // Threading live config was only ever half a fix. `stageMappings` here comes
  // from `1-population/config.json`, which is workspace-GLOBAL and admin-
  // editable at any moment — so "the SAME stage aliases the month was drawn
  // under" (this file's opening line) held only while nobody edited it. A draw
  // now stamps the resolved table it classified against onto the sample master,
  // and this function prefers that stamp over whatever the caller passes.

  /** The same month, but drawn under current code: it carries the snapshot. */
  function makeSampleWithSnapshot(): SampleMasterData {
    return {
      ...makeSample(),
      // The RESOLVED table a draw stamps: defaults for the three untouched
      // stages, the workspace's own alias list for `first`.
      stageMappingsSnapshot: resolveStageMappings(CUSTOM_MAPPINGS),
    };
  }

  test("classifies against the DRAWN mappings after the live config is edited to a conflicting one", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSampleWithSnapshot());

    // An admin has since re-pointed `first` at a completely different label, so
    // the live table no longer recognises "Level A" as any stage at all. Before
    // the snapshot existed this dropped the replacement row from
    // stageAllocations silently, exactly as the no-mappings bug above did —
    // except no caller was doing anything wrong.
    const EDITED_LIVE_MAPPINGS: Partial<StageAliasMappings> = { first: ["Tier One"] };

    const result = await appendSampleRow(
      dir,
      MONTH,
      makeRow("A2", "Level A"),
      EDITED_LIVE_MAPPINGS
    );
    expect(result.ok).toBe(true);

    const reloaded = await loadSampleMaster(dir, MONTH);
    const first = reloaded?.stageAllocations.find((s) => s.stageKey === "first");
    expect(first?.actualDrawn).toBe(2);
    expect(first?.nonCertScanDrawn).toBe(2);
    expect(reloaded?.rows).toHaveLength(2);
  });

  test("the snapshot also wins when the live config would classify the row into a DIFFERENT stage", async () => {
    const dir = createMemoryDirectory();
    const sample = makeSampleWithSnapshot();
    // Give the master a second bucket so a mis-classification has somewhere
    // wrong to land — proving the snapshot chooses the bucket, rather than the
    // row merely failing to be counted anywhere.
    sample.stageAllocations = [
      ...sample.stageAllocations,
      {
        stageKey: "second",
        stageLabel: "المستوى الثاني",
        populationSize: 10,
        targetQuota: 2,
        actualDrawn: 1,
        certScanDrawn: 0,
        nonCertScanDrawn: 1,
      },
    ];
    await saveSampleMaster(dir, MONTH, sample);

    // Live config now claims "Level A" is the SECOND stage.
    const REASSIGNED: Partial<StageAliasMappings> = { first: ["Tier One"], second: ["Level A"] };
    await appendSampleRow(dir, MONTH, makeRow("A2", "Level A"), REASSIGNED);

    const reloaded = await loadSampleMaster(dir, MONTH);
    expect(reloaded?.stageAllocations.find((s) => s.stageKey === "first")?.actualDrawn).toBe(2);
    expect(reloaded?.stageAllocations.find((s) => s.stageKey === "second")?.actualDrawn).toBe(1);
  });

  test("a retired row is un-counted against the snapshot too, not the live table", async () => {
    const dir = createMemoryDirectory();
    await saveSampleMaster(dir, MONTH, makeSampleWithSnapshot());

    // A real replacement: A2 comes in, A1 is retired. Both are "Level A", so
    // both must move the `first` bucket — +1 and -1 — leaving it exactly where
    // it started. Live config meanwhile claims "Level A" is the SECOND stage;
    // under live-config classification the pair would have been booked into a
    // freshly-invented `second` bucket instead, which is why this asserts that
    // no such bucket appears rather than only that `first` is unchanged.
    const REASSIGNED: Partial<StageAliasMappings> = { second: ["Level A"] };
    const result = await appendSampleRow(
      dir,
      MONTH,
      makeRow("A2", "Level A"),
      REASSIGNED,
      "A1"
    );
    expect(result.ok).toBe(true);

    const reloaded = await loadSampleMaster(dir, MONTH);
    const first = reloaded?.stageAllocations.find((s) => s.stageKey === "first");
    expect(first?.actualDrawn).toBe(1);
    expect(first?.nonCertScanDrawn).toBe(1);
    expect(reloaded?.stageAllocations.find((s) => s.stageKey === "second")).toBeUndefined();
    // Substitution, not enlargement.
    expect(reloaded?.totalActual).toBe(1);
    expect(reloaded?.replacedRowIds).toEqual(["A1"]);
  });

  test("a legacy master with NO snapshot still classifies via the live config", async () => {
    const dir = createMemoryDirectory();
    // makeSample() deliberately omits stageMappingsSnapshot — a month drawn
    // before the field existed. Nothing is rewritten on read for those; the
    // caller's live mappings remain the only signal available, and must still
    // be honoured exactly as before.
    await saveSampleMaster(dir, MONTH, makeSample());

    await appendSampleRow(dir, MONTH, makeRow("A2", "Level A"), CUSTOM_MAPPINGS);

    const reloaded = await loadSampleMaster(dir, MONTH);
    expect(reloaded?.stageAllocations.find((s) => s.stageKey === "first")?.actualDrawn).toBe(2);
  });

  test("default mappings path is unchanged when no overrides are in play", async () => {
    const dir = createMemoryDirectory();
    const sample = makeSample();
    sample.stageAllocations = [
      {
        stageKey: "first",
        stageLabel: "المستوى الأول",
        populationSize: 10,
        targetQuota: 2,
        actualDrawn: 1,
        certScanDrawn: 0,
        nonCertScanDrawn: 1,
      },
    ];
    sample.rows = [makeRow("A1", "المستوى الأول")];
    await saveSampleMaster(dir, MONTH, sample);

    // A shipped default alias still resolves with or without the argument.
    await appendSampleRow(dir, MONTH, makeRow("A2", "المستوى الأول"));

    const reloaded = await loadSampleMaster(dir, MONTH);
    const first = reloaded?.stageAllocations.find((s) => s.stageKey === "first");
    expect(first?.actualDrawn).toBe(2);
    expect(first?.nonCertScanDrawn).toBe(2);
  });
});
