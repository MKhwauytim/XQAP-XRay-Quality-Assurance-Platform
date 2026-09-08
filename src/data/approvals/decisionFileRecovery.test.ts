// Recovery for a supervisor decision file that exists but cannot be read.
//
// The live case this was built for (production error log, 2026-08-31 → 09-08,
// 52 identical entries): `approvals:9-september-2026/malrogi:
// malrogi.decisions.json exists but could not be read (invalid envelope, and no
// usable .bak or .tmp)`. `appendDecisionEvent` re-reads that file as the base of
// its read-modify-write on every attempt, so the casLoop exhausts and the
// supervisor cannot record ANY approval decision for the month. The app is
// right to refuse — overwriting would destroy the B5 decision chain — but until
// now there was no way out of it.
//
// The safety property these tests exist to pin: a file that is merely
// TRANSIENTLY unreadable (the share not answering — 715 rows of exactly that in
// the same log) must never be archived or reset. Only a file the share DID
// serve, whose bytes are genuinely not valid content, is eligible.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getSampleApprovalsDir } from "../workspace/workspacePaths";
import { appendDecisionEvent, loadSupervisorDecisions } from "./approvalStorage";
import {
  inspectDecisionFile,
  inspectMonthDecisionFiles,
  recoverDecisionFile,
} from "./decisionFileRecovery";

const MONTH = "9-september-2026";
const SUP = "malrogi";
const FILE = "malrogi.decisions.json";

async function seedWithDecisions(root: DirectoryHandleLike, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const result = await appendDecisionEvent(root, MONTH, SUP, {
      requestId: `req-${i}`,
      kind: "referral",
      status: "approved",
      reviewedBy: SUP,
      reviewedAt: `2026-09-0${i + 1}T10:00:00.000Z`,
    });
    if (!result.ok) throw new Error(`seed ${i} failed: ${result.error}`);
  }
}

/**
 * Overwrite a file with raw bytes that are not valid content — deliberately NOT
 * through `safeWriteJsonText`, which validates and would refuse. This is what a
 * torn write or a damaged share actually leaves behind.
 */
async function writeRawBytes(
  root: DirectoryHandleLike,
  name: string,
  text: string
): Promise<void> {
  const dir = await getSampleApprovalsDir(root, MONTH, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

/** Replace the live file's bytes with something that is not valid content. */
async function corruptLiveFile(root: DirectoryHandleLike): Promise<void> {
  await writeRawBytes(root, FILE, "{ this is not json");
}

/** The same, for a sibling `.bak` / `.tmp`. */
async function corruptSibling(root: DirectoryHandleLike, suffix: string): Promise<void> {
  await writeRawBytes(root, `${FILE}${suffix}`, "{ also not json");
}

/**
 * The tree with the approvals directory answering every read with
 * `NotReadableError` — the share-outage shape, NOT a damaged file.
 * A proxy rather than `setSimulatedFaults` because `workspacePaths` caches
 * resolved directory handles per root object.
 */
function withUnreadableApprovals(root: DirectoryHandleLike): DirectoryHandleLike {
  const wrap = (dir: DirectoryHandleLike): DirectoryHandleLike =>
    ({
      ...dir,
      kind: "directory",
      name: dir.name,
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (dir.name === "3-approvals") {
          const error = new Error(`Simulated NotReadableError for "${name}".`);
          error.name = "NotReadableError";
          throw error;
        }
        return dir.getFileHandle(name, options);
      },
      getDirectoryHandle: async (name: string, options?: { create?: boolean }) =>
        wrap(await dir.getDirectoryHandle(name, options)),
    }) as DirectoryHandleLike;
  return wrap(root);
}

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
});

