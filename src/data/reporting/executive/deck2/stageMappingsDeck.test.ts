// C1: deck2's stage×port pages must bucket rows with the SAME workspace alias
// table as the stage profiles (both keyed on the canonical stageKey), and
// resolve a card's level from that key — a custom alias must never fall
// through to "unknown" / neutral.
import { describe, expect, it } from "vitest";
import { DEFAULT_EXEC_CONFIG, type ExecutiveReportInput } from "../../executiveReportTypes";
import type { StageAliasMappings } from "../../../population/populationConfig";
import type { PreparedPopulationRow } from "../../../population/populationTypes";
import { makeRow } from "../../reportTestFixtures";
import { buildReportModel } from "../model/reportModel";
import { collectStagePortStats, stagePortPopulationSlide } from "./slides";

function input(
  populationRows: PreparedPopulationRow[],
  stageMappings?: Partial<StageAliasMappings>,
): ExecutiveReportInput {
  return {
    monthFolderName: "5-May-2026",
    populationRows,
    sample: null,
    distribution: null,
    employeeFiles: [],
    template: null,
    config: DEFAULT_EXEC_CONFIG,
    stageMappings,
  };
}

describe("deck2 stage identity under workspace stage mappings (C1)", () => {
  it("collectStagePortStats buckets a custom alias under the same canonical key as its profile", () => {
    const model = buildReportModel(
      input(
        [
          makeRow("A-1", "ميناء أ", { stage: "Custom Two" }),
          makeRow("A-2", "ميناء أ", { stage: "Custom Two" }),
        ],
        { second: ["Custom Two"] },
      ),
    );
    expect(model.population.byStage.map((s) => s.stageKey)).toEqual(["second"]);
    expect([...collectStagePortStats(model).keys()]).toEqual(["second"]);
  });

  it("an unmapped raw stage lands in the «unknown» bucket, matching its profile", () => {
    const model = buildReportModel(input([makeRow("B-1", "ميناء أ", { stage: "LEVEL-X" })]));
    expect(model.population.byStage.map((s) => s.stageKey)).toEqual(["unknown"]);
    expect([...collectStagePortStats(model).keys()]).toEqual(["unknown"]);
  });

  it("level identity (tone) comes from the canonical stageKey, not from re-parsing the label", () => {
    const model = buildReportModel(input([makeRow("C-1", "ميناء أ", { stage: "SECOND_STAG" })]));
    model.population.byStage = model.population.byStage.map((s) => ({ ...s, stageLabel: "مستوى مخصص" }));
    const html = stagePortPopulationSlide(model, 7, 20, true);
    expect(html).toMatch(/v2-stage-card blue v2-stage-port-card/);
    expect(html).not.toMatch(/v2-stage-card neutral v2-stage-port-card/);
  });
});
