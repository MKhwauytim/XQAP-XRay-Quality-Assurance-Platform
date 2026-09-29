// C1 guard: the canonical stage labels and key order live ONLY in
// src/data/population/stageLabels.ts. Each file below used to re-type its own
// copy (the drift CLAUDE.md's "no duplicate state" rule forbids); a copy that
// creeps back fails here. bulkAssignment.ts is deliberately not listed — its
// stage list is owned by Workstream A.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "../..");

const FORMER_COPIES = [
  "data/population/stageHelpers.ts",
  "data/sampling/sampleAlgorithmInternals.ts",
  "components/Sidebar/Tabs/Population/components/PhaseThreeSampling.tsx",
  "components/Sidebar/Tabs/Population/components/PhaseFourDistribution.tsx",
  "components/Sidebar/Tabs/Population/components/mappingSettingsConfig.ts",
  "data/reporting/populationReport/fold.ts",
  "workers/populationQueryWorker.ts",
  "components/DataTable/index.tsx",
  "components/Sidebar/Tabs/Population/BrowseDataView.tsx",
  "data/population/replacementIndexStorage.ts",
  "data/distribution/replacementCandidateLookup.ts",
  "data/reporting/executive/deck2/slides.ts",
  "dev/deckPreviewFixture.ts",
  "data/adhocImport/adhocFieldCatalog.ts",
];

const LABEL_MAP_ENTRY = /\bfourth\s*:\s*"المستوى الرابع"/;
const RANK_MAP_ENTRY = /"المستوى الرابع"\s*:\s*4/;
const KEY_ARRAY_LITERAL = /\[\s*"first"\s*,\s*"second"\s*,\s*"third"\s*,\s*"fourth"/;

describe("no re-typed stage label / order copies (C1)", () => {
  for (const relative of FORMER_COPIES) {
    it(`${relative} imports the canonical stage definitions instead of copying them`, () => {
      const source = readFileSync(path.join(srcRoot, relative), "utf8");
      expect(source).not.toMatch(LABEL_MAP_ENTRY);
      expect(source).not.toMatch(RANK_MAP_ENTRY);
      expect(source).not.toMatch(KEY_ARRAY_LITERAL);
    });
  }
});

// labelsStore.ts keeps admin-editable `stage_*` keys; their DEFAULT text is
// derived from stageLabels.ts, never re-typed.
describe("labelsStore stage defaults come from stageLabels.ts (C1)", () => {
  it("does not re-type any stage label default", () => {
    const source = readFileSync(path.join(srcRoot, "data/labels/labelsStore.ts"), "utf8");
    expect(source).not.toMatch(/\bstage_(first|second|third|fourth|unknown)\s*:\s*"/);
  });
});

describe("stageLabels.ts stays worker-safe (C1)", () => {
  it("has no non-type import, so the population worker bundle stays lean", () => {
    const source = readFileSync(path.join(srcRoot, "data/population/stageLabels.ts"), "utf8");
    expect(source).not.toMatch(/^import\s+(?!type\b)/m);
  });
});
