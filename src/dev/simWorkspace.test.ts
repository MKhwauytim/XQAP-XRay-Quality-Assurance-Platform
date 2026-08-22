import { describe, expect, it } from "vitest";

import {
  createSimulatedWorkspace,
  SIM_GUEST_USERNAME,
  SIM_MONTH,
  SIM_ROLE_USERNAMES,
  SIM_SEED_PROFILE,
  SIM_SEEDED_AT,
  SIM_TEMPLATE_ID,
  SIM_WORKSPACE_NAME,
  SIM_YEAR,
  buildSimManagedUsers,
} from "./simWorkspace";
import { formatMonthFolderName } from "../data/population/monthFolder";
import { listMonthFolders, loadMonthPopulationFinal } from "../data/population/populationStorage";
import { loadSampleMaster } from "../data/sampling/sampleStorage";
import { loadOrDeriveDistributionCurrent } from "../data/distribution/distributionStorage";
import { loadEmployeeAnswers } from "../data/answers/answerStorage";
import { loadTemplate, loadTemplateIndex } from "../data/templates/templateStorage";
import { loadInspectionTemplateSelection } from "../data/templates/templateSelectionStorage";
import { engineVerdictOf } from "../data/population/riskEngineVerdict";
import type { PreparedPopulationRow } from "../data/population/populationTypes";
import type { DirectoryHandleLike } from "../data/storage/fileSystemAccess";

const MONTH_FOLDER = formatMonthFolderName(SIM_MONTH, SIM_YEAR);

// Every count below is an OBSERVED value of the deterministic seed, pinned so a
// change to the seed, the draw or the apportionment fails here instead of
// silently invalidating whatever a browser test was asserting.
const EXPECTED_POPULATION_ROWS = 320;
const EXPECTED_SAMPLE_ROWS = 96;
const EXPECTED_ASSIGNMENTS: ReadonlyArray<readonly [string, number]> = [
  ["jalgahamdi", 34],
  ["hihaloraini", 29],
  ["saalhijji", 19],
  ["malrogi", 14],
];

async function loadSampleRows(handle: DirectoryHandleLike): Promise<PreparedPopulationRow[]> {
  const master = await loadSampleMaster(handle, MONTH_FOLDER);
  return (master?.rows ?? []) as PreparedPopulationRow[];
}

