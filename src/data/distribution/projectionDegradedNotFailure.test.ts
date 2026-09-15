// Production 2026-09-10..14 (Z:\ SMB share, ~4 concurrent file:// clients):
// `casLoop:exhausted(distribution:events) [XQ-IO-036]` paired with
// `reopen:request-event`, and users reporting that طلب استبدال ALWAYS fails —
// deterministically, not intermittently.
//
// The trap is an ordering one, not a contention one. `appendDistributionEvents`
// commits the immutable `distribution.events/{eventId}.json` files FIRST (the
// source of truth), and only then updates `distribution.log.json`. That log is
// a legacy COMPATIBILITY PROJECTION and `distribution.current.json` a
// rebuildable cache — both are derivable from the events at any time; CLAUDE.md
// and this module's own comments say so.
//
// But when the projection's casLoop exhausted, the whole call returned
// `{ ok: false }`. Two things followed, and together they made the failure
// permanent:
//
//  1. `executeReplacement` early-returns XQ-DIST-005 on that `ok: false`, which
//     SKIPS `refreshDistributionCacheAfterWrite` — so the derived cache is
//     never rebuilt from the events that ARE durable, and the UI keeps showing
//     the dead row as live, inviting a retry.
//  2. On that retry the fold now sees the durable `assigned` event, so
//     `classifyReplacementRowAvailability` reports "taken" and the dead row
//     folds to `status: "replaced"` — so the freshness guard rejects the retry
//     before doing any work. Every subsequent attempt fails identically and
//     instantly.
//
// The substitution had in fact been committed. The user was told it failed, and
// then forbidden from retrying it.
//
// A rebuildable projection failing to update is a DEGRADED SUCCESS, not a failed
// append. These tests pin that: the durable events survive, the caller is told
// ok, and the degradation is reported (so it is visible in the error log and the
// cache refresh still runs) rather than being silently swallowed.

import { describe, it, expect, beforeEach } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { clearErrors, getRecentErrors } from "../storage/errorLogger";
import { appendDistributionEvents, loadDistributionLog } from "./distributionStorage";
import { buildAssignEvent } from "./distributionLog";

const MONTH = "5-May-2026";

let root: DirectoryHandleLike;

beforeEach(() => {
  clearErrors();
});

/**
 * A share on which the immutable event files commit normally but every write of
 * the projection file fails — the production shape, where the per-event files
 * are distinct per writer and only `distribution.log.json` is contended by all
 * four machines at once.
 */
function shareWithUnwritableProjection(): DirectoryHandleLike {
  return createMemoryDirectory("root", {
    faults: [
      {
        operation: "createWritable",
        name: "distribution.log.json",
        errorName: "InvalidStateError",
        times: Number.POSITIVE_INFINITY,
      },
    ],
  });
}

describe("appendDistributionEvents — a failed projection write is not a failed append", () => {
  it("reports ok when the events are durable but the projection CAS exhausted", async () => {
    root = shareWithUnwritableProjection();

    const result = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({
        xrayImageId: "XR-0001",
        assignedTo: "employee1",
        eventBy: "admin",
      }),
    ]);

    // Pre-fix this was { ok: false, error: <XQ-IO-036 sentence> }, which is what
    // turned a committed substitution into a permanent "استبدال failed".
    expect(result.ok).toBe(true);
  });

  it("flags the degradation so the caller can rebuild the cache and the log records it", async () => {
    root = shareWithUnwritableProjection();

    const result = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({
        xrayImageId: "XR-0002",
        assignedTo: "employee1",
        eventBy: "admin",
      }),
    ]);

    expect(result.ok).toBe(true);
    // Degraded, not silent: the caller needs this to know the projection is
    // behind, and it must be in the durable error log for the admin export.
    expect(result.ok && result.projectionDegraded).toBe(true);
    expect(
      getRecentErrors().some((entry) =>
        entry.context.includes("distribution:projection-degraded")
      )
    ).toBe(true);
  });

  it("keeps the appended event durable and readable despite the projection failure", async () => {
    root = shareWithUnwritableProjection();

    await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({
        xrayImageId: "XR-0003",
        assignedTo: "employee1",
        eventBy: "admin",
      }),
    ]);

    // The fold reads the immutable events, so the assignment is visible even
    // though the projection file was never rewritten. This is what makes
    // returning ok correct rather than merely convenient.
    const log = await loadDistributionLog(root, MONTH);
    expect(log.events.some((event) => event.xrayImageId === "XR-0003")).toBe(true);
  });

  it("still reports failure when the DURABLE event write itself fails", async () => {
    // The guard on the change above: only the rebuildable projection is
    // downgraded to a warning. If the source of truth cannot be written there is
    // nothing to rebuild from, and the caller must still see a hard failure.
    root = createMemoryDirectory("root", {
      faults: [
        {
          operation: "createWritable",
          nameSuffix: ".ndjson",
          errorName: "NotAllowedError",
          times: Number.POSITIVE_INFINITY,
        },
      ],
    });

    const result = await appendDistributionEvents(root, MONTH, [
      buildAssignEvent({
        xrayImageId: "XR-0004",
        assignedTo: "employee1",
        eventBy: "admin",
      }),
    ]);

    expect(result.ok).toBe(false);
  });
});
