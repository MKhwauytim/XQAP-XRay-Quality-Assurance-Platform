import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { getAdhocImportsDir } from "../workspace/workspacePaths";
import type { AdhocIndexEntry, AdhocRecord } from "./adhocImportModel";
import type { AdhocImportIndex, AdhocImportIndexEntry, AdhocImportRecord } from "./adhocImportTypes";
import { normalizeAdhocRecord, toIndexEntry, toLegacyRecord } from "./adhocRecordMigration";

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
    { conflictError: "تعذّر تحديث فهرس الاستيراد اليدوي: تعارض في الكتابة بعد عدة محاولات." }
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
      { conflictError: `تعذّر حفظ الاستيراد اليدوي (${record.importId}): تعارض في الكتابة بعد عدة محاولات.` }
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
    await dir.removeEntry(recordFileName(importId)).catch(() => undefined);
  }
  await updateIndex(dir, (entries) => entries.filter((e) => e.importId !== importId));
}

export function createImportId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `adh-${crypto.randomUUID()}`;
  }
  return `adh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
