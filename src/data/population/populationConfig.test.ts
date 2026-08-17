import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  savePopulationConfig,
  loadPopulationConfig,
  DEFAULT_POPULATION_CONFIG,
  DEFAULT_SAMPLING_RULES,
} from "./populationConfig";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

// B (sampling config UI) task 1: DEFAULT_SAMPLING_RULES previously defaulted
// minRequiredCount equal to `value` for stages 2-4, so lowering a stage's `value`
// alone was silently overridden back up by configuredTarget's
// Math.max(target, minRequiredCount) — the owner-reported "requested 7,000, got
// ~9,000" bug. New configs must not floor by default; existing saved configs on
// disk are untouched by this default (loadPopulationConfig never rewrites a
// loaded config's rule values), so this only guards what a *fresh* config starts
// with.
describe("DEFAULT_SAMPLING_RULES — no silent floor on new configs", () => {
  it("does not default minRequiredCount equal to value for stages 2-4", () => {
    for (const rule of DEFAULT_SAMPLING_RULES) {
      if (rule.stageKey === "first") continue; // stage 1 is intentionally locked at 100%
      expect(rule.minRequiredCount).toBe(0);
    }
  });
});

describe("populationConfig — CAS-protected save", () => {
  it("saves and reloads a config", async () => {
    const root = makeRoot();
    const config = {
      ...DEFAULT_POPULATION_CONFIG,
      customFields: [{ key: "extra", labelAr: "إضافي", dataType: "string" as const }],
    };
    const result = await savePopulationConfig(root, config);
    expect(result.ok).toBe(true);

    const loaded = await loadPopulationConfig(root);
    expect(loaded.customFields).toHaveLength(1);
    expect(loaded.customFields[0].key).toBe("extra");
  });

  it("does not leak revision/_writeToken bookkeeping into the loaded config", async () => {
    const root = makeRoot();
    await savePopulationConfig(root, DEFAULT_POPULATION_CONFIG);
    const loaded = (await loadPopulationConfig(root)) as Record<string, unknown>;
    expect(loaded.revision).toBeUndefined();
    expect(loaded._writeToken).toBeUndefined();
  });

  it("survives two concurrent config saves without throwing or corrupting the file (cross-machine CAS)", async () => {
    const root = makeRoot();
    // Two admins on two PCs save the config near-simultaneously. config.json is a
    // whole-object replace ⇒ last-writer-wins on fields (documented), but the CAS
    // read-modify-write must still converge on ONE internally consistent, readable
    // config — no torn/merged hybrid, no thrown error, both calls resolve ok.
    const configA = {
      ...DEFAULT_POPULATION_CONFIG,
      customFields: [{ key: "a", labelAr: "أ", dataType: "string" as const }],
    };
    const configB = {
      ...DEFAULT_POPULATION_CONFIG,
      customFields: [{ key: "b", labelAr: "ب", dataType: "string" as const }],
    };
    const [ra, rb] = await Promise.all([
      savePopulationConfig(root, configA),
      savePopulationConfig(root, configB),
    ]);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);

    // The persisted config is exactly one writer's payload (never a torn hybrid)
    // and reloads cleanly.
    const loaded = await loadPopulationConfig(root);
    expect(loaded.customFields).toHaveLength(1);
    expect(["a", "b"]).toContain(loaded.customFields[0].key);
  });
});

// 2026-08-17 audit finding: loadPopulationConfig's catch wrote
// DEFAULT_POPULATION_CONFIG over the existing config.json for ANY throw — so a
// transient share fault on a path that runs on every wizard mount silently
// destroyed the workspace's custom mapping templates, stage aliases, sampling
// rules and employee allocations. Only a genuine NotFound (fresh workspace) may
// seed defaults; a read failure returns defaults in memory and leaves the file
// alone.
describe("loadPopulationConfig — a transient read failure must not destroy config.json", () => {
  it("returns defaults for the failed call but leaves the saved config untouched", async () => {
    const { setSimulatedFaults, clearSimulatedFaults } = await import("../storage/memoryDirectory");
    const root = makeRoot();
    const custom = {
      ...DEFAULT_POPULATION_CONFIG,
      customFields: [{ key: "extra", labelAr: "إضافي", dataType: "string" as const }],
    };
    expect((await savePopulationConfig(root, custom)).ok).toBe(true);

    // Fresh page load (the dir-handle cache is empty) on a flaky share: the
    // OPEN of the population root throws — the path that reaches the
    // destructive catch (safeReadJson's own not-ok results never did; the
    // directory open is what threw).
    const { __clearWorkspaceDirCacheForTests } = await import("../workspace/workspacePaths");
    __clearWorkspaceDirCacheForTests();
    setSimulatedFaults(root as never, [
      {
        operation: "getDirectoryHandle",
        name: "1-population",
        create: false,
        errorName: "NotReadableError",
        times: Number.POSITIVE_INFINITY,
      },
    ]);
    const duringFault = await loadPopulationConfig(root);
    expect(duringFault.customFields).toEqual([]);
    clearSimulatedFaults(root as never);

    // The file survived: the next healthy load sees the custom config.
    const after = await loadPopulationConfig(root);
    expect(after.customFields).toEqual(custom.customFields);
  });

  it("still seeds defaults on a genuinely fresh workspace (population root absent)", async () => {
    const root = makeRoot();
    const loaded = await loadPopulationConfig(root);
    expect(loaded.customFields).toEqual([]);
    // The seed write happened: a subsequent read finds the file.
    const again = await loadPopulationConfig(root);
    expect(again.samplingRules.length).toBeGreaterThan(0);
  });
});
