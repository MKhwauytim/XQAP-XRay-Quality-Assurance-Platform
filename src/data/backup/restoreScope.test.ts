import { describe, expect, it } from "vitest";

import { getLabels } from "../labels/labelsStore";
import {
  classifyBackupPath,
  expandRestoreScope,
  isDirectoryInRestoreScope,
  isFileInRestoreScope,
  isMonthScopedElement,
  RESTORE_ELEMENT_IDS,
  RESTORE_ELEMENTS,
  validateRestoreScope,
  type BackupPathClass,
  type RestoreScope,
} from "./restoreScope";

const M1 = "5-may-2026";
const M2 = "6-june-2026";

function monthly(element: BackupPathClass["element"], month: string, derived = false): BackupPathClass {
  return { element, month, derived };
}

function wide(element: BackupPathClass["element"]): BackupPathClass {
  return { element, month: null, derived: false };
}

describe("RESTORE_ELEMENTS catalog", () => {
  it("lists every element id once, in catalog order, each with a non-empty Arabic label", () => {
    expect(RESTORE_ELEMENTS.map((element) => element.id)).toEqual([...RESTORE_ELEMENT_IDS]);
    const labels = getLabels();
    for (const element of RESTORE_ELEMENTS) {
      expect(labels[element.labelKey].trim().length).toBeGreaterThan(0);
    }
  });

  it("marks exactly the four per-month elements as month-scoped", () => {
    expect(RESTORE_ELEMENT_IDS.filter((id) => isMonthScopedElement(id))).toEqual([
      "population",
      "sampleDistribution",
      "answers",
      "referralsApprovals",
    ]);
  });
});

describe("classifyBackupPath — numbered layout", () => {
  const cases: Array<[string, BackupPathClass]> = [
    ["1-population/config.json", wide("populationSettings")],
    ["1-population/certscan.global.json", wide("populationSettings")],
    [`1-population/${M1}/month.manifest.json`, monthly("population", M1)],
    [`1-population/${M1}/1-raw/risk.raw.json`, monthly("population", M1)],
    [`1-population/${M1}/1-raw/risk.raw.2026-05-01T00-00-00.superseded.json`, monthly("population", M1)],
    [`1-population/${M1}/2-processed/population.final.json`, monthly("population", M1)],
    [`1-population/${M1}/2-processed/processing.summary.json`, monthly("population", M1)],
    [`1-population/${M1}/2-processed/population.aggregate.json`, monthly("population", M1, true)],
    [`1-population/${M1}/2-processed/replacement-index/index.manifest.json`, monthly("population", M1, true)],
    [`1-population/${M1}/2-processed/replacement-index/certscan.first.json`, monthly("population", M1, true)],
    [`2-samples/${M1}/1-main/sample.master.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/sampling.plan.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/distribution.log.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/distribution.events/evt-1.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/1-main/answers.events/devA-s1.ndjson`, monthly("answers", M1)],
    [`2-samples/${M1}/2-employees/employee01.answers.json`, monthly("answers", M1)],
    [`2-samples/${M1}/2-employees/employee01.requests.json`, monthly("referralsApprovals", M1)],
    [`2-samples/${M1}/2-employees/employee01.samples.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/2-employees/_index.json`, monthly("sampleDistribution", M1)],
    [`2-samples/${M1}/3-approvals/sup01.decisions.json`, monthly("referralsApprovals", M1)],
    ["2-samples/adhoc-imp1/1-main/sample.master.json", monthly("sampleDistribution", "adhoc-imp1")],
    ["3-user-data/users.permissions.json", wide("usersPermissions")],
    ["3-user-data/labels.snapshot.json", wide("usersPermissions")],
    ["4-reports/designs/designs.index.json", wide("reportDesigns")],
    ["6-templates/templates.index.json", wide("templates")],
    ["5-system/feedback/threads/t1.json", wide("feedback")],
    ["5-system/feedback/threads.index.json", wide("feedback")],
    ["5-system/notifications/notifications.json", wide("systemSettings")],
    ["5-system/user-presets/admin-shared.browse-preset.json", wide("systemSettings")],
    ["5-system/adhoc-imports/adhoc-imports.index.json", wide("systemSettings")],
    ["5-system/workspace.schema.json", wide("systemSettings")],
  ];

  it.each(cases)("%s", (path, expected) => {
    expect(classifyBackupPath(path)).toEqual(expected);
  });
});

