import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { PreparedPopulationRow } from "../population/populationTypes";
import type { DistributionEntry } from "./distributionTypes";
import type { SampleMasterData } from "../sampling/sampleTypes";
import { getReplacementCandidates, executeReplacement } from "./replacement";
import { saveSampleMaster } from "../sampling/sampleStorage";
import { loadDistributionLog } from "./distributionStorage";
import { resolveStageMappings } from "../population/stageHelpers";

const makeRow = (id: string, stage: string, port: string, certScan: "Certscan" | "NonCertscan" = "Certscan"): PreparedPopulationRow => ({
  xrayImageId: id,
  stage,
  portName: port,
  certScanStatus: certScan,
  xrayEntryDate: null,
  portCode: null,
  portType: null,
  declarationNumber: null,
  declarationDate: null,
  plateOrContainerNumber: null,
  chassisNumber: null,
  xrayLevelOneResult: "سليمة",
  xrayLevelTwoResult: "سليمة",
  movementType: null,
  reportNumber: null,
  targetedByRiskEngine: null,
  riskMessage: null,
  levelOneEmployee: null,
  levelTwoEmployee: null,
  otherResults: {
    manual: { result: null, code: null, employeeId: null },
    opposite: { result: null, code: null, employeeId: null },
    liveMeans: { result: null, code: null, employeeId: null }
  },
  notes: null,
  certScanSnippet: null,
  originalCertScanSnippet: null,
  biEnrichmentStatus: "BI Not Provided",
  biMatched: false,
  biFilledFields: [],
  sourceSheetName: "Sheet1",
  sourceRowNumber: 1,
});

describe("replacement candidates", () => {
  it("computes recommended and all candidates matching tier and stage rules", () => {
    const deadRow = makeRow("img-1", "المستوى الأول", "PortA");
    const entry: DistributionEntry = {
      xrayImageId: "img-1",
      assignedTo: "expert1",
      status: "pending",
      replacedById: null,
      row: deadRow,
      lastEventAt: new Date().toISOString(),
    };

    const popRows = [
      deadRow,
      makeRow("img-2", "المستوى الأول", "PortA"), // Recommended & All (same stage, same port, same tier)
      makeRow("img-3", "المستوى الأول", "PortB"), // All only (same stage, different port, same tier)
      makeRow("img-4", "المستوى الثاني", "PortA"), // Fallback stage only (different stage, same tier)
      makeRow("img-5", "المستوى الأول", "PortA", "NonCertscan"), // Excluded (different tier)
      makeRow("img-6", "المستوى الأول", "PortA"), // Excluded (in sampleMaster)
      makeRow("img-7", "المستوى الأول", "PortA"), // Excluded (in allEntries)
    ];

    const sampleMaster: SampleMasterData = {
      rngSeed: "123",
      totalRequested: 2,
      totalActual: 2,
      certScanRequested: 0,
      nonCertScanRequested: 0,
      certScanActual: 0,
      nonCertScanActual: 0,
      portAllocations: [],
      stageAllocations: [],
      drawnAt: new Date().toISOString(),
      drawnBy: "admin",
      rows: [deadRow, popRows[5]], // popRows[5] is in sampleMaster
    };

    const allEntries: DistributionEntry[] = [
      entry,
      {
        xrayImageId: "img-7",
        assignedTo: "expert2",
        status: "pending",
        replacedById: null,
        row: popRows[6], // popRows[6] is owned
        lastEventAt: new Date().toISOString(),
      },
    ];

    const result = getReplacementCandidates(entry, popRows, sampleMaster, allEntries);

    expect(result.recommended.map(r => r.xrayImageId)).toEqual(["img-2"]);
    expect(result.all.map(r => r.xrayImageId)).toEqual(["img-2", "img-3"]);
  });

  it("cascades to highest-supply stage if same-stage candidates are empty", () => {
    const deadRow = makeRow("img-1", "المستوى الأول", "PortA");
    const entry: DistributionEntry = {
      xrayImageId: "img-1",
      assignedTo: "expert1",
      status: "pending",
      replacedById: null,
      row: deadRow,
      lastEventAt: new Date().toISOString(),
    };

    const popRows = [
      deadRow,
      makeRow("img-2", "المستوى الثاني", "PortA"), // Stage 2 (1 candidate)
      makeRow("img-3", "المستوى الثالث", "PortB"), // Stage 3 (2 candidates)
      makeRow("img-4", "المستوى الثالث", "PortA"), // Stage 3
    ];

    const sampleMaster: SampleMasterData = {
      rngSeed: "123",
      totalRequested: 1,
      totalActual: 1,
      certScanRequested: 0,
      nonCertScanRequested: 0,
      certScanActual: 0,
      nonCertScanActual: 0,
      portAllocations: [],
      stageAllocations: [],
      drawnAt: new Date().toISOString(),
      drawnBy: "admin",
      rows: [deadRow],
    };

    const allEntries: DistributionEntry[] = [entry];

    const result = getReplacementCandidates(entry, popRows, sampleMaster, allEntries);

    // No same-stage candidates (stage 1 has none), cascades to Stage 3 because it has 2 candidates
    expect(result.recommended).toEqual([]);
    expect(result.all.map(r => r.xrayImageId).sort()).toEqual(["img-3", "img-4"]);
  });

  it("caps oversized pools deterministically from the sample seed and dead row id", () => {
    const deadRow = makeRow("img-dead", "المستوى الأول", "PortA");
    const entry: DistributionEntry = {
      xrayImageId: "img-dead",
      assignedTo: "expert1",
      status: "pending",
      replacedById: null,
      row: deadRow,
      lastEventAt: new Date().toISOString(),
    };

    // 150 same-stage / same-port / same-tier candidates — well past the pool limit (100).
    const popRows = [
      deadRow,
      ...Array.from({ length: 150 }, (_, i) => makeRow(`img-${i + 1}`, "المستوى الأول", "PortA")),
    ];

    const sampleMaster: SampleMasterData = {
      rngSeed: "seed-xyz",
      totalRequested: 1,
      totalActual: 1,
      certScanRequested: 0,
      nonCertScanRequested: 0,
      certScanActual: 0,
      nonCertScanActual: 0,
      portAllocations: [],
      stageAllocations: [],
      drawnAt: new Date().toISOString(),
      drawnBy: "admin",
      rows: [deadRow],
    };

    const allEntries: DistributionEntry[] = [entry];

    const first = getReplacementCandidates(entry, popRows, sampleMaster, allEntries);
    const second = getReplacementCandidates(entry, popRows, sampleMaster, allEntries);

    // Capped to the pool limit, and byte-identical across calls (seeded, not Math.random).
    expect(first.all).toHaveLength(100);
    expect(first.recommended).toHaveLength(100);
    expect(second.all.map(r => r.xrayImageId)).toEqual(first.all.map(r => r.xrayImageId));
    expect(second.recommended.map(r => r.xrayImageId)).toEqual(first.recommended.map(r => r.xrayImageId));
  });
});

