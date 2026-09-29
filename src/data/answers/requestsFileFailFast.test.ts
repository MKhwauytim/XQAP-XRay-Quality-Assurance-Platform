// Q1 (D1 stage 1) — a REFUSED replace of `{user}.requests.json` must fail fast.
//
// Production: the supervisor's machine rewrites the SOURCE employee's whole
// requests file. When the share refuses the swap-to-target replace of that one
// file (held open elsewhere / no DELETE right), the write used to nest
// retryTransientWrite (5 tries) x 3 files inside casLoop (14 attempts) inside a
// 30 s deadline, and ended in XQ-IO-036 after ~32 s and ~490 operations.
// errorCodes.ts XQ-IO-036 says retrying the SAME target does not help.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults, getOperationLog } from "../storage/memoryDirectory";
import type { DirectoryHandleLike, FileHandleLike } from "../storage/fileSystemAccess";
import { registerDirectoryPath } from "../storage/webLocks";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { appendReferralToEmployee, loadEmployeeAnswers } from "./answerStorage";
import type { ReferralRequest } from "../referral/referralTypes";

const MONTH = "5-may-2026";
const USER = "emp1";
const FILE = `${USER}.requests.json`;

function referral(requestId: string): ReferralRequest {
  return {
    requestId,
    monthFolderName: MONTH,
    fromEmployee: USER,
    toEmployee: "emp2",
    xrayImageIds: ["X1", "X2"],
    reason: "x",
    requestedAt: "2026-05-02T00:00:00.000Z",
    requestedBy: "sup",
    status: "pending",
  };
}

/** Refuses `rate` of live requests.json close() calls (InvalidStateError), seeded. */
function flakyClose(dir: DirectoryHandleLike, rate: number, seed: number): DirectoryHandleLike {
  let state = seed >>> 0;
  const rand = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const wrapFile = (fh: FileHandleLike): FileHandleLike => {
    const out: FileHandleLike = { kind: "file", name: fh.name, getFile: () => fh.getFile() };
    if (fh.createWritable) {
      const cw = fh.createWritable.bind(fh);
      out.createWritable = async () => {
        const w = await cw();
        return {
          write: (d: string) => w.write(d),
          close: async () => {
            if (fh.name === FILE && rand() < rate) {
              const e = new Error("replace refused");
              e.name = "InvalidStateError";
              throw e;
            }
            await w.close();
          },
        };
      };
    }
    return out;
  };
  const wrapDir = (d: DirectoryHandleLike, path: string): DirectoryHandleLike => {
    const inner = d as DirectoryHandleLike & { values?: () => AsyncIterable<unknown> };
    const out = {
      kind: "directory" as const,
      name: d.name,
      getFileHandle: async (name: string, o?: { create?: boolean }) => wrapFile(await d.getFileHandle(name, o)),
      getDirectoryHandle: async (name: string, o?: { create?: boolean }) =>
        wrapDir(await d.getDirectoryHandle(name, o), `${path}/${name}`),
      removeEntry: (name: string, o?: { recursive?: boolean }) => d.removeEntry!(name, o),
      queryPermission: d.queryPermission?.bind(d),
      requestPermission: d.requestPermission?.bind(d),
      values: async function* () {
        for await (const entry of inner.values!()) {
          const e = entry as { kind: string; name: string };
          if (e.kind === "file") yield wrapFile(e as FileHandleLike);
          else if (e.kind === "directory") yield wrapDir(e as DirectoryHandleLike, `${path}/${e.name}`);
          else yield e;
        }
      },
    };
    registerDirectoryPath(out as DirectoryHandleLike, path);
    return out as DirectoryHandleLike;
  };
  return wrapDir(dir, `flaky${seed}`);
}

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory("root", { trackOperations: true }) as unknown as DirectoryHandleLike;
  clearErrors();
});

