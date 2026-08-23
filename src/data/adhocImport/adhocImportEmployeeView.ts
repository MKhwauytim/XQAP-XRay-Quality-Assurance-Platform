import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { logError } from "../storage/errorLogger";
import type { PreparedPopulationRow } from "../population/populationTypes";
import { loadSampleMaster } from "../sampling/sampleStorage";
import { loadOrDeriveDistributionCurrentForRead } from "../distribution/distributionStorage";
import type { DistributionEntry } from "../distribution/distributionTypes";
import { loadEmployeeAnswers } from "../answers/answerStorage";
import type { ItemAnswer } from "../answers/answerTypes";
import type { AdhocIndexEntry } from "./adhocImportModel";
import { adhocMonthFolder, originalXrayImageId } from "./adhocImportModel";
import {
  adhocStoreHasDistributionEvents,
  listAdhocStoreImportIds,
  loadAdhocImportIndex,
} from "./adhocImportStorage";

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

/** True when this entry came from an ad-hoc import rather than the real pipeline. */
export function isAdhocEntry(
  entry: DistributionEntry,
): entry is AdhocDistributionEntry {
  return typeof (entry as Partial<AdhocDistributionEntry>).adhocImportId === "string";
}

/**
 * The id to SHOW for an entry, whatever kind of queue it is sitting in.
 *
 * An ad-hoc entry's `xrayImageId` is namespaced (`ADHOC-{importId}-…`) so it can
 * never collide with a real population row — a storage concern that had been
 * leaking into every table cell, panel header, export and aria-label, where it
 * read as a corrupted id and hid the real one off the right edge of the column.
 * This returns the operator's own id for an ad-hoc entry and the id itself for
 * every other entry, so one mixed queue renders consistently.
 *
 * Display only. Selection, answer keys, folder routing and every write still go
 * through `entry.xrayImageId` — the namespaced id remains the identity.
 */
export function displayXrayImageId(entry: DistributionEntry): string {
  return isAdhocEntry(entry)
    ? originalXrayImageId(entry.xrayImageId, entry.adhocImportId)
    : entry.xrayImageId;
}

/**
 * The workspace "month folder" that owns this entry's writes.
 *
 * Employee views render the union of the selected month's own entries and every
 * ad-hoc import's entries, but those two live in **different** stores:
 * `2-samples/{month}/` versus `2-samples/adhoc-{importId}/`. Every write for a
 * row — its answer, and any referral/replacement/reopen request — must land in
 * the store the row actually came from.
 *
 * Routing on the entry (rather than on the globally-selected month) is what
 * keeps that honest. Writing an ad-hoc row into the real month would contaminate
 * a genuine audit trail with rows from an unrelated population, and writing a
 * real row into an ad-hoc store would silently lose it. Both are worse than the
 * read-only state this replaces, so callers should resolve the folder through
 * here rather than reaching for `selMonth` directly.
 */
export function monthFolderForEntry(
  entry: DistributionEntry,
  selectedMonthFolder: string,
): string {
  return isAdhocEntry(entry) ? adhocMonthFolder(entry.adhocImportId) : selectedMonthFolder;
}

/**
 * One ad-hoc store a reader has to open, plus the display name to tag its rows
 * with. `fileName` falls back to the import id for a store the index cannot
 * describe — a label is worth having even when the bookkeeping is missing.
 */
type AdhocStoreTarget = { importId: string; fileName: string };

