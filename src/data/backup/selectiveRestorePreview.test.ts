import { describe, expect, it } from "vitest";

import {
  compareMonthFolderNames,
  countPreviewFiles,
  previewSelectiveRestore,
} from "./selectiveRestore";
import { distEvent, M1, M2, makeRoot, ndjson, seedBackup, TEST_BACKUP } from "./selectiveRestoreTestKit";

describe("compareMonthFolderNames", () => {
  it("orders real months chronologically and anything else after them by name", () => {
    expect(["adhoc-b", "6-june-2026", "12-december-2025", "adhoc-a", "5-may-2026"].sort(compareMonthFolderNames)).toEqual([
      "12-december-2025",
      "5-may-2026",
      "6-june-2026",
      "adhoc-a",
      "adhoc-b",
    ]);
  });
});

describe("previewSelectiveRestore", () => {
  it("counts restorable files per element × month, leaving out derived and non-payload files", async () => {
    const root = makeRoot();
    await seedBackup(
      root,
      {
        "1-population/config.json": {},
        [`1-population/${M1}/month.manifest.json`]: {},
        [`1-population/${M1}/2-processed/population.final.json`]: { rows: [] },
        [`1-population/${M1}/2-processed/population.aggregate.json`]: {},
        [`1-population/${M1}/2-processed/replacement-index/index.manifest.json`]: {},
        [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [] },
        [`2-samples/${M1}/1-main/distribution.current.json`]: {},
        [`2-samples/${M1}/2-employees/employee01.answers.json`]: {},
        [`2-samples/${M1}/2-employees/employee01.requests.json`]: {},
        [`2-samples/${M1}/2-employees/employee01.samples.json`]: {},
        [`2-samples/${M1}/3-approvals/sup01.decisions.json`]: {},
        [`Population/${M2}/processed/population.final.json`]: { rows: [] },
        "2-samples/adhoc-imp1/1-main/sample.master.json": { rows: [] },
        "6-templates/templates.index.json": {},
        "3-user-data/users.permissions.json": {},
        "5-system/feedback/threads/t1.json": {},
        "5-system/notifications/notifications.json": {},
        "5-system/audit/actions/admin.actions.json": {},
      },
      {
        [`2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`]: ndjson([distEvent("e01")]),
        [`2-samples/${M1}/1-main/answers.events/devA-s1.ndjson`]: ndjson([{ eventId: "a01" }]),
        [`2-samples/${M1}/1-main/sample.master.json.bak`]: "{}",
      }
    );

    const preview = await previewSelectiveRestore(root, TEST_BACKUP);

    expect(preview.backupFolderName).toBe(TEST_BACKUP);
    expect(preview.months).toEqual([M1, M2, "adhoc-imp1"]);
    expect(countPreviewFiles(preview, "population", M1)).toBe(2);
    expect(countPreviewFiles(preview, "population", M2)).toBe(1);
    expect(countPreviewFiles(preview, "sampleDistribution", M1)).toBe(2);
    expect(countPreviewFiles(preview, "sampleDistribution", "adhoc-imp1")).toBe(1);
    expect(countPreviewFiles(preview, "answers", M1)).toBe(2);
    expect(countPreviewFiles(preview, "referralsApprovals", M1)).toBe(2);
    expect(countPreviewFiles(preview, "populationSettings", null)).toBe(1);
    expect(countPreviewFiles(preview, "templates", null)).toBe(1);
    expect(countPreviewFiles(preview, "usersPermissions", null)).toBe(1);
    expect(countPreviewFiles(preview, "feedback", null)).toBe(1);
    expect(countPreviewFiles(preview, "systemSettings", null)).toBe(1);
    expect(countPreviewFiles(preview, "reportDesigns", null)).toBe(0);
    expect(preview.unclassifiedCount).toBe(1);
  });

  it("refuses an interrupted backup exactly as the restore does", async () => {
    const root = makeRoot();
    await seedBackup(root, { "6-templates/templates.index.json": {} }, {}, { complete: false });

    await expect(previewSelectiveRestore(root, TEST_BACKUP)).rejects.toThrow(/غير مكتملة/);
  });
});

describe("previewSelectiveRestore — month folder casing", () => {
  it("lists a month once, under the backup's own folder name", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      "1-population/5-May-2026/2-processed/population.final.json": { rows: [] },
      "2-samples/5-may-2026/1-main/sample.master.json": { rows: [] },
    });

    const preview = await previewSelectiveRestore(root, TEST_BACKUP);

    expect(preview.months).toEqual(["5-May-2026"]);
    expect(countPreviewFiles(preview, "population", "5-may-2026")).toBe(1);
    expect(countPreviewFiles(preview, "sampleDistribution", "5-May-2026")).toBe(1);
  });
});
