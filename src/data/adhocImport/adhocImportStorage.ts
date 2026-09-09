import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeRemoveJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { getAdhocImportsDir, getSampleMainDir, getSamplesRoot } from "../workspace/workspacePaths";
import type { AdhocIndexEntry, AdhocRecord } from "./adhocImportModel";
import type { AdhocImportIndex, AdhocImportIndexEntry, AdhocImportRecord } from "./adhocImportTypes";
import { normalizeAdhocRecord, toIndexEntry, toLegacyRecord } from "./adhocRecordMigration";
import { adhocMonthFolder, ADHOC_MONTH_FOLDER_PREFIX, importIdFromAdhocMonthFolder } from "./adhocImportModel";
import { DISTRIBUTION_EVENTS_DIR } from "../distribution/distributionEventStore";
import { logError } from "../storage/errorLogger";

const INDEX_FILE = "adhoc-imports.index.json";

function recordFileName(importId: string): string {
  return `${importId}.json`;
}

const CORRUPT_INDEX_ERROR =
  "تعذّر تحديث فهرس الاستيراد اليدوي: الفهرس الحالي تالف ولا يمكن قراءته، وتحديثه الآن سيحذف عمليات الاستيراد الأخرى.";

/**
 * The index as the read-modify-write below may start from.
 *
 * An empty default handed to a read-modify-write is not a harmless
 * placeholder: it is written back as the ENTIRE file (safeWrite.ts's own module
 * doc). `safeReadJson` reports a file that exists but cannot be parsed — after
 * its live/`.bak`/`.tmp` ladder is exhausted — as `corrupt`, which is a
 * different answer from `missing`. Seeding `{ imports: [] }` from a corrupt
 * index deleted every other import's entry in a single write, and since this
 * index is the only lister the app has, the surviving `{importId}.json`
 * documents became permanently unreachable. Only a genuinely ABSENT index may
 * start from empty.
 */
async function readIndexForUpdate(dir: DirectoryHandleLike): Promise<AdhocImportIndex> {
  const indexResult = await safeReadJson<AdhocImportIndex>(dir, INDEX_FILE);
  if (!indexResult.ok && indexResult.reason === "corrupt") {
    throw new Error(CORRUPT_INDEX_ERROR);
  }
  return indexResult.ok ? indexResult.value : { imports: [] };
}

/**
 * CAS read-modify-write of the shared `adhoc-imports.index.json` — mirrors
 * `templateStorage.ts`'s `updateTemplateIndex` (same eventually-consistent
 * rationale: a transient one-write-behind entry self-heals on the next save;
 * the per-import document below is where real content divergence matters).
 */