describe("classifyBackupPath — legacy and mixed layouts", () => {
  const cases: Array<[string, BackupPathClass]> = [
    ["Population/config.json", wide("populationSettings")],
    [`Population/${M1}/month.manifest.json`, monthly("population", M1)],
    [`Population/${M1}/raw/risk.raw.json`, monthly("population", M1)],
    [`Population/${M1}/processed/population.final.json`, monthly("population", M1)],
    [`Population/${M1}/population.final.json`, monthly("population", M1)],
    [`Population/${M1}/sample/sample.master.json`, monthly("sampleDistribution", M1)],
    [`Population/${M1}/sample.master.json`, monthly("sampleDistribution", M1)],
    [`Population/${M1}/distribution.log.json`, monthly("sampleDistribution", M1)],
    [`Population/${M1}/distribution.events/evt-1.json`, monthly("sampleDistribution", M1)],
    [`Population/${M1}/employee-answers/employee01.answers.json`, monthly("answers", M1)],
    [`Population/${M1}/approvals/sup01.decisions.json`, monthly("referralsApprovals", M1)],
    ["templates/templates.index.json", wide("templates")],
    [".system/notifications/notifications.json", wide("systemSettings")],
    [".system/feedback/messages.json", wide("feedback")],
    ["feedback/messages.json", wide("feedback")],
  ];

  it.each(cases)("%s", (path, expected) => {
    expect(classifyBackupPath(path)).toEqual(expected);
  });
});

describe("classifyBackupPath — never restored selectively", () => {
  it.each([
    "5-system/audit/actions/admin.actions.json",
    "5-system/audit/actions.log.json",
    "5-system/system-errors/admin.errors.json",
    "5-system/locks/some.lock.json",
    "5-system/backups/old/backup.manifest.json",
    ".system/audit/activity.log.json",
    "5-system/restore.inprogress.json",
    "top-level.json",
    "unknown-root/x.json",
    "2-samples/stray.json",
    `2-samples/${M1}/stray.json`,
    `2-samples/${M1}/9-other/x.json`,
    `2-samples/${M1}/2-employees/notes.json`,
  ])("%s → null", (path) => {
    expect(classifyBackupPath(path)).toBeNull();
  });
});

describe("isFileInRestoreScope", () => {
  const populationM1: RestoreScope = { elements: ["population"], months: [M1] };

  it("selects only the chosen element for the chosen month", () => {
    expect(isFileInRestoreScope(`1-population/${M1}/2-processed/population.final.json`, populationM1)).toBe(true);
    expect(isFileInRestoreScope(`Population/${M1}/processed/population.final.json`, populationM1)).toBe(true);
    expect(isFileInRestoreScope(`1-population/${M2}/2-processed/population.final.json`, populationM1)).toBe(false);
    expect(isFileInRestoreScope(`2-samples/${M1}/1-main/sample.master.json`, populationM1)).toBe(false);
    expect(isFileInRestoreScope("1-population/config.json", populationM1)).toBe(false);
  });

  it("never selects a derived population artifact", () => {
    expect(isFileInRestoreScope(`1-population/${M1}/2-processed/population.aggregate.json`, populationM1)).toBe(false);
    expect(
      isFileInRestoreScope(`1-population/${M1}/2-processed/replacement-index/index.manifest.json`, populationM1)
    ).toBe(false);
  });

  it("ignores months for a workspace-wide element", () => {
    const templates: RestoreScope = { elements: ["templates"], months: [] };
    expect(isFileInRestoreScope("6-templates/templates.index.json", templates)).toBe(true);
    expect(isFileInRestoreScope("templates/templates.index.json", templates)).toBe(true);
  });

  it("selects nothing month-scoped when no month is chosen", () => {
    expect(
      isFileInRestoreScope(`1-population/${M1}/2-processed/population.final.json`, { elements: ["population"], months: [] })
    ).toBe(false);
  });
});

