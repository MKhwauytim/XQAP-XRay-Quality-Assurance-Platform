import { describe, expect, it } from "vitest";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { RestoreScope } from "./restoreScope";
import { planSelectiveRestore } from "./selectiveRestore";
import {
  distEvent,
  M1,
  makeRoot,
  ndjson,
  seedBackup,
  TEST_BACKUP,
  writeJsonAt,
  writeRawAt,
} from "./selectiveRestoreTestKit";

function plan(root: DirectoryHandleLike, scope: RestoreScope, backupFolderName = TEST_BACKUP) {
  return planSelectiveRestore({ directoryHandle: root, backupFolderName, scope });
}

async function seedLiveMonth(
  root: DirectoryHandleLike,
  options: { withDistribution: boolean; replacedRowIds?: string[] }
): Promise<void> {
  await writeJsonAt(root, `2-samples/${M1}/1-main/sample.master.json`, {
    rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }],
    ...(options.replacedRowIds ? { replacedRowIds: options.replacedRowIds } : {}),
  });
  if (options.withDistribution) {
    await writeRawAt(root, `2-samples/${M1}/1-main/distribution.events/devA-s1.ndjson`, ndjson([distEvent("e01", "A")]));
  }
}

const POP_M1 = `1-population/${M1}/2-processed/population.final.json`;

describe("planSelectiveRestore — population coverage (A2 rule)", () => {
  it("blocks a population restore that would orphan a live sampled id in a distributed month", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: true });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const result = await plan(root, { elements: ["population"], months: [M1] });

    expect(result.blocked).toEqual([{ month: M1, sampledCount: 2, missingCount: 1, missingExamples: ["B"] }]);
    expect(result.canConfirm).toBe(false);
  });

  it("allows it when the backup population is a superset of the live sample", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: true });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }, { xrayImageId: "B" }, { xrayImageId: "C" }] } });

    const result = await plan(root, { elements: ["population"], months: [M1] });

    expect(result.blocked).toEqual([]);
    expect(result.canConfirm).toBe(true);
  });

  it("does not apply the rule to a month with no distribution and no answers", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: false });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const result = await plan(root, { elements: ["population"], months: [M1] });

    expect(result.blocked).toEqual([]);
    expect(result.canConfirm).toBe(true);
  });

  it("checks against the backup's own sample when Sample & distribution is restored in the same scope", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: true });
    await seedBackup(root, {
      [POP_M1]: { rows: [{ xrayImageId: "A" }] },
      [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [{ xrayImageId: "A" }] },
    });

    const result = await plan(root, { elements: ["population", "sampleDistribution"], months: [M1] });

    expect(result.blocked).toEqual([]);
  });

  it("treats replaced (retired) sample rows as not live", async () => {
    const root = makeRoot();
    await seedLiveMonth(root, { withDistribution: true, replacedRowIds: ["B"] });
    await seedBackup(root, { [POP_M1]: { rows: [{ xrayImageId: "A" }] } });

    const result = await plan(root, { elements: ["population"], months: [M1] });

    expect(result.blocked).toEqual([]);
  });
});

describe("planSelectiveRestore — selections and warnings", () => {
  it("reports a selected element the backup does not contain and disables confirm", async () => {
    const root = makeRoot();
    await seedBackup(root, { [POP_M1]: { rows: [] } });

    const result = await plan(root, { elements: ["population", "templates"], months: [M1] });

    expect(result.selections).toEqual([
      { element: "population", month: M1, fileCount: 1 },
      { element: "templates", month: null, fileCount: 0 },
    ]);
    expect(result.selectedFileCount).toBe(1);
    expect(result.emptySelections).toEqual([{ element: "templates", month: null }]);
    expect(result.canConfirm).toBe(false);
  });

  it("warns when Sample & distribution is restored without Answers, and vice versa", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [`2-samples/${M1}/1-main/sample.master.json`]: { rows: [] },
      [`2-samples/${M1}/2-employees/employee01.answers.json`]: { items: [] },
    });

    const sampleOnly = await plan(root, { elements: ["sampleDistribution"], months: [M1] });
    expect(sampleOnly.warnings).toEqual([{ kind: "sample-without-answers", month: M1 }]);
    expect(sampleOnly.canConfirm).toBe(true);

    const answersOnly = await plan(root, { elements: ["answers"], months: [M1] });
    expect(answersOnly.warnings).toEqual([{ kind: "answers-without-sample", month: M1 }]);

    const both = await plan(root, { elements: ["sampleDistribution", "answers"], months: [M1] });
    expect(both.warnings).toEqual([]);
  });

  it("returns the scope problem without opening the backup for an unusable scope", async () => {
    const root = makeRoot();

    const result = await plan(root, { elements: [], months: [] }, "no-such-backup");

    expect(result.invalidReason).toBe("no-elements");
    expect(result.canConfirm).toBe(false);
  });
});

describe("planSelectiveRestore — legacy answer files that embed request queues", () => {
  const LEGACY_ANSWERS = `2-samples/${M1}/2-employees/employee01.answers.json`;
  const embedding = { items: [], referralRequests: [{ requestId: "r1" }] };

  it("warns that Answers alone also restores the embedded queues", async () => {
    const root = makeRoot();
    await seedBackup(root, { [LEGACY_ANSWERS]: embedding });

    const result = await plan(root, { elements: ["answers"], months: [M1] });

    expect(result.warnings).toContainEqual({ kind: "answers-restore-embedded-requests", month: M1 });
  });

  it("warns that Referrals alone cannot reach queues that live inside the answers files", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [LEGACY_ANSWERS]: embedding,
      [`2-samples/${M1}/2-employees/employee02.requests.json`]: { referralRequests: [] },
    });

    const result = await plan(root, { elements: ["referralsApprovals"], months: [M1] });

    expect(result.warnings).toContainEqual({ kind: "requests-embedded-in-answers", month: M1 });
  });

  it("stays quiet when both are selected, or the answers file embeds nothing", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      [LEGACY_ANSWERS]: embedding,
      [`2-samples/${M1}/2-employees/employee01.requests.json`]: { referralRequests: [] },
    });
    const both = await plan(root, { elements: ["answers", "referralsApprovals"], months: [M1] });
    expect(both.warnings.map((warning) => warning.kind)).toEqual(["answers-without-sample"]);

    const clean = makeRoot();
    await seedBackup(clean, { [LEGACY_ANSWERS]: { items: [], referralRequests: [] } });
    const answersOnly = await plan(clean, { elements: ["answers"], months: [M1] });
    expect(answersOnly.warnings.map((warning) => warning.kind)).toEqual(["answers-without-sample"]);
  });
});

describe("planSelectiveRestore — month folder casing", () => {
  it("finds the backup's population when the scope month differs only in case", async () => {
    const root = makeRoot();
    await seedBackup(root, {
      "1-population/5-May-2026/2-processed/population.final.json": { rows: [{ xrayImageId: "A" }] },
    });

    const result = await plan(root, { elements: ["population"], months: ["5-may-2026"] });

    expect(result.selections).toEqual([{ element: "population", month: "5-may-2026", fileCount: 1 }]);
    expect(result.emptySelections).toEqual([]);
    expect(result.canConfirm).toBe(true);
  });
});