describe("simulated workspace seed", () => {
  it("mounts an in-memory handle with its own distinct name", async () => {
    const handle = await createSimulatedWorkspace();
    expect(handle.name).toBe(SIM_WORKSPACE_NAME);
    // Distinct from the read-only viewer demo, so nothing can confuse the two.
    expect(handle.name).not.toBe("Demo-Workspace");
  });

  it("seeds exactly one month, with the population the port profile describes", async () => {
    const handle = await createSimulatedWorkspace();

    const months = await listMonthFolders(handle);
    expect(months.map((m) => m.folderName)).toEqual([MONTH_FOLDER]);

    const population = await loadMonthPopulationFinal(handle, MONTH_FOLDER);
    expect(population?.rows).toHaveLength(EXPECTED_POPULATION_ROWS);
    expect(EXPECTED_POPULATION_ROWS).toBe(
      SIM_SEED_PROFILE.ports.reduce((sum, port) => sum + port.count, 0)
    );

    const byPort = new Map<string, number>();
    for (const row of (population?.rows ?? []) as PreparedPopulationRow[]) {
      const portName = row.portName ?? "";
      byPort.set(portName, (byPort.get(portName) ?? 0) + 1);
    }
    for (const port of SIM_SEED_PROFILE.ports) {
      expect(byPort.get(port.name)).toBe(port.count);
    }
  });

  it("draws a stratified sample smaller than the population", async () => {
    const handle = await createSimulatedWorkspace();
    const rows = await loadSampleRows(handle);

    expect(rows).toHaveLength(EXPECTED_SAMPLE_ROWS);
    expect(rows.length).toBeLessThan(EXPECTED_POPULATION_ROWS);
    // Every seeded port is represented, so a port filter has something to filter.
    const ports = new Set(rows.map((row) => row.portName));
    expect(ports.size).toBe(SIM_SEED_PROFILE.ports.length);
  });

  it("distributes the sample across several employees with unequal shares", async () => {
    const handle = await createSimulatedWorkspace();
    const rows = await loadSampleRows(handle);
    const current = await loadOrDeriveDistributionCurrent(handle, MONTH_FOLDER, rows);

    const perEmployee = new Map<string, number>();
    for (const entry of current?.entries ?? []) {
      perEmployee.set(entry.assignedTo, (perEmployee.get(entry.assignedTo) ?? 0) + 1);
    }

    expect([...perEmployee.entries()].sort()).toEqual(
      [...EXPECTED_ASSIGNMENTS].map(([name, count]) => [name, count]).sort()
    );
    // Unequal on purpose: an even split would be satisfied by an apportionment
    // bug that just divided by the reviewer count.
    expect(new Set(EXPECTED_ASSIGNMENTS.map(([, count]) => count)).size).toBe(
      EXPECTED_ASSIGNMENTS.length
    );
  });

  it("leaves some assigned rows answered and some not", async () => {
    const handle = await createSimulatedWorkspace();

    for (const [username, assignedCount] of EXPECTED_ASSIGNMENTS) {
      const file = await loadEmployeeAnswers(handle, MONTH_FOLDER, username);
      const submitted = file.items.filter((item) => item.status === "submitted");
      const drafts = file.items.filter((item) => item.status === "draft");

      // The answer-on-behalf rule turns on "already answered" vs "not", so the
      // seed has to contain all three states for one employee at once.
      expect(submitted.length).toBeGreaterThan(0);
      expect(drafts.length).toBeGreaterThan(0);
      expect(file.items.length).toBeLessThan(assignedCount);

      for (const item of file.items) {
        expect(item.templateId).toBe(SIM_TEMPLATE_ID);
        expect(item.lastSavedAt).toBe(SIM_SEEDED_AT);
      }
    }
  });

  it("seeds the inspection template the answers reference, and selects it", async () => {
    const handle = await createSimulatedWorkspace();

    const index = await loadTemplateIndex(handle);
    expect(index.templates.map((t) => t.templateId)).toContain(SIM_TEMPLATE_ID);

    const template = await loadTemplate(handle, SIM_TEMPLATE_ID);
    expect(template).not.toBeNull();
    // `qualityImageResult` is the reporting pipeline's ground-truth field id
    // (executiveReportTypes.ts → expertResultFieldId) and the seeded answers
    // carry it; a template missing it renders a form the answers cannot fill.
    expect(template?.fields.map((f) => f.fieldId)).toEqual([
      "qualityImageResult",
      "result",
      "notes",
    ]);

    const selection = await loadInspectionTemplateSelection(handle);
    expect(selection?.templateId).toBe(SIM_TEMPLATE_ID);
  });

  it("spreads targetedByRiskEngine across all four verdict categories", async () => {
    const handle = await createSimulatedWorkspace();
    const population = await loadMonthPopulationFinal(handle, MONTH_FOLDER);
    const rows = (population?.rows ?? []) as PreparedPopulationRow[];

    const affirmative = rows.filter((r) => engineVerdictOf(r.targetedByRiskEngine) === "اشتباه");
    const negative = rows.filter((r) => engineVerdictOf(r.targetedByRiskEngine) === "سليمة");
    const blank = rows.filter(
      (r) => r.targetedByRiskEngine === null || r.targetedByRiskEngine === ""
    );
    const unrecognized = rows.filter(
      (r) =>
        r.targetedByRiskEngine !== null &&
        r.targetedByRiskEngine !== "" &&
        engineVerdictOf(r.targetedByRiskEngine) === null
    );

    expect(affirmative).toHaveLength(80);
    expect(negative).toHaveLength(80);
    expect(blank).toHaveLength(80);
    expect(unrecognized).toHaveLength(80);

    // The correctness core of riskEngineVerdict.ts: a blank is NOT سليمة. If a
    // seed only ever emitted نعم/لا the «مستهدف المؤشر» filter would pass on a
    // population that cannot distinguish "the engine said no" from "we do not
    // know what the engine said".
    expect(blank.length + unrecognized.length).toBeGreaterThan(0);
    expect(engineVerdictOf(blank[0].targetedByRiskEngine)).toBeNull();
    expect(engineVerdictOf(unrecognized[0].targetedByRiskEngine)).toBeNull();

    // …and the filter has affirmative rows inside the DRAWN sample, not just in
    // the population, or an employee's case queue filters down to nothing.
    const sampleRows = await loadSampleRows(handle);
    expect(
      sampleRows.filter((r) => engineVerdictOf(r.targetedByRiskEngine) === "اشتباه").length
    ).toBeGreaterThan(0);
  });

  it("is byte-for-byte deterministic across runs", async () => {
    const [first, second] = await Promise.all([
      createSimulatedWorkspace(),
      createSimulatedWorkspace(),
    ]);

    const firstPopulation = await loadMonthPopulationFinal(first, MONTH_FOLDER);
    const secondPopulation = await loadMonthPopulationFinal(second, MONTH_FOLDER);
    expect(JSON.stringify(secondPopulation?.rows)).toBe(
      JSON.stringify(firstPopulation?.rows)
    );

    const firstSample = await loadSampleRows(first);
    const secondSample = await loadSampleRows(second);
    // Identical rows AND identical order — the draw is seeded, not shuffled.
    expect(secondSample.map((r) => r.xrayImageId)).toEqual(
      firstSample.map((r) => r.xrayImageId)
    );

    for (const [username] of EXPECTED_ASSIGNMENTS) {
      const a = await loadEmployeeAnswers(first, MONTH_FOLDER, username);
      const b = await loadEmployeeAnswers(second, MONTH_FOLDER, username);
      expect(JSON.stringify(b.items)).toBe(JSON.stringify(a.items));
    }
  });

  it("seeds an active managed account for every role the URL contract accepts", async () => {
    const users = buildSimManagedUsers();

    // `admin` is the bootstrap admin: never a managed user, exempt from
    // AuthGate's stillHasManagedUser re-validation by design.
    expect(SIM_ROLE_USERNAMES.admin).toBe("admin");

    for (const role of ["guest", "employee", "supervisor", "manager"] as const) {
      const username = SIM_ROLE_USERNAMES[role];
      const match = users.find((u) => u.username === username);
      expect(match, `no seeded user for role ${role}`).toBeDefined();
      expect(match?.role).toBe(role);
      expect(match?.isActive).toBe(true);
    }

    // The shipped defaults have no guest, which is why the seed adds one.
    expect(users.filter((u) => u.role === "guest").map((u) => u.username)).toEqual([
      SIM_GUEST_USERNAME,
    ]);
  });
});
