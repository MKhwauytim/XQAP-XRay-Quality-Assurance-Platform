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
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
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

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory("root", { trackOperations: true }) as unknown as DirectoryHandleLike;
  clearErrors();
});

describe("requests-file write: refused replace fails fast", () => {
  it("100% refused close() on the live file: XQ-IO-036 in well under 5 s, bounded ops, log names step and file", async () => {
    setSimulatedFaults(root, [
      { operation: "close", name: FILE, errorName: "InvalidStateError", times: Number.POSITIVE_INFINITY },
    ]);
    const t0 = Date.now();
    const res = await appendReferralToEmployee(root, MONTH, referral("r-1"));
    const elapsed = Date.now() - t0;

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain("XQ-IO-036");
    expect(elapsed).toBeLessThan(5000);
    // The refused target is not hammered: one short ladder (5 tries).
    const refusedCloses = getOperationLog(root).filter((o) => o.operation === "close" && o.name === FILE);
    expect(refusedCloses.length).toBeLessThanOrEqual(6);

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

  it("a refusal that outlasts the short ladder fails once, coded, and a retry after it clears succeeds", async () => {
    setSimulatedFaults(root, [{ operation: "close", name: FILE, errorName: "InvalidStateError", times: 7 }]);
    const first = await appendReferralToEmployee(root, MONTH, referral("r-4"));
    expect(first.ok).toBe(false);
    expect((first as { error: string }).error).toContain("XQ-IO-036");
    // The remaining refusals are consumed by the failed attempt's bounded ladder or by the retry.
    const second = await appendReferralToEmployee(root, MONTH, referral("r-4"));
    expect(second.ok).toBe(true);
    const file = await loadEmployeeAnswers(root, MONTH, USER);
    expect((file.referralRequests ?? []).filter((r) => r.requestId === "r-4")).toHaveLength(1);
  }, 20_000);

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