describe("replacement candidates under a drifted stage-mapping config (v103)", () => {
  // The same-stage rule is the whole point of the candidate pool: a replacement
  // must come from the stratum the dead row belongs to. "Its stratum" is
  // decided by the stage aliases, which live in workspace-global, admin-editable
  // config — so an edit between the draw and the replacement silently
  // re-partitioned the population and handed out cross-stratum replacements.
  // The draw now records the table it used, and this function prefers it.
  const deadRow = makeRow("img-1", "Level A", "PortA");
  const entry: DistributionEntry = {
    xrayImageId: "img-1",
    assignedTo: "expert1",
    status: "pending",
    replacedById: null,
    row: deadRow,
    lastEventAt: new Date().toISOString(),
  };
  const popRows = [
    deadRow,
    makeRow("img-2", "Level A", "PortA"), // same stage under the DRAWN aliases
    makeRow("img-3", "Level B", "PortA"), // a different stage under them
  ];

  function master(snapshot?: ReturnType<typeof resolveStageMappings>): SampleMasterData {
    return {
      rngSeed: "123",
      totalRequested: 1,
      totalActual: 1,
      certScanRequested: 0,
      nonCertScanRequested: 0,
      certScanActual: 0,
      nonCertScanActual: 0,
      portAllocations: [],
      stageAllocations: [],
      drawnAt: new Date().toISOString(),
      drawnBy: "admin",
      rows: [deadRow],
      ...(snapshot ? { stageMappingsSnapshot: snapshot } : {}),
    };
  }

  it("uses the mappings the DRAW recorded, not the edited live config", () => {
    // Drawn under: "Level A" and "Level B" are DIFFERENT stages, so only img-2
    // shares the dead row's stratum.
    const drawn = resolveStageMappings({ first: ["Level A"], second: ["Level B"] });
    // An admin has since MERGED the two labels into one stage. Under live
    // classification img-3 would now count as same-stage and be offered as a
    // replacement for a row it does not actually share a stratum with — the
    // exact cross-stratum substitution the same-stage rule exists to prevent.
    const liveNow = resolveStageMappings({ first: ["Level A", "Level B"], second: [] });

    const result = getReplacementCandidates(entry, popRows, master(drawn), [entry], liveNow);
    expect(result.all.map((r) => r.xrayImageId)).toEqual(["img-2"]);
    expect(result.recommended.map((r) => r.xrayImageId)).toEqual(["img-2"]);

    // Control: with no snapshot the same live config DOES pull img-3 in. This
    // is what every month silently did before the draw recorded its mappings.
    const legacy = getReplacementCandidates(entry, popRows, master(), [entry], liveNow);
    expect(legacy.all.map((r) => r.xrayImageId).sort()).toEqual(["img-2", "img-3"]);
  });

  it("falls back to live config for a legacy master with no snapshot", () => {
    const liveNow = resolveStageMappings({ first: ["Level A"], second: ["Level B"] });
    const result = getReplacementCandidates(entry, popRows, master(), [entry], liveNow);
    expect(result.all.map((r) => r.xrayImageId)).toEqual(["img-2"]);
  });
});

