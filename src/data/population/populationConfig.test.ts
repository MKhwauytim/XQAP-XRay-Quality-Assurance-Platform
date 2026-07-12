import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  savePopulationConfig,
  loadPopulationConfig,
  DEFAULT_POPULATION_CONFIG,
} from "./populationConfig";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

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