/**
 * The ad-hoc stores a view must open — the index's own answer, UNIONED with the
 * stores that actually exist on disk.
 *
 * The index half is unchanged and is still the fast path. `linkedMonths` is on
 * the INDEX precisely so a month-scoped read costs one small file: an import
 * bound to another month, or to none, is skipped without ever opening its
 * `sample.master.json` or its derived distribution cache. On a workspace with
 * dozens of historical study imports that is the difference between one file
 * read and dozens per month switch. Omitting `monthFolderName` keeps the
 * unscoped behavior exactly as it was — every import with assignments, isolated
 * ones included.
 *
 * The disk half is a repair path, and it is why `assignedRows > 0` is no longer
 * the sole gate. An assignment commits sample rows, then distribution events,
 * then the record that refreshes the index. The events are the durable part and
 * they land SECOND, so a failure on the third write leaves rows genuinely
 * assigned while the index still says `assignedRows: 0` — invisible to every
 * reader, and unrecoverable by retrying, because the retry finds its own events
 * already there and reports «كل الصفوف المحددة معيّنة بالفعل». Reading the
 * folder listing too means visibility follows what is on disk rather than a
 * counter a half-failed write can strand. See `listAdhocStoreImportIds`.
 *
 * The disk half never opens a store speculatively. Every save of an ad-hoc
 * record writes its `sample.master.json`, so a store folder existing proves
 * nothing; `adhocStoreHasDistributionEvents` is what separates "uploaded" from
 * "assigned", at one directory probe per candidate the index cannot vouch for.
 * An import an admin uploaded and never assigned therefore still costs nothing
 * beyond that probe.
 *
 * A store the index DOES describe as assigned, and the month filter then
 * excluded, stays excluded: month scoping is a deliberate decision and the
 * repair path must not quietly undo it. Only stores the index cannot vouch for
 * (`assignedRows: 0`, or no entry at all) are added back, because for those
 * "which month" has no trustworthy answer either and showing the work beats
 * losing it.
 */
async function storesToOpen(
  directoryHandle: DirectoryHandleLike,
  index: AdhocIndexEntry[],
  monthFolderName: string | undefined
): Promise<AdhocStoreTarget[]> {
  const byImportId = new Map(index.map((entry) => [entry.importId, entry]));
  const targets: AdhocStoreTarget[] = [];
  const taken = new Set<string>();

  for (const entry of index) {
    if (entry.assignedRows <= 0) continue;
    if (monthFolderName !== undefined && !(entry.linkedMonths ?? []).includes(monthFolderName)) {
      continue;
    }
    targets.push({ importId: entry.importId, fileName: entry.fileName });
    taken.add(entry.importId);
  }

  const candidates = (await listAdhocStoreImportIds(directoryHandle)).filter((importId) => {
    if (taken.has(importId)) return false;
    // Vouched for AND month-excluded above — leave it excluded.
    return (byImportId.get(importId)?.assignedRows ?? 0) <= 0;
  });
  const hasEvents = await Promise.all(
    candidates.map((importId) => adhocStoreHasDistributionEvents(directoryHandle, importId))
  );
  candidates.forEach((importId, index) => {
    if (!hasEvents[index]) return;
    targets.push({ importId, fileName: byImportId.get(importId)?.fileName ?? importId });
  });

  return targets;
}

