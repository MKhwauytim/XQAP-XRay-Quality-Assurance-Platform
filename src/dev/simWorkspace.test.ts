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
import {
  ALL_ACTION_TYPES,
  HIGH_VOLUME_ACTION_TYPES,
  readWorkspaceActions,
  type WorkspaceActionEntry,
} from "../data/audit/actionLog";
import {
  SIM_ACTION_ACTOR_ROLES,
  SIM_ACTION_LOG_DAY_SPAN,
  SIM_ACTION_LOG_FIRST_DAY,
  SIM_ACTION_RETIRED_SUBJECTS,
} from "./simActionLog";
import { DATA_PAGE_SIZE } from "../utils/paginationUtils";
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

// ─── Action log ────────────────────────────────────────────────────────────
// Same rule as the counts above: OBSERVED values of the deterministic seed,
// pinned so a change to the action-log seed fails here instead of silently
// invalidating a browser test that was asserting on them.
const EXPECTED_ACTION_ENTRIES = 171;
const EXPECTED_ACTIONS_BY_ACTOR: ReadonlyArray<readonly [string, number]> = [
  ["admin", 56],
  ["malrogi", 30],
  ["amonem", 19],
  ["jalgahamdi", 19],
  ["mkhuwaytim", 18],
  ["hihaloraini", 17],
  ["saalhijji", 12],
];
const EXPECTED_ACTIONS_BY_TYPE: ReadonlyArray<readonly [string, number]> = [
  ["answer-submitted", 40],
  ["label-override-changed", 8],
  ["answer-quality-note-set", 8],
  ["distribution-row-changed", 8],
  ["referral-requested", 8],
  ["referral-approved", 6],
  ["report-generated", 6],
  ["answer-reopened", 4],
  ["notification-deleted", 4],
  ["notification-posted", 4],
  ["reopen-requested", 4],
  ["replacement-requested", 4],
  ["answer-submitted-on-behalf", 3],
  ["template-updated", 3],
];
/** Every entry naming a single sample row puts that row in `target`. */
const ROW_TARGET_ACTIONS = new Set([
  "answer-submitted",
  "answer-submitted-on-behalf",
  "answer-quality-note-set",
  "answer-reopened",
  "reopen-requested",
  "replacement-applied",
  "distribution-row-changed",
]);
/** `details` keys that hold a username, wherever they appear. */
const USERNAME_DETAIL_KEYS = ["employee", "assignee", "toEmployee", "from", "to"];
const XRAY_ID_PATTERN = /^DEMO-[A-Z]{3}-\d{4}$/;

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function detailValues(entry: WorkspaceActionEntry): string[] {
  return Object.values(entry.details ?? {}).map((value) => String(value ?? ""));
}

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

  it("seeds a workspace action log spread across actors, types and dates", async () => {
    const handle = await createSimulatedWorkspace();
    const entries = await readWorkspaceActions(handle);

    expect(entries).toHaveLength(EXPECTED_ACTION_ENTRIES);

    // The actor <select> needs more than one option to be a filter at all, and
    // the counts have to be unequal or "narrowed to actor X" is indistinguishable
    // from "did nothing".
    const byActor = countBy(entries, (entry) => entry.actor);
    expect(
      [...byActor.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    ).toEqual(EXPECTED_ACTIONS_BY_ACTOR.map(([actor, count]) => [actor, count]));

    const byType = countBy(entries, (entry) => entry.action);
    for (const [action, count] of EXPECTED_ACTIONS_BY_TYPE) {
      expect(byType.get(action), `count for ${action}`).toBe(count);
    }

    // Every declared action type has at least one entry, so no checkbox in the
    // grouped type picker is a dead control — including the ones whose group
    // would otherwise be empty (ad-hoc imports, notifications, templates).
    for (const action of ALL_ACTION_TYPES) {
      expect(byType.get(action) ?? 0, `no seeded entry for ${action}`).toBeGreaterThan(0);
    }

    // The high-volume types arrive UNCHECKED in the viewer, so a browser test
    // has to be able to prove that enabling them reveals rows that were hidden.
    const highVolume = entries.filter((entry) =>
      HIGH_VOLUME_ACTION_TYPES.includes(entry.action)
    );
    expect(highVolume.length).toBe(48);
    for (const action of HIGH_VOLUME_ACTION_TYPES) {
      expect(byType.get(action) ?? 0, `no seeded entry for ${action}`).toBeGreaterThan(0);
    }

    // …and the default (high-volume-off) view still overflows one page, so
    // paging is exercisable without touching the type picker first.
    const defaultVisible = entries.length - highVolume.length;
    expect(defaultVisible).toBe(123);
    expect(defaultVisible).toBeGreaterThan(DATA_PAGE_SIZE);

    // `target`/`details` are the free-text haystack. The search box scans detail
    // KEYS as well as values, so both have to carry something findable.
    const withTarget = entries.filter((entry) => (entry.target ?? "") !== "");
    const withDetails = entries.filter((entry) => entry.details !== undefined);
    expect(withTarget.length).toBeGreaterThan(entries.length / 2);
    expect(withDetails.length).toBeGreaterThan(entries.length / 2);
    const detailKeys = new Set(entries.flatMap((entry) => Object.keys(entry.details ?? {})));
    expect(detailKeys.has("seed")).toBe(true);
    expect(detailKeys.has("employee")).toBe(true);
    expect(
      entries.some((entry) => detailValues(entry).includes(SIM_SEED_PROFILE.rngSeed))
    ).toBe(true);
  });

  it("spreads the action log over a date range wider than any window a test would pick", async () => {
    const handle = await createSimulatedWorkspace();
    const entries = await readWorkspaceActions(handle);

    const days = [...new Set(entries.map((entry) => entry.at.slice(0, 10)))].sort();
    expect(days).toHaveLength(SIM_ACTION_LOG_DAY_SPAN);
    expect(days[0]).toBe(SIM_ACTION_LOG_FIRST_DAY);
    expect(days.at(-1)).toBe("2026-07-15");
    for (const entry of entries) {
      expect(Number.isNaN(Date.parse(entry.at)), entry.id).toBe(false);
    }

    // The point of the spread: an inner window has entries on BOTH sides of it,
    // so a date-range filter narrows to strictly fewer rows than it started with.
    const inWindow = entries.filter(
      (entry) => entry.at.slice(0, 10) >= "2026-07-01" && entry.at.slice(0, 10) <= "2026-07-07"
    );
    expect(inWindow.length).toBeGreaterThan(0);
    expect(inWindow.length).toBeLessThan(entries.length);
    expect(entries.some((entry) => entry.at.slice(0, 10) < "2026-07-01")).toBe(true);
    expect(entries.some((entry) => entry.at.slice(0, 10) > "2026-07-07")).toBe(true);
  });

  it("references only rows and users that exist elsewhere in the seed", async () => {
    const handle = await createSimulatedWorkspace();
    const entries = await readWorkspaceActions(handle);

    const population = await loadMonthPopulationFinal(handle, MONTH_FOLDER);
    const populationIds = new Set(
      ((population?.rows ?? []) as PreparedPopulationRow[]).map((row) => row.xrayImageId)
    );
    const sampleRows = await loadSampleRows(handle);
    const sampleIds = new Set(sampleRows.map((row) => row.xrayImageId));
    const current = await loadOrDeriveDistributionCurrent(handle, MONTH_FOLDER, sampleRows);
    const assignedTo = new Map(
      (current?.entries ?? []).map((entry) => [entry.xrayImageId, entry.assignedTo])
    );
    const roster = new Set(buildSimManagedUsers().map((user) => user.username));
    roster.add(SIM_ROLE_USERNAMES.admin);
    const knownNames = new Set([...roster, ...SIM_ACTION_RETIRED_SUBJECTS]);

    const submittedBy = new Map<string, Set<string>>();
    for (const [username] of EXPECTED_ASSIGNMENTS) {
      const file = await loadEmployeeAnswers(handle, MONTH_FOLDER, username);
      submittedBy.set(
        username,
        new Set(file.items.filter((item) => item.status === "submitted").map((item) => item.xrayImageId))
      );
    }

    for (const entry of entries) {
      // 1. The actor is a real account, stamped with the role that account holds.
      expect(roster.has(entry.actor), `unknown actor ${entry.actor}`).toBe(true);
      expect(entry.actorRole).toBe(SIM_ACTION_ACTOR_ROLES[entry.actor]);
      // 2. A month-scoped entry names the one month the seed wrote.
      expect(entry.monthFolderName === null || entry.monthFolderName === MONTH_FOLDER).toBe(true);

      // 3. Anything shaped like an xray image id — in `target` OR in any detail
      //    value — is a real population row. A replacement row is deliberately
      //    off-sample, so the population is the right denominator here.
      for (const value of [entry.target ?? "", ...detailValues(entry)]) {
        if (XRAY_ID_PATTERN.test(value)) {
          expect(populationIds.has(value), `${entry.id}: unknown row ${value}`).toBe(true);
        }
      }

      // 4. A row-level entry names a DRAWN row, assigned to the person the entry
      //    holds responsible for it.
      if (ROW_TARGET_ACTIONS.has(entry.action)) {
        const row = entry.target ?? "";
        expect(sampleIds.has(row), `${entry.id}: ${row} is not in the sample`).toBe(true);
        // Who the entry says holds the row: the assignee an on-behalf answer was
        // written for, the employee an oversight action was taken against, the
        // `to` side of a reassignment — else the actor acting on their own row.
        const owner = String(
          entry.details?.assignee ?? entry.details?.employee ?? entry.details?.to ?? entry.actor
        );
        expect(assignedTo.get(row), `${entry.id}: ${row} owner`).toBe(owner);
      }

      // 5. `answer-submitted` is the strongest claim in the log — that this
      //    person submitted this answer — so it is checked against the answer
      //    file itself, not merely against the assignment.
      if (entry.action === "answer-submitted") {
        expect(
          submittedBy.get(entry.actor)?.has(entry.target ?? ""),
          `${entry.id}: no submitted answer for ${entry.target} by ${entry.actor}`
        ).toBe(true);
      }

      // 6. Every username-bearing detail, and the subject of every user action,
      //    is a real account — or one of the two subjects the log itself records
      //    as removed.
      for (const key of USERNAME_DETAIL_KEYS) {
        const value = entry.details?.[key];
        if (typeof value === "string") {
          expect(knownNames.has(value), `${entry.id}: unknown user ${value} in ${key}`).toBe(true);
        }
      }
      if (entry.action.startsWith("user-")) {
        expect(knownNames.has(entry.target ?? ""), `${entry.id}: unknown user target`).toBe(true);
      }
    }

    // The retired subjects really are absent — otherwise rule 6 would be
    // permitting names that are simply in the roster after all.
    for (const subject of SIM_ACTION_RETIRED_SUBJECTS) {
      expect(roster.has(subject)).toBe(false);
    }
    expect(await loadTemplate(handle, "sim-inspection-template-legacy")).toBeNull();
  });

  it("writes an identical action log on every build", async () => {
    const [first, second] = await Promise.all([
      createSimulatedWorkspace(),
      createSimulatedWorkspace(),
    ]);

    const a = await readWorkspaceActions(first);
    const b = await readWorkspaceActions(second);
    // Whole entries, ids and timestamps included: unlike the distribution event
    // ids (UUIDs from the real writer) nothing here is allowed to vary, which is
    // the reason the entries are built rather than appended. See simActionLog.ts.
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
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