async function updateIndex(
  dir: DirectoryHandleLike,
  apply: (entries: AdhocImportIndexEntry[]) => AdhocImportIndexEntry[]
): Promise<void> {
  // Checked once up front as well as inside every attempt: a corrupt index is a
  // permanent condition, so failing here reports the real reason immediately
  // instead of burning the whole CAS backoff ladder first (whose exhaustion
  // message is a generic I/O code).
  await readIndexForUpdate(dir);
  const outcome = await casLoop<{ ok: true }>(
    async (writeToken) => {
      const existing = await readIndexForUpdate(dir);
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: AdhocImportIndex = {
        revision: nextRevision,
        _writeToken: writeToken,
        imports: apply(existing.imports),
      };
      await safeWriteJson(dir, INDEX_FILE, updated);
      const verify = await safeReadJson<AdhocImportIndex>(dir, INDEX_FILE);
      if (verify.ok && verify.value.revision === nextRevision && verify.value._writeToken === writeToken) {
        return { done: true, result: { ok: true as const } };
      }
      return { done: false };
    },
    { context: "adhocImport:index", conflictError: "تعذّر تحديث فهرس الاستيراد اليدوي: تعارض في الكتابة بعد عدة محاولات." }
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}

export async function loadAdhocImportIndex(
  directoryHandle: DirectoryHandleLike
): Promise<AdhocIndexEntry[]> {
  const dir = await getAdhocImportsDir(directoryHandle, false).catch(() => null);
  if (!dir) return [];
  const result = await safeReadJson<AdhocImportIndex>(dir, INDEX_FILE);
  return result.ok ? result.value.imports : [];
}

/**
 * The import document, read as an `AdhocRecord` whatever schema it was written
 * under — see `adhocRecordMigration.ts`. The upgrade is in memory only; nothing
 * is written back here.
 */
export async function loadAdhocRecord(
  directoryHandle: DirectoryHandleLike,
  importId: string
): Promise<AdhocRecord | null> {
  const dir = await getAdhocImportsDir(directoryHandle, false).catch(() => null);
  if (!dir) return null;
  const result = await safeReadJson<unknown>(dir, recordFileName(importId));
  return result.ok ? normalizeAdhocRecord(result.value) : null;
}

/**
 * CAS read-modify-write of the per-import `{importId}.json` document, then
 * refreshes its index entry — mirrors `templateStorage.ts`'s
 * `saveTemplateFile`. Returns the saved record (with its stamped revision).
 *
 * What lands on disk is `toLegacyRecord(record)`: the v2 document plus v1's
 * assignment scalars, so a copy of last week's single-file build reading this
 * workspace still sees which rows are taken. That compatibility layer is
 * temporary — see `adhocRecordMigration.ts`'s one-release note.
 */
export async function saveAdhocRecord(
  directoryHandle: DirectoryHandleLike,
  record: AdhocRecord
): Promise<AdhocRecord> {
  const dir = await getAdhocImportsDir(directoryHandle, true);
  const fileName = recordFileName(record.importId);

  const outcome = await withResourceLock(`adhoc-import/${record.importId}:rmw`, () =>
    casLoop<{ ok: true; saved: AdhocRecord }>(
      async (writeToken) => {
        const existing = await safeReadJson<{ revision?: number }>(dir, fileName);
        const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
        const saved: AdhocRecord = { ...record, revision: nextRevision, _writeToken: writeToken };
        await safeWriteJson(dir, fileName, toLegacyRecord(saved));
        const verify = await safeReadJson<{ revision?: number; _writeToken?: string }>(dir, fileName);
        if (verify.ok && verify.value.revision === nextRevision && verify.value._writeToken === writeToken) {
          return { done: true, result: { ok: true as const, saved } };
        }
        return { done: false };
      },
      { context: "adhocImport:record", conflictError: `تعذّر حفظ الاستيراد اليدوي (${record.importId}): تعارض في الكتابة بعد عدة محاولات.` }
    )
  );

  if (!outcome.ok) {
    throw new Error(outcome.error);
  }

  await updateIndex(dir, (entries) => {
    const withoutThis = entries.filter((e) => e.importId !== record.importId);
    return [...withoutThis, toIndexEntry(outcome.saved)];
  });

  return outcome.saved;
}

/**
 * v1 signature, kept while the Ad-hoc Import tab is rebuilt against the v2
 * model. Reads exactly the same document as `loadAdhocRecord` and returns the
 * legacy VIEW of it — `assigned` / `assignedTo` / `assignedAt` /
 * `namespacedXrayImageId` re-derived, everything else carried through.
 */
export async function loadAdhocImportRecord(
  directoryHandle: DirectoryHandleLike,
  importId: string
): Promise<AdhocImportRecord | null> {
  const record = await loadAdhocRecord(directoryHandle, importId);
  return record === null ? null : toLegacyRecord(record);
}

/** v1 signature — see `loadAdhocImportRecord`. A v1 record is upgraded on the way in. */
export async function saveAdhocImportRecord(
  directoryHandle: DirectoryHandleLike,
  record: AdhocImportRecord
): Promise<AdhocImportRecord> {
  const normalized = normalizeAdhocRecord(record);
  if (normalized === null) {
    throw new Error("تعذّر حفظ الاستيراد اليدوي: السجل غير صالح.");
  }
  return toLegacyRecord(await saveAdhocRecord(directoryHandle, normalized));
}

export async function deleteAdhocImportRecord(
  directoryHandle: DirectoryHandleLike,
  importId: string
): Promise<void> {
  const dir = await getAdhocImportsDir(directoryHandle, false).catch(() => null);
  if (!dir) return;
  if (dir.removeEntry) {
    // Siblings too — an orphaned `.bak` answers reads for the deleted record.
    await safeRemoveJson(dir, recordFileName(importId)).catch(() => undefined);
  }
  await updateIndex(dir, (entries) => entries.filter((e) => e.importId !== importId));
}

export function createImportId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `adh-${crypto.randomUUID()}`;
  }
  return `adh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Store discovery — the index is bookkeeping, the folders are the truth
 * ──────────────────────────────────────────────────────────────────────────── */

type DirectoryEntryLike = { name: string; kind: string };

/**
 * `dir.values()` / `dir.entries()` / async-iteration, whichever this handle
 * implements. Same shape as `populationStorage.ts` and `backupStorage.ts` use;
 * kept local for the same reason they do — `DirectoryHandleLike` deliberately
 * does not declare the iteration surface, because a read-only handle need not
 * have one.
 */
function getDirectoryEntries(
  dir: DirectoryHandleLike
): AsyncIterable<DirectoryEntryLike> | null {
  const directory = dir as DirectoryHandleLike & {
    values?: () => AsyncIterable<DirectoryEntryLike>;
    entries?: () => AsyncIterable<[string, DirectoryEntryLike]>;
    [Symbol.asyncIterator]?: () => AsyncIterator<DirectoryEntryLike>;
  };
  if (typeof directory.values === "function") return directory.values.call(directory);
  if (typeof directory.entries === "function") {
    return {
      async *[Symbol.asyncIterator]() {
        for await (const [, entry] of directory.entries!.call(directory)) yield entry;
      },
    };
  }
  if (typeof directory[Symbol.asyncIterator] === "function") {
    return directory as unknown as AsyncIterable<DirectoryEntryLike>;
  }
  return null;
}

/**
 * Every `2-samples/adhoc-{importId}/` store that actually exists on disk, as
 * import ids.
 *
 * Why this exists at all: `adhoc-imports.index.json` is a projection, and
 * `assignedRows` on it is the ONLY thing that used to decide whether an ad-hoc
 * import's rows are visible to anybody. But an assignment is committed in three
 * writes — sample rows, then the distribution events, then the record (which is
 * what refreshes the index). The events are the durable part and they land
 * SECOND, so a failure on the third write (a share hiccup, a lost workspace
 * handle, a CAS conflict) leaves rows genuinely assigned on disk while the index
 * still reports `assignedRows: 0` — and every reader skipped them forever. Worse,
 * re-running the assignment then reports «كل الصفوف المحددة معيّنة بالفعل»,
 * because the events it would write are already there, so the bookkeeping can
 * never catch up on its own.
 *
 * The folder listing cannot drift that way: a store folder exists only because
 * `ensureAdhocSampleMaster` wrote sample rows into it. Callers union this with
 * the index so a stale counter can no longer hide real work, and read the
 * FOLDER's own distribution to decide what is in it — a folder with sample rows
 * but no events contributes nothing, which is exactly right for an import whose
 * assignment failed before the events landed.
 *
 * One cheap directory listing, fail-soft to `[]` — a workspace with no
 * `2-samples/` yet (nothing drawn, nothing imported) is not an error.
 */
export async function listAdhocStoreImportIds(
  directoryHandle: DirectoryHandleLike
): Promise<string[]> {
  try {
    const samplesRoot = await getSamplesRoot(directoryHandle, false);
    const iterable = getDirectoryEntries(samplesRoot);
    if (!iterable) return [];
    const ids: string[] = [];
    for await (const entry of iterable) {
      if (entry.kind !== "directory") continue;
      if (!entry.name.startsWith(ADHOC_MONTH_FOLDER_PREFIX)) continue;
      const importId = importIdFromAdhocMonthFolder(entry.name);
      if (importId !== null) ids.push(importId);
    }
    return ids;
  } catch (error) {
    logError("adhocImportStorage:listAdhocStoreImportIds", error);
    return [];
  }
}

/**
 * Does this ad-hoc store hold distribution events on disk?
 *
 * The discriminator that keeps `listAdhocStoreImportIds` usable as a repair
 * path without turning it into a cost regression. Every SAVE of an ad-hoc
 * record writes its `sample.master.json` (an unassigned import stays browsable
 * under its synthetic month — see the AdhocImport tab's `persist`), so a store
 * FOLDER existing proves nothing about assignment. `distribution.events/` is
 * different: it is created only by `appendDistributionEvents`, i.e. only when
 * rows were actually assigned.
 *
 * One `getDirectoryHandle` round trip, no file read, no listing. Fail-soft to
 * `false`: a store whose events cannot be probed is left to the index's own
 * verdict rather than opened speculatively.
 *
 * Scope note: this looks for the immutable event directory current clients
 * write, not the legacy full-body `distribution.log.json` projection. A store
 * holding only the legacy shape was written by a client that also updated the
 * index, so the index already vouches for it and it never reaches this probe.
 */
export async function adhocStoreHasDistributionEvents(
  directoryHandle: DirectoryHandleLike,
  importId: string
): Promise<boolean> {
  try {
    const mainDir = await getSampleMainDir(directoryHandle, adhocMonthFolder(importId), false);
    await mainDir.getDirectoryHandle(DISTRIBUTION_EVENTS_DIR, { create: false });
    return true;
  } catch {
    return false;
  }
}