describe("isDirectoryInRestoreScope", () => {
  it("prunes everything a population-only scope cannot reach", () => {
    const scope: RestoreScope = { elements: ["population"], months: [M1] };
    expect(isDirectoryInRestoreScope("1-population", scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`1-population/${M1}`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`1-population/${M1}/2-processed`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`1-population/${M2}`, scope)).toBe(false);
    expect(isDirectoryInRestoreScope(`1-population/${M1}/2-processed/replacement-index`, scope)).toBe(false);
    expect(isDirectoryInRestoreScope("2-samples", scope)).toBe(false);
    expect(isDirectoryInRestoreScope(`Population/${M1}/sample`, scope)).toBe(false);
    expect(isDirectoryInRestoreScope("6-templates", scope)).toBe(false);
    expect(isDirectoryInRestoreScope("5-system", scope)).toBe(false);
  });

  it("keeps the sample and answer folders for a sample + answers scope", () => {
    const scope: RestoreScope = { elements: ["sampleDistribution", "answers"], months: [M1] };
    expect(isDirectoryInRestoreScope("2-samples", scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`2-samples/${M1}/1-main`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`2-samples/${M1}/1-main/answers.events`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`2-samples/${M1}/2-employees`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`2-samples/${M1}/3-approvals`, scope)).toBe(false);
    expect(isDirectoryInRestoreScope(`Population/${M1}/sample`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`Population/${M1}/employee-answers`, scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`Population/${M1}/approvals`, scope)).toBe(false);
  });

  it("walks only the feedback subtree for a feedback scope", () => {
    const scope: RestoreScope = { elements: ["feedback"], months: [] };
    expect(isDirectoryInRestoreScope("5-system", scope)).toBe(true);
    expect(isDirectoryInRestoreScope("5-system/feedback", scope)).toBe(true);
    expect(isDirectoryInRestoreScope("5-system/feedback/threads", scope)).toBe(true);
    expect(isDirectoryInRestoreScope("5-system/audit", scope)).toBe(false);
    expect(isDirectoryInRestoreScope("5-system/notifications", scope)).toBe(false);
    expect(isDirectoryInRestoreScope("feedback", scope)).toBe(true);
    expect(isDirectoryInRestoreScope("1-population", scope)).toBe(false);
  });

  it("enters the population root but no month folder for a population-settings scope", () => {
    const scope: RestoreScope = { elements: ["populationSettings"], months: [] };
    expect(isDirectoryInRestoreScope("1-population", scope)).toBe(true);
    expect(isDirectoryInRestoreScope(`1-population/${M1}`, scope)).toBe(false);
  });
});

describe("validateRestoreScope / expandRestoreScope", () => {
  it("names what is wrong with an unusable scope", () => {
    expect(validateRestoreScope({ elements: [], months: [M1] })).toBe("no-elements");
    expect(validateRestoreScope({ elements: ["population"], months: [] })).toBe("no-months");
    expect(
      validateRestoreScope({ elements: ["nope" as unknown as "population"], months: [M1] })
    ).toBe("unknown-element");
    expect(validateRestoreScope({ elements: ["templates"], months: [] })).toBeNull();
    expect(validateRestoreScope({ elements: ["population", "templates"], months: [M1] })).toBeNull();
  });

  it("expands a scope into catalog-ordered element × month cells", () => {
    expect(
      expandRestoreScope({ elements: ["templates", "answers", "population"], months: [M1, M2] })
    ).toEqual([
      { element: "population", month: M1 },
      { element: "population", month: M2 },
      { element: "answers", month: M1 },
      { element: "answers", month: M2 },
      { element: "templates", month: null },
    ]);
  });
});
