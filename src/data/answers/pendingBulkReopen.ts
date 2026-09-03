/**
 * Bulk "إعادة فتح كل المعلقة" for the معلقة (pending / no-image) queue — see
 * `data/population/pendingCorrections.ts` for the full export/import/reopen
 * design.
 *
 * Deliberately recomputes "is this item still معلقة right now" from the
 * CALLER-SUPPLIED, freshly-loaded `entries`/`answersMap`/`template` rather
 * than trusting any earlier snapshot or a stale selection: this action is
 * explicit and separate from the corrections import (an import that fixes
 * data must never silently reopen items the reviewer wasn't ready to have
 * reopened), and by the time the user clicks "reopen all" the queue may have
 * moved (someone else already reopened/completed/reassigned a row).
 */

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type { DistributionEntry } from "../distribution/distributionTypes";
import type { TemplateSchema } from "../templates/templateTypes";
import { reopenSubmittedAnswer } from "./reopenAnswer";
import { isPendingReferralEntry } from "../population/pendingCorrections";
import { appendWorkspaceAction } from "../audit/actionLog";
import type { ItemAnswer } from "./answerTypes";

export type BulkReopenOutcome = {
  xrayImageId: string;
} & ({ ok: true } | { ok: false; error: string });

export type BulkReopenResult = {
  attempted: number;
  succeeded: number;
  failed: BulkReopenOutcome[];
};

export async function bulkReopenPendingItems(params: {
  directoryHandle: DirectoryHandleLike;
  monthFolderName: string;
  entries: readonly DistributionEntry[];
  answersMap: ReadonlyMap<string, ItemAnswer>;
  template: TemplateSchema | null;
  /** Optional: every template actually referenced by a loaded answer — see
   *  `isPendingReferralEntry`'s own doc comment for why this matters. */
  templatesById?: ReadonlyMap<string, TemplateSchema>;
  reopenedBy: string;
  reopenedByRole: string;
  reason: string;
}): Promise<BulkReopenResult> {
  const {
    directoryHandle, monthFolderName, entries, answersMap, template, templatesById,
    reopenedBy, reopenedByRole, reason,
  } = params;

  const pending = entries.filter((entry) => isPendingReferralEntry(entry, answersMap, template, templatesById));

  const outcomes: BulkReopenOutcome[] = [];
  // Sequential, not Promise.all: each reopen is its own casLoop write against a
  // per-employee answers file plus a shared distribution-event append —
  // running many concurrently multiplies lock contention for no benefit here
  // (the bulk action is a one-off UI click, not a throughput-sensitive path).
  for (const entry of pending) {
    try {
      const result = await reopenSubmittedAnswer({
        directoryHandle,
        monthFolderName,
        employeeUsername: entry.assignedTo,
        xrayImageId: entry.xrayImageId,
        reopenedBy,
        reopenedByRole,
        reason,
      });
      if (result.ok) {
        outcomes.push({ xrayImageId: entry.xrayImageId, ok: true });
        // Additional to the "answer-reopened" entry reopenSubmittedAnswer
        // already writes for the state transition itself — this one marks
        // that it happened via THIS bulk workflow, individually per id.
        // Awaited (not fire-and-forget): every id in this loop writes to the
        // SAME per-actor audit file, so leaving it unawaited would let two
        // iterations race each other's casLoop read-modify-write.
        await appendWorkspaceAction(directoryHandle, {
          actor: reopenedBy,
          actorRole: reopenedByRole,
          action: "pending-bulk-reopened",
          monthFolderName,
          target: entry.xrayImageId,
          details: { employee: entry.assignedTo },
        });
      } else {
        outcomes.push({ xrayImageId: entry.xrayImageId, ok: false, error: result.error });
      }
    } catch (error) {
      outcomes.push({
        xrayImageId: entry.xrayImageId,
        ok: false,
        error: error instanceof Error ? error.message : "خطأ غير معروف",
      });
    }
  }

  return {
    attempted: outcomes.length,
    succeeded: outcomes.filter((o) => o.ok).length,
    failed: outcomes.filter((o): o is BulkReopenOutcome & { ok: false; error: string } => !o.ok),
  };
}