/**
 * Loads distribution entries for every ad-hoc import that has at least one
 * assignment (THE GAP fix, 2026-08): EmployeeWorkspace's real-month views only
 * ever read `sample.master.json` under the selected month's own folder, so an
 * ad-hoc assignment — durably written through the exact same
 * `buildAssignEvent`/`appendDistributionEvents` path, just against a synthetic
 * `2-samples/adhoc-{importId}/` "month" (see `adhocDistributionBridge.ts`) — was
 * assigned but never rendered anywhere an employee could see it.
 *
 * Cost bound: the shared `adhoc-imports.index.json` (one small file) plus one
 * listing of `2-samples/` are the only unconditional reads. Only stores
 * `storesToOpen` returns trigger a further read (their `sample.master.json` +
 * derived `distribution.current.json`), and a store folder exists only because
 * an assignment attempt wrote sample rows into it — so an ad-hoc import an admin
 * uploaded but never assigned still costs nothing here. There is no
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
  canSeeAll: boolean,
  monthFolderName?: string
): Promise<AdhocDistributionEntry[]> {
  let index: Awaited<ReturnType<typeof loadAdhocImportIndex>>;
  try {
    index = await loadAdhocImportIndex(directoryHandle);
  } catch (error) {
    logError("adhocImportEmployeeView:loadIndex", error);
    return [];
  }

  const stores = await storesToOpen(directoryHandle, index, monthFolderName);
  if (stores.length === 0) return [];

  const perImport = await Promise.all(
    stores.map(async (indexEntry): Promise<AdhocDistributionEntry[]> => {
      try {
        const storeFolder = adhocMonthFolder(indexEntry.importId);
        const sample = await loadSampleMaster(directoryHandle, storeFolder);
        const sampleRows = (sample?.rows ?? []) as PreparedPopulationRow[];
        if (sampleRows.length === 0) return [];

        const dist = await loadOrDeriveDistributionCurrentForRead(directoryHandle, storeFolder, sampleRows);
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

/**
 * Every synthetic `2-samples/adhoc-{importId}/` folder that can hold employee
 * writes, i.e. one per ad-hoc import with at least one assignment.
 *
 * `listMonthFolders` cannot answer this: it enumerates `1-population/` and
 * keeps only `{m}-{MonthName}-{yyyy}`-shaped names, and an ad-hoc store is
 * neither. Any view that walks "every month folder" to find employee-authored
 * records — a referral/replacement/reopen request, an answer — has to walk
 * these too, or the records it wrote through `monthFolderForEntry` above are
 * durably stored somewhere nothing ever reads.
 *
 * Same cost bound and same fail-soft contract as
 * `loadAdhocEntriesForEmployeeView`: one small index read plus one `2-samples/`
 * listing, imports with no assignment attempt cost nothing further, and any
 * failure degrades to `[]` rather than throwing into a caller that must still
 * render the real months. The optional `monthFolderName` narrows the result to
 * imports LINKED to that month (see `storesToOpen`); omitting it lists every
 * import with assignments, as before.
 */
export async function listAdhocSampleFolders(
  directoryHandle: DirectoryHandleLike,
  monthFolderName?: string
): Promise<string[]> {
  try {
    const index = await loadAdhocImportIndex(directoryHandle);
    const stores = await storesToOpen(directoryHandle, index, monthFolderName);
    return stores.map((store) => adhocMonthFolder(store.importId));
  } catch (error) {
    logError("adhocImportEmployeeView:listAdhocSampleFolders", error);
    return [];
  }
}

/**
 * The saved answers for a set of ad-hoc entries, read from the store each entry
 * actually belongs to.
 *
 * `handleSave` routes an ad-hoc row's answer through `monthFolderForEntry`, so
 * it lands in `2-samples/adhoc-{importId}/2-employees/{user}.answers.json`.
 * Reading answers for the globally-selected month therefore never finds it: the
 * row rendered as unanswered after every reload, offered a blank, fully
 * editable form for work that was already submitted, and re-submitting
 * overwrote the stored item. Answers must be loaded per STORE, exactly as they
 * are written.
 *
 * Scoping is inherited from the entries handed in — `loadAdhocEntriesForEmployeeView`
 * has already filtered them to the caller's visibility — so this reads only the
 * `{assignedTo}.answers.json` files those entries name. Fail-soft per file: one
 * unreadable ad-hoc store must not blank out the rest, nor the real month's answers.
 */
export async function loadAdhocAnswerItems(
  directoryHandle: DirectoryHandleLike,
  entries: AdhocDistributionEntry[]
): Promise<ItemAnswer[]> {
  const byFolder = new Map<string, Set<string>>();
  for (const entry of entries) {
    const folder = adhocMonthFolder(entry.adhocImportId);
    const users = byFolder.get(folder) ?? new Set<string>();
    users.add(entry.assignedTo);
    byFolder.set(folder, users);
  }
  if (byFolder.size === 0) return [];

  const targets = [...byFolder].flatMap(([folder, users]) =>
    [...users].map((username) => ({ folder, username }))
  );
  const files = await Promise.all(
    targets.map(async ({ folder, username }) => {
      try {
        return (await loadEmployeeAnswers(directoryHandle, folder, username)).items;
      } catch (error) {
        logError("adhocImportEmployeeView:loadAdhocAnswerItems", error);
        return [];
      }
    })
  );
  return files.flat();
}
