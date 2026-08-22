import { describe, expect, it } from "vitest";

import {
  createDemoWorkspace,
  DEMO_SEED_PROFILE,
  DEMO_TEMPLATE_ID,
  DEMO_WORKSPACE_NAME,
} from "./demoWorkspace";
import { formatMonthFolderName } from "../population/monthFolder";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { loadTemplate } from "../templates/templateStorage";
import { loadInspectionTemplateSelection } from "../templates/templateSelectionStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";

// Characterization test for the shipped viewer/demo workspace. `seedWorkspaceMonth`
// is now shared with the dev-only simulated workspace (src/dev/simWorkspace.ts), so
// this pins the demo's own numbers: a change made for the simulation that alters what
// the demo shows fails here instead of silently shipping.
const MONTH_FOLDER = formatMonthFolderName(
  DEMO_SEED_PROFILE.month,
  DEMO_SEED_PROFILE.year
);

describe("demo workspace", () => {
  it("seeds the demo month through the real writers", async () => {
    const handle = await createDemoWorkspace();
    expect(handle.name).toBe(DEMO_WORKSPACE_NAME);

    const population = await loadMonthPopulationFinal(handle, MONTH_FOLDER);
    const rows = (population?.rows ?? []) as PreparedPopulationRow[];
    expect(rows).toHaveLength(200);

    const master = await loadSampleMaster(handle, MONTH_FOLDER);
    expect(master?.rows.length).toBeGreaterThan(0);
    expect(master?.rows.length).toBeLessThan(rows.length);
  });

  it("keeps the demo's risk column binary", async () => {
    const handle = await createDemoWorkspace();
    const population = await loadMonthPopulationFinal(handle, MONTH_FOLDER);
    const rows = (population?.rows ?? []) as PreparedPopulationRow[];

    // DEMO_SEED_PROFILE.riskEngineSpread is "binary" precisely so the shipped
    // demo's executive-deck numbers are unchanged by the parameterization; the
    // four-way vocabulary spread is the simulated workspace's, not the demo's.
    expect(DEMO_SEED_PROFILE.riskEngineSpread).toBe("binary");
    expect([...new Set(rows.map((r) => r.targetedByRiskEngine))].sort()).toEqual([
      "لا",
      "نعم",
    ]);
  });

  it("seeds the inspection template its answers reference", async () => {
    const handle = await createDemoWorkspace();
    // The seeded ItemAnswers point at DEMO_TEMPLATE_ID; before this the template
    // itself was never written, so the inspection form had nothing to render.
    expect(await loadTemplate(handle, DEMO_TEMPLATE_ID)).not.toBeNull();
    expect((await loadInspectionTemplateSelection(handle))?.templateId).toBe(
      DEMO_TEMPLATE_ID
    );
  });
});
