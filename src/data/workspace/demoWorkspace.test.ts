import { describe, expect, it } from "vitest";

import {
  buildDemoManagedUsers,
  createDemoWorkspace,
  DEMO_SEED_PROFILE,
  DEMO_TEMPLATE_ID,
  DEMO_WORKSPACE_NAME,
} from "./demoWorkspace";
import { formatMonthFolderName } from "../population/monthFolder";
import { loadMonthPopulationFinal } from "../population/populationStorage";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { loadDistributionLog } from "../distribution/distributionStorage";
import { loadTemplate } from "../templates/templateStorage";
import { loadInspectionTemplateSelection } from "../templates/templateSelectionStorage";
import type { PreparedPopulationRow } from "../population/populationTypes";

// Characterization test for the shipped demo workspace. `seedWorkspaceMonth`
// is shared with the dev-only simulated workspace (src/dev/simWorkspace.ts), so
// this pins the demo's own numbers: a change made for the simulation that alters
// what the demo shows fails here instead of silently shipping.
const MONTH_FOLDER = formatMonthFolderName(
  DEMO_SEED_PROFILE.month,
  DEMO_SEED_PROFILE.year
);

describe("demo workspace", () => {
  it("seeds the demo month through the real writers with the ~100-image sample", async () => {
    const handle = await createDemoWorkspace();
    expect(handle.name).toBe(DEMO_WORKSPACE_NAME);

    const population = await loadMonthPopulationFinal(handle, MONTH_FOLDER);
    const rows = (population?.rows ?? []) as PreparedPopulationRow[];
    expect(rows).toHaveLength(400);

    // 25% of the 400-row stage-1 population — the owner's "about 100 sample"
    // demo target, drawn by the real algorithm off the fixed RNG seed.
    const master = await loadSampleMaster(handle, MONTH_FOLDER);
    expect(master?.rows).toHaveLength(100);
  });

  it("gives the demo account its own assigned queue (the reassignment showcase)", async () => {
    const handle = await createDemoWorkspace();

    // The roster the demo workspace writes carries the demo employee account
    // on top of the shipped defaults…
    const roster = buildDemoManagedUsers();
    const demoUser = roster.find((u) => u.username === "demo");
    expect(demoUser?.role).toBe("employee");
    expect(demoUser?.isActive).toBe(true);

    // …and the seeded distribution actually lands part of the sample on it,
    // plus a distinct slice on the supervisor (malrogi) so «الموظف يرى عينات
    // مختلفة عن المشرف» and reassignment demo → supervisor can be shown live.
    const log = await loadDistributionLog(handle, MONTH_FOLDER);
    const assigned = (log?.events ?? []).filter((e) => e.eventType === "assigned");
    const byUser = new Map<string, number>();
    for (const evt of assigned) {
      byUser.set(evt.assignedTo, (byUser.get(evt.assignedTo) ?? 0) + 1);
    }
    expect(byUser.get("demo") ?? 0).toBeGreaterThan(0);
    expect(byUser.get("malrogi") ?? 0).toBeGreaterThan(0);
    expect(byUser.get("demo")).not.toBe(byUser.get("malrogi"));
  });

  it("keeps the demo's risk column binary", async () => {
    const handle = await createDemoWorkspace();
    const population = await loadMonthPopulationFinal(handle, MONTH_FOLDER);
    const rows = (population?.rows ?? []) as PreparedPopulationRow[];

    // DEMO_SEED_PROFILE.riskEngineSpread is "binary" — the four-way vocabulary
    // spread is the simulated workspace's, not the demo's.
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
