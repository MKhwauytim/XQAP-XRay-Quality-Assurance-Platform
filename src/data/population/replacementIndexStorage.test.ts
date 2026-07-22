import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { PreparedPopulationRow } from "./populationTypes";
import {
  bucketFileName,
  computeStageMappingsHash,
  isReplacementIndexFresh,
  loadReplacementBucket,
  loadReplacementIndexManifest,
  rebuildReplacementIndex,
} from "./replacementIndexStorage";
import { REPLACEMENT_INDEX_FORMAT_VERSION } from "./replacementIndexTypes";

const makeRow = (
  id: string,
  stage: string,
  port: string,
  certScan: "Certscan" | "NonCertscan" = "Certscan"
): PreparedPopulationRow => ({
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
    liveMeans: { result: null, code: null, employeeId: null },
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

const MONTH = "5-may-2026";

async function seedMonth(root: ReturnType<typeof createMemoryDirectory>) {
  const population = await root.getDirectoryHandle("1-population", { create: true });
  const monthDir = await population.getDirectoryHandle(MONTH, { create: true });
  await monthDir.getDirectoryHandle("2-processed", { create: true });
  return monthDir;
}

describe("rebuildReplacementIndex + read path", () => {
  it("buckets rows by (tier, stageKey), including the unknown stage, and omits empty buckets", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root);
    const rows = [
      makeRow("c1", "المستوى الأول", "PortA", "Certscan"),
      makeRow("c2", "المستوى الأول", "PortB", "Certscan"),
      makeRow("n1", "غير معروف", "PortA", "NonCertscan"), // unmapped stage text -> "unknown"
    ];
    const hash = computeStageMappingsHash();

    const outcome = await rebuildReplacementIndex(root, MONTH, rows, undefined, 1, "admin");
    expect(outcome.ok).toBe(true);

    const manifest = await loadReplacementIndexManifest(root, MONTH);
    expect(manifest).not.toBeNull();
    expect(manifest?.formatVersion).toBe(REPLACEMENT_INDEX_FORMAT_VERSION);
    expect(manifest?.sourceRevision).toBe(1);
    expect(manifest?.stageMappingsHash).toBe(hash);
    expect(manifest?.totalIndexedRows).toBe(3);
    // Only 2 of the possible 10 (tier,stageKey) buckets are populated.
    expect(manifest?.buckets).toHaveLength(2);

    const certFirst = await loadReplacementBucket(root, MONTH, "Certscan", "first");
    expect(certFirst?.map((r) => r.xrayImageId)).toEqual(["c1", "c2"]);

    const nonCertUnknown = await loadReplacementBucket(root, MONTH, "NonCertscan", "unknown");
    expect(nonCertUnknown?.map((r) => r.xrayImageId)).toEqual(["n1"]);

    // A bucket that has no rows must not exist on disk.
    const certSecond = await loadReplacementBucket(root, MONTH, "Certscan", "second");
    expect(certSecond).toBeNull();
  });

  it("preserves original row order within a bucket (capSeeded's Fisher-Yates draw is order-sensitive)", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root);
    const rows = [
      makeRow("z", "المستوى الأول", "PortA"),
      makeRow("a", "المستوى الأول", "PortA"),
      makeRow("m", "المستوى الأول", "PortA"),
    ];

    await rebuildReplacementIndex(root, MONTH, rows, undefined, 1, "admin");
    const bucket = await loadReplacementBucket(root, MONTH, "Certscan", "first");

    expect(bucket?.map((r) => r.xrayImageId)).toEqual(["z", "a", "m"]);
  });

  it("isReplacementIndexFresh matches only on the exact sourceRevision and stageMappingsHash pair", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root);
    await rebuildReplacementIndex(root, MONTH, [makeRow("c1", "المستوى الأول", "PortA")], undefined, 1, "admin");
    const manifest = await loadReplacementIndexManifest(root, MONTH);
    const hash = computeStageMappingsHash();

    expect(isReplacementIndexFresh(manifest, 1, hash)).toBe(true);
    expect(isReplacementIndexFresh(manifest, 2, hash)).toBe(false); // population re-saved
    expect(isReplacementIndexFresh(manifest, 1, "different-hash")).toBe(false); // stage mappings edited
    expect(isReplacementIndexFresh(null, 1, hash)).toBe(false); // missing index (legacy month)
  });

  it("a rebuild for an equal or lower sourceRevision than what's already published is a no-op", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root);
    await rebuildReplacementIndex(root, MONTH, [makeRow("c1", "المستوى الأول", "PortA")], undefined, 5, "admin");

    // A straggling background rebuild computed against an older population revision.
    await rebuildReplacementIndex(root, MONTH, [makeRow("stale", "المستوى الأول", "PortA")], undefined, 3, "admin");

    const manifest = await loadReplacementIndexManifest(root, MONTH);
    expect(manifest?.sourceRevision).toBe(5);
    const bucket = await loadReplacementBucket(root, MONTH, "Certscan", "first");
    expect(bucket?.map((r) => r.xrayImageId)).toEqual(["c1"]); // stale rebuild's rows never landed
  });

  it("a rebuild at the SAME sourceRevision but with a different stage-mappings hash actually rebuilds (self-heal must not be blocked by the revision-only guard)", async () => {
    // Editing stage aliases in Settings does not touch population.final.json, so
    // sourceRevision stays the same while the mappings (and their hash) change.
    // The monotonic guard must not treat "same revision" as "nothing to do" —
    // otherwise a stale-index fallback's background self-heal can never recover
    // from a mappings-only edit, and every subsequent dialog open falls back
    // to the full scan forever, until the month is fully reprocessed.
    const root = createMemoryDirectory();
    await seedMonth(root);
    await rebuildReplacementIndex(root, MONTH, [makeRow("old", "المستوى الأول", "PortA")], undefined, 1, "admin");
    const before = await loadReplacementIndexManifest(root, MONTH);

    const customMappings = { first: ["مرحلة اولى مخصصة"] };
    const outcome = await rebuildReplacementIndex(
      root, MONTH, [makeRow("old", "مرحلة اولى مخصصة", "PortA")], customMappings, 1, "admin"
    );
    expect(outcome.ok).toBe(true);

    const after = await loadReplacementIndexManifest(root, MONTH);
    expect(after?.sourceRevision).toBe(1);
    expect(after?.stageMappingsHash).toBe(computeStageMappingsHash(customMappings));
    expect(after?.stageMappingsHash).not.toBe(before?.stageMappingsHash);

    // Confirm the rebuild actually re-bucketed under the NEW mappings, not a no-op.
    const bucket = await loadReplacementBucket(root, MONTH, "Certscan", "first");
    expect(bucket?.map((r) => r.xrayImageId)).toEqual(["old"]);
  });

  it("removes a bucket file left over from a re-save that shrank it to zero rows", async () => {
    const root = createMemoryDirectory();
    await seedMonth(root);
    await rebuildReplacementIndex(
      root,
      MONTH,
      [makeRow("c1", "المستوى الأول", "PortA"), makeRow("c2", "المستوى الثاني", "PortA")],
      undefined,
      1,
      "admin"
    );
    expect(await loadReplacementBucket(root, MONTH, "Certscan", "second")).not.toBeNull();

    // Reprocess: the "second" stage bucket is now empty.
    await rebuildReplacementIndex(root, MONTH, [makeRow("c1", "المستوى الأول", "PortA")], undefined, 2, "admin");

    expect(await loadReplacementBucket(root, MONTH, "Certscan", "second")).toBeNull();
  });

  it("returns { ok: false } instead of throwing when the month folder does not exist", async () => {
    const root = createMemoryDirectory();
    // Deliberately not seeded — "2-processed" does not exist.
    const outcome = await rebuildReplacementIndex(root, "9-sep-2026", [makeRow("c1", "المستوى الأول", "PortA")], undefined, 1, "admin");
    expect(outcome.ok).toBe(false);
  });

  it("bucketFileName is stable and distinct per (tier, stageKey)", () => {
    expect(bucketFileName("Certscan", "first")).not.toBe(bucketFileName("NonCertscan", "first"));
    expect(bucketFileName("Certscan", "first")).not.toBe(bucketFileName("Certscan", "second"));
  });
});