describe("executeReplacement", () => {
  it("atomically appends the replacement to sample master and writes distribution events", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const deadRow = makeRow("img-1", "المستوى الأول", "PortA");
    const replacementRow = makeRow("img-2", "المستوى الأول", "PortA");

    const deadEntry: DistributionEntry = {
      xrayImageId: "img-1",
      assignedTo: "expert1",
      status: "pending",
      replacedById: null,
      row: deadRow,
      lastEventAt: new Date().toISOString(),
    };

    // Pre-condition: Sample master exists
    const initialSample: SampleMasterData = {
      rngSeed: "123",
      totalRequested: 1,
      totalActual: 1,
      certScanRequested: 0,
      nonCertScanRequested: 0,
      certScanActual: 0,
      nonCertScanActual: 0,
      portAllocations: [],
      stageAllocations: [],
      drawnAt: new Date().toISOString(),
      drawnBy: "admin",
      rows: [deadRow],
    };
    await saveSampleMaster(root, "5-May-2026", initialSample);

    const result = await executeReplacement({
      directoryHandle: root,
      monthFolderName: "5-May-2026",
      deadEntry,
      replacementRow,
      reason: "Bad scan quality",
      eventBy: "supervisor1",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Check sample master updated
    expect(result.updatedSample.rows).toHaveLength(2);
    expect(result.updatedSample.rows[1].xrayImageId).toBe("img-2");

    // Check distribution log has replaced and assigned events
    const log = await loadDistributionLog(root, "5-May-2026");
    expect(log.events).toHaveLength(2);
    expect(log.events[0].eventType).toBe("assigned");
    expect(log.events[0].xrayImageId).toBe("img-2");
    expect(log.events[0].assignedTo).toBe("expert1");

    expect(log.events[1].eventType).toBe("replaced");
    expect(log.events[1].xrayImageId).toBe("img-1");
    expect(log.events[1].replacedById).toBe("img-2");
  });

  it("fails if the dead entry is already completed or replaced", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const deadRow = makeRow("img-1", "المستوى الأول", "PortA");
    const replacementRow = makeRow("img-2", "المستوى الأول", "PortA");

    const deadEntry: DistributionEntry = {
      xrayImageId: "img-1",
      assignedTo: "expert1",
      status: "completed",
      replacedById: null,
      row: deadRow,
      lastEventAt: new Date().toISOString(),
    };

    const result = await executeReplacement({
      directoryHandle: root,
      monthFolderName: "5-May-2026",
      deadEntry,
      replacementRow,
      reason: "Bad scan quality",
      eventBy: "supervisor1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result as { error: string }).error).toContain("لا يمكن استبدال هذه العينة");
    }
  });

  it("fails when the dead entry is already replaced (terminal state)", async () => {
    const root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
    const deadRow = makeRow("img-1", "المستوى الأول", "PortA");
    const replacementRow = makeRow("img-2", "المستوى الأول", "PortA");

    const deadEntry: DistributionEntry = {
      xrayImageId: "img-1",
      assignedTo: "expert1",
      status: "replaced",
      replacedById: "img-9",
      row: deadRow,
      lastEventAt: new Date().toISOString(),
    };

    const result = await executeReplacement({
      directoryHandle: root,
      monthFolderName: "5-May-2026",
      deadEntry,
      replacementRow,
      reason: "retry",
      eventBy: "supervisor1",
    });

    expect(result.ok).toBe(false);
    // No distribution events must be written for a terminal dead row.
    const log = await loadDistributionLog(root, "5-May-2026");
    expect(log.events).toHaveLength(0);
  });
});
