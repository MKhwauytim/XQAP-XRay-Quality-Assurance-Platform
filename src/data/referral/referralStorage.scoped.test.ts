import { describe, expect, it } from "vitest";
import type { EmployeeAnswerFile } from "../answers/answerTypes";
import { clearReadLog, createMemoryDirectory, getReadLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeWriteJson } from "../storage/safeWrite";
import { getSampleEmployeeDir } from "../workspace/workspacePaths";
import type { ReferralRequest } from "./referralTypes";
import { loadRequestLogs } from "./referralStorage";

const MONTH = "5-May-2026";

const referral = (username: string, requestId: string): ReferralRequest => ({
  requestId,
  monthFolderName: MONTH,
  fromEmployee: username,
  toEmployee: "someone-else",
  xrayImageIds: [`X-${username}`],
  reason: "test",
  requestedAt: "2026-05-02T00:00:00.000Z",
  requestedBy: username,
  status: "pending",
});

const reqFile = (username: string) => ({
  username,
  monthFolderName: MONTH,
  revision: 1,
  referralRequests: [referral(username, `r-${username}`)],
  replacementRequests: [],
  reopenRequests: [],
});

describe("loadRequestLogs scoped to one user", () => {
  it("opens only that user's requests file", async () => {
    const root = createMemoryDirectory("scoped", { trackReads: true }) as unknown as DirectoryHandleLike;
    const dir = await getSampleEmployeeDir(root, MONTH, true);
    for (const u of ["emp1", "emp2", "emp3"]) await safeWriteJson(dir, `${u}.requests.json`, reqFile(u));
    clearReadLog(root);
    const scoped = await loadRequestLogs(root, MONTH, { scopeToUser: "emp2" });
    expect(scoped.referrals.requests.map((r) => r.requestId)).toEqual(["r-emp2"]);
    const opened = getReadLog(root).filter((p) => p.endsWith(".requests.json"));
    expect(opened.length).toBeGreaterThan(0);
    expect(opened.every((p) => p.endsWith("emp2.requests.json"))).toBe(true);
  });

  it("falls back to legacy {user}.answers.json when no requests file exists", async () => {
    const root = createMemoryDirectory("scoped-legacy", { trackReads: true }) as unknown as DirectoryHandleLike;
    const dir = await getSampleEmployeeDir(root, MONTH, true);
    const legacy = {
      username: "emp9",
      monthFolderName: MONTH,
      revision: 1,
      items: [],
      referralRequests: [referral("emp9", "r-legacy")],
      replacementRequests: [],
      reopenRequests: [],
    } satisfies EmployeeAnswerFile;
    await safeWriteJson(dir, "emp9.answers.json", legacy);
    const scoped = await loadRequestLogs(root, MONTH, { scopeToUser: "emp9" });
    expect(scoped.referrals.requests.map((r) => r.requestId)).toEqual(["r-legacy"]);

    // Same epoch: the legacy file is frozen and memoised, so a second load must not re-read it.
    clearReadLog(root);
    const again = await loadRequestLogs(root, MONTH, { scopeToUser: "emp9" });
    expect(again.referrals.requests.map((r) => r.requestId)).toEqual(["r-legacy"]);
    expect(getReadLog(root).filter((p) => p.endsWith("emp9.answers.json"))).toEqual([]);
  });

  it("yields an empty log for a user with no files", async () => {
    const root = createMemoryDirectory("scoped-none") as unknown as DirectoryHandleLike;
    const scoped = await loadRequestLogs(root, MONTH, { scopeToUser: "nobody" });
    expect(scoped.referrals.requests).toEqual([]);
  });

  it("treats a corrupt own requests file as empty instead of rejecting", async () => {
    const root = createMemoryDirectory("scoped-corrupt") as unknown as DirectoryHandleLike;
    const dir = await getSampleEmployeeDir(root, MONTH, true);
    const handle = await dir.getFileHandle("emp5.requests.json", { create: true });
    const writable = await handle.createWritable!();
    await writable.write("{not json");
    await writable.close();
    const scoped = await loadRequestLogs(root, MONTH, { scopeToUser: "emp5" });
    expect(scoped.referrals.requests).toEqual([]);
    expect(scoped.replacements.requests).toEqual([]);
    expect(scoped.reopens.requests).toEqual([]);
  });
});