describe("inspectDecisionFile", () => {
  it("reports a healthy file as readable, with its decision count", async () => {
    await seedWithDecisions(root, 2);

    const report = await inspectDecisionFile(root, MONTH, SUP);
    expect(report.live.kind).toBe("readable");
    expect(report.live.kind === "readable" && report.live.decisionEvents).toBe(2);
    expect(report.blocked).toBe(false);
    expect(report.needsRepair).toBe(false);
    expect(report.chainBreakAt).toBeNull();
  });

  it("reports a month with no decisions at all as absent, not broken", async () => {
    const report = await inspectDecisionFile(root, MONTH, SUP);
    expect(report.live.kind).toBe("absent");
    expect(report.blocked).toBe(false);
    expect(report.recoverableFrom).toBeNull();
  });

  it("separates a damaged file a sibling is covering for from one that blocks", async () => {
    await seedWithDecisions(root, 3);
    await corruptLiveFile(root);

    const report = await inspectDecisionFile(root, MONTH, SUP);
    expect(report.live.kind).toBe("corrupt");
    expect(report.needsRepair).toBe(true);
    // safeWriteJson snapshots the previous contents to `.bak` before each write,
    // so `safeReadJson`'s ladder still answers and nothing is blocked YET — the
    // workspace is simply one lost `.bak` away from the production incident.
    expect(report.blocked).toBe(false);
    expect(report.recoverableFrom).toBe("bak");
    expect(report.bak.kind).toBe("readable");
  });

  it("reports the production shape — nothing readable anywhere", async () => {
    await seedWithDecisions(root, 1);
    await corruptLiveFile(root);
    await corruptSibling(root, ".bak");
    await corruptSibling(root, ".tmp");

    const report = await inspectDecisionFile(root, MONTH, SUP);
    expect(report.live.kind).toBe("corrupt");
    expect(report.needsRepair).toBe(true);
    expect(report.blocked).toBe(true);
    expect(report.recoverableFrom).toBeNull();
  });

  it("reports a share that is not answering as unavailable, never as corrupt", async () => {
    await seedWithDecisions(root, 1);

    const report = await inspectDecisionFile(withUnreadableApprovals(root), MONTH, SUP);
    expect(report.live.kind).toBe("unavailable");
    expect(report.blocked).toBe(true);
    expect(report.recoverableFrom).toBeNull();
  });
});

describe("recoverDecisionFile — scenario: the data still exists", () => {
  it("restores it from the readable copy and archives the damaged original", async () => {
    await seedWithDecisions(root, 3);
    await corruptLiveFile(root);

    const outcome = await recoverDecisionFile(root, MONTH, SUP, { allowReset: false });

    expect(outcome.kind).toBe("restored");
    expect(outcome.kind === "restored" && outcome.from).toBe("bak");
    // TWO, not three. `.bak` is the snapshot safeWriteJson took BEFORE the last
    // commit, so restoring from it gives back the previous committed state and
    // the most recent decision is not in it. That is the honest maximum
    // available — and precisely why the outcome reports the count and the
    // source, so an admin is told what they got rather than assuming it is
    // everything.
    expect(outcome.kind === "restored" && outcome.decisionEvents).toBe(2);

    const recovered = await loadSupervisorDecisions(root, MONTH, SUP);
    expect(recovered.decisionEvents).toHaveLength(2);

    // …and the supervisor can record decisions again.
    const appended = await appendDecisionEvent(root, MONTH, SUP, {
      requestId: "req-after", kind: "referral", status: "approved",
      reviewedBy: SUP, reviewedAt: "2026-09-09T10:00:00.000Z",
    });
    expect(appended.ok).toBe(true);
  });

  it("archives the damaged bytes rather than deleting them", async () => {
    await seedWithDecisions(root, 2);
    await corruptLiveFile(root);

    const outcome = await recoverDecisionFile(root, MONTH, SUP, { allowReset: false });
    expect(outcome.kind).toBe("restored");
    const archivedAs = outcome.kind === "restored" ? outcome.archivedAs : "";
    expect(archivedAs).toMatch(/^malrogi\.decisions\.json\.unreadable-/);

    const dir = await getSampleApprovalsDir(root, MONTH, true);
    const handle = await dir.getFileHandle(archivedAs, { create: false });
    const text = await (await handle.getFile()).text();
    expect(text).toContain("this is not json");
  });
});

