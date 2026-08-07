import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { loadOrDeriveDistributionCurrentForRead } from "../distribution/distributionStorage";
import type { DistributionEntry } from "../distribution/distributionTypes";
import { loadAdhocImportIndex } from "./adhocImportStorage";
import { adhocMonthFolderName } from "./adhocImportTypes";

/**
 * A `DistributionEntry` that was assigned through an ad-hoc import
 * (`src/data/adhocImport/`) rather than the real monthly sampling pipeline.
 * Structurally still a `DistributionEntry` — every existing consumer
 * (DataTable columns, accessors, filters) keeps working unchanged — with two
 * extra fields views can key a visual "this is not from the real population"
 * distinction off of (see `badge_adhoc_import` in labelsStore.ts).
 */
export type AdhocDistributionEntry = DistributionEntry & {
  adhocImportId: string;
  adhocFileName: string;
};

/**
 * Loads distribution entries for every ad-hoc import that has at least one
 * assignment (THE GAP fix, 2026-08): EmployeeWorkspace's real-month views only
 * ever read `sample.master.json` under the selected month's own folder, so an
 * ad-hoc assignment — durably written through the exact same
 * `buildAssignEvent`/`appendDistributionEvents` path, just against a synthetic
 * `2-samples/adhoc-{importId}/` "month" (see `adhocImportAssignment.ts`) — was
 * assigned but never rendered anywhere an employee could see it.
 *
 * Cost bound: the shared `adhoc-imports.index.json` (one small file) is read
 * first and is the ONLY unconditional read. Only imports whose index entry
 * already reports `assignedRows > 0` trigger a further read (their
 * `sample.master.json` + derived `distribution.current.json`) — an ad-hoc
 * import an admin uploaded but never assigned costs nothing here. There is no
 * independent polling/refetch trigger added: callers are expected to invoke
 * this from the same load path their existing `subscribeToDataRefresh`
 * listener already re-runs (the app's single invalidation authority — see
 * `src/data/query/queryRefreshBridge.ts`), not from a new timer.
 *
 * Degrades to `[]` on any failure (missing/corrupt index or per-import store)
 * — callers must still render the real month's own entries; this function
 * never throws.
 */
export async function loadAdhocEntriesForEmployeeView(
  directoryHandle: DirectoryHandleLike,
  username: string,
  canSeeAll: boolean
): Promise<AdhocDistributionEntry[]> {
  let index: Awaited<ReturnType<typeof loadAdhocImportIndex>>;
  try {
    index = await loadAdhocImportIndex(directoryHandle);
  } catch (error) {
    logError("adhocImportEmployeeView:loadIndex", error);
    return [];
  }

  const withAssignments = index.filter((entry) => entry.assignedRows > 0);
  if (withAssignments.length === 0) return [];

  const perImport = await Promise.all(
    withAssignments.map(async (indexEntry): Promise<AdhocDistributionEntry[]> => {
      try {
        const monthFolderName = adhocMonthFolderName(indexEntry.importId);
        const sample = await loadSampleMaster(directoryHandle, monthFolderName);
        const sampleRows = (sample?.rows ?? []) as PreparedPopulationRow[];
        if (sampleRows.length === 0) return [];

        const dist = await loadOrDeriveDistributionCurrentForRead(directoryHandle, monthFolderName, sampleRows);
        const entries = dist?.entries ?? [];
        // Personal-scope users only ever see rows assigned to them — same
        // scoping rule the real-month views apply to `distribution.current`.
        const scoped = canSeeAll ? entries : entries.filter((e) => e.assignedTo === username);

        return scoped.map((entry) => ({
          ...entry,
          adhocImportId: indexEntry.importId,
          adhocFileName: indexEntry.fileName,
        }));
      } catch (error) {
        // One corrupt/unreadable ad-hoc import must not blank out the others
        // or the real month's assignments — skip it and keep going.
        logError("adhocImportEmployeeView:loadImportEntries", error);
        return [];
      }
    })
  );

  return perImport.flat();
}