describe("requests-file write: refused replace fails fast", () => {
  it("100% refused close() on the live file: XQ-IO-036 in under 6 s, bounded ops, log names step and file", async () => {
    setSimulatedFaults(root, [
      { operation: "close", name: FILE, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);
    const t0 = Date.now();
    const res = await appendReferralToEmployee(root, MONTH, referral("r-1"));
    const elapsed = Date.now() - t0;

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain("XQ-IO-036");
    expect(elapsed).toBeLessThan(6000);
    // The refused target is not hammered: two short ladders (2 x 5 tries).
    const refusedCloses = getOperationLog(root).filter((o) => o.operation === "close" && o.name === FILE);
    expect(refusedCloses.length).toBeLessThanOrEqual(10);

    const entry = getRecentErrors().find((e) => e.context.startsWith("answerStorage:referral-request-append"));
    expect(entry).toBeDefined();
    expect(entry!.context).toContain("step=commit");
    expect(entry!.context).toContain(`file=${FILE}`);
    expect(entry!.errorCode).toBe("XQ-IO-036");
  }, 20_000);

  it("a brief refusal (a few closes) still succeeds, and the request lands once", async () => {
    setSimulatedFaults(root, [{ operation: "close", name: FILE, errorName: "InvalidStateError", times: 3 }]);
    const res = await appendReferralToEmployee(root, MONTH, referral("r-2"));
    expect(res.ok).toBe(true);
    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect((file.referralRequests ?? []).filter((r) => r.requestId === "r-2")).toHaveLength(1);
  }, 20_000);

  it("a burst that outlasts one ladder but clears in the second still succeeds", async () => {
    setSimulatedFaults(root, [{ operation: "close", name: FILE, errorName: "InvalidStateError", times: 7 }]);
    const res = await appendReferralToEmployee(root, MONTH, referral("r-4"));
    expect(res.ok).toBe(true);
    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect((file.referralRequests ?? []).filter((r) => r.requestId === "r-4")).toHaveLength(1);
  }, 20_000);

  it("a longer refusal fails once, coded, and a retry after it clears succeeds", async () => {
    setSimulatedFaults(root, [{ operation: "close", name: FILE, errorName: "InvalidStateError", times: 12 }]);
    const first = await appendReferralToEmployee(root, MONTH, referral("r-5"));
    expect(first.ok).toBe(false);
    expect((first as { error: string }).error).toContain("XQ-IO-036");
    setSimulatedFaults(root, []);
    expect((await appendReferralToEmployee(root, MONTH, referral("r-5"))).ok).toBe(true);
    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect((file.referralRequests ?? []).filter((r) => r.requestId === "r-5")).toHaveLength(1);
  }, 20_000);

  it("abortOn does not cut short a lock-contention (NoModificationAllowedError) failure of the live file", async () => {
    // 8 refusals of the live createWritable: the first attempt's ladder (5) fails
    // with a NON-refused-commit error, so casLoop must go on to a second attempt.
    setSimulatedFaults(root, [
      { operation: "createWritable", name: FILE, errorName: "NoModificationAllowedError", times: 8 },
    ]);
    const res = await appendReferralToEmployee(root, MONTH, referral("r-6"));
    expect(res.ok).toBe(true);
    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect((file.referralRequests ?? []).filter((r) => r.requestId === "r-6")).toHaveLength(1);
  }, 30_000);

  it("abortOn does not cut short an unreadable (NotReadableError) requests file", async () => {
    setSimulatedFaults(root, [
      { operation: "getFile", name: FILE, errorName: "NotReadableError", times: 14 },
    ]);
    const res = await appendReferralToEmployee(root, MONTH, referral("r-7"));
    expect(res.ok).toBe(true);
    setSimulatedFaults(root, []);
    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect((file.referralRequests ?? []).filter((r) => r.requestId === "r-7")).toHaveLength(1);
  }, 60_000);

  it.each([0.1, 0.2, 0.3])("seeded random %s commit refusal on the requests file always succeeds", async (rate) => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const dir = flakyClose(createMemoryDirectory("root") as unknown as DirectoryHandleLike, rate, seed);
      const id = `rnd-${rate}-${seed}`;
      const res = await appendReferralToEmployee(dir, MONTH, referral(id));
      expect(res.ok, `seed ${seed}`).toBe(true);
      const file = await loadEmployeeAnswers(dir, MONTH, USER);
      expect((file.referralRequests ?? []).filter((r) => r.requestId === id)).toHaveLength(1);
    }
  }, 120_000);

  it("retrying the same requestId after a failure never duplicates the request", async () => {
    setSimulatedFaults(root, [
      { operation: "close", name: FILE, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);
    const failed = await appendReferralToEmployee(root, MONTH, referral("r-3"));
    expect(failed.ok).toBe(false);

    setSimulatedFaults(root, []);
    expect((await appendReferralToEmployee(root, MONTH, referral("r-3"))).ok).toBe(true);
    expect((await appendReferralToEmployee(root, MONTH, referral("r-3"))).ok).toBe(true);
    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect((file.referralRequests ?? []).filter((r) => r.requestId === "r-3")).toHaveLength(1);
  }, 20_000);
});