describe("recoverDecisionFile — scenario: the data does not exist", () => {
  it("refuses to reset unless the caller explicitly opts in", async () => {
    await seedWithDecisions(root, 1);
    await corruptLiveFile(root);
    await corruptSibling(root, ".bak");
    await corruptSibling(root, ".tmp");

    const outcome = await recoverDecisionFile(root, MONTH, SUP, { allowReset: false });
    expect(outcome.kind).toBe("unrecoverable");

    // Nothing was touched — the damaged file is still exactly where it was.
    const report = await inspectDecisionFile(root, MONTH, SUP);
    expect(report.live.kind).toBe("corrupt");
    expect(report.blocked).toBe(true);
  });

  it("archives the unreadable file and starts a fresh chain when reset is authorised", async () => {
    await seedWithDecisions(root, 1);
    await corruptLiveFile(root);
    await corruptSibling(root, ".bak");
    await corruptSibling(root, ".tmp");

    const outcome = await recoverDecisionFile(root, MONTH, SUP, { allowReset: true });
    expect(outcome.kind).toBe("reset");
    const archivedAs = outcome.kind === "reset" ? outcome.archivedAs : "";
    expect(archivedAs).toMatch(/^malrogi\.decisions\.json\.unreadable-/);

    // The supervisor can record decisions again, on an empty chain.
    const recovered = await loadSupervisorDecisions(root, MONTH, SUP);
    expect(recovered.decisionEvents ?? []).toHaveLength(0);
    const appended = await appendDecisionEvent(root, MONTH, SUP, {
      requestId: "req-after", kind: "referral", status: "approved",
      reviewedBy: SUP, reviewedAt: "2026-09-09T10:00:00.000Z",
    });
    expect(appended.ok).toBe(true);

    // The unreadable original survives for manual recovery.
    const dir = await getSampleApprovalsDir(root, MONTH, true);
    const handle = await dir.getFileHandle(archivedAs, { create: false });
    expect(await (await handle.getFile()).text()).toContain("this is not json");
  });
});

describe("recoverDecisionFile — safety", () => {
  it("NEVER touches a file that is only transiently unreadable, even with reset authorised", async () => {
    await seedWithDecisions(root, 2);
    const flaky = withUnreadableApprovals(root);

    const outcome = await recoverDecisionFile(flaky, MONTH, SUP, { allowReset: true });
    expect(outcome.kind).toBe("unavailable");

    // The real tree is untouched: every decision is still there.
    const intact = await loadSupervisorDecisions(root, MONTH, SUP);
    expect(intact.decisionEvents).toHaveLength(2);
  });

  it("does nothing when the file reads fine", async () => {
    await seedWithDecisions(root, 2);
    const outcome = await recoverDecisionFile(root, MONTH, SUP, { allowReset: true });
    expect(outcome.kind).toBe("not-needed");
    expect((await loadSupervisorDecisions(root, MONTH, SUP)).decisionEvents).toHaveLength(2);
  });

  it("does nothing when the supervisor simply has no decision file yet", async () => {
    const outcome = await recoverDecisionFile(root, MONTH, SUP, { allowReset: true });
    expect(outcome.kind).toBe("not-needed");
  });
});

describe("inspectMonthDecisionFiles", () => {
  it("finds the damaged file without being told which supervisor it belongs to", async () => {
    await seedWithDecisions(root, 1);
    const healthy = await appendDecisionEvent(root, MONTH, "sup-ok", {
      requestId: "req-ok", kind: "referral", status: "approved",
      reviewedBy: "sup-ok", reviewedAt: "2026-09-01T10:00:00.000Z",
    });
    expect(healthy.ok).toBe(true);
    await corruptLiveFile(root);
    await corruptSibling(root, ".bak");
    await corruptSibling(root, ".tmp");

    const reports = await inspectMonthDecisionFiles(root, MONTH);
    expect(reports.map((r) => r.supervisorUsername)).toEqual([SUP, "sup-ok"]);
    // Blocked first — the one that needs doing is at the top.
    expect(reports[0].blocked).toBe(true);
    expect(reports[1].live.kind).toBe("readable");
  });

  it("returns an empty list for a month with no decision files", async () => {
    await expect(inspectMonthDecisionFiles(root, MONTH)).resolves.toEqual([]);
  });
});
