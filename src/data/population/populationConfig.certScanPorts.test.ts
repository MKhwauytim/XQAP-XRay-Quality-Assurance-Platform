// C2: whole-port CertScan flags live in population config.json next to
// employeePortRestrictions. The field is additive and optional — every
// config.json written before it existed must load as [] (no migration).
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import {
  DEFAULT_POPULATION_CONFIG,
  loadPopulationConfig,
  normalizeCertScanPorts,
  savePopulationConfig,
} from "./populationConfig";

function makeRoot(): DirectoryHandleLike {
  return createMemoryDirectory("root") as unknown as DirectoryHandleLike;
}

describe("PopulationConfig.certScanPorts (C2)", () => {
  it("defaults to [] on the built-in config", () => {
    expect(DEFAULT_POPULATION_CONFIG.certScanPorts).toEqual([]);
  });

  it("loads a legacy config.json that predates the field as [] without disturbing other fields", async () => {
    const root = makeRoot();
    const legacy = { ...DEFAULT_POPULATION_CONFIG } as Record<string, unknown>;
    delete legacy.certScanPorts;
    await savePopulationConfig(root, legacy as unknown as typeof DEFAULT_POPULATION_CONFIG);

    const loaded = await loadPopulationConfig(root);
    expect(loaded.certScanPorts).toEqual([]);
    expect(loaded.employeePortRestrictions).toEqual([]);
    expect(loaded.samplingRules).toEqual(DEFAULT_POPULATION_CONFIG.samplingRules);
  });

  it("round-trips a saved list", async () => {
    const root = makeRoot();
    await savePopulationConfig(root, {
      ...DEFAULT_POPULATION_CONFIG,
      certScanPorts: ["ميناء جدة الإسلامي", "منفذ البطحاء"],
    });
    expect((await loadPopulationConfig(root)).certScanPorts).toEqual(["ميناء جدة الإسلامي", "منفذ البطحاء"]);
  });

  it("normalizes a stored value: strings only, no blanks, de-duplicated in first-seen order", () => {
    expect(normalizeCertScanPorts(["منفذ أ", "", "منفذ ب", "منفذ أ", 7, null])).toEqual(["منفذ أ", "منفذ ب"]);
    expect(normalizeCertScanPorts(undefined)).toEqual([]);
    // Padding is trimmed (a padded name never matches a row) and then de-duplicated.
    expect(normalizeCertScanPorts([" منفذ أ ", "منفذ أ", "   "])).toEqual(["منفذ أ"]);
    expect(normalizeCertScanPorts("منفذ أ")).toEqual([]);
  });
});
