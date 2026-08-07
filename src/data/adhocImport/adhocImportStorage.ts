import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { casLoop } from "../storage/casLoop";
import { withResourceLock } from "../storage/webLocks";
import { getAdhocImportsDir } from "../workspace/workspacePaths";
import type { AdhocImportIndex, AdhocImportIndexEntry, AdhocImportRecord } from "./adhocImportTypes";

const INDEX_FILE = "adhoc-imports.index.json";

function recordFileName(importId: string): string {
  return `${importId}.json`;
}

function toIndexEntry(record: AdhocImportRecord): AdhocImportIndexEntry {
  const validRows = record.rows.filter((r) => r.validation.valid);
  return {
    importId: record.importId,
    fileName: record.fileName,
    importedBy: record.importedBy,
    importedAt: record.importedAt,
    status: record.status,
    totalRows: record.rows.length,
    validRows: validRows.length,
    assignedRows: record.rows.filter((r) => r.assigned).length,
  };
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
  const outcome = await casLoop<{ ok: true }>(
    async (writeToken) => {
      const indexResult = await safeReadJson<AdhocImportIndex>(dir, INDEX_FILE);
      const existing: AdhocImportIndex = indexResult.ok ? indexResult.value : { imports: [] };
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
): Promise<AdhocImportIndexEntry[]> {
  const dir = await getAdhocImportsDir(directoryHandle, false).catch(() => null);
  if (!dir) return [];
  const result = await safeReadJson<AdhocImportIndex>(dir, INDEX_FILE);
  return result.ok ? result.value.imports : [];
}

export async function loadAdhocImportRecord(
  directoryHandle: DirectoryHandleLike,
  importId: string
): Promise<AdhocImportRecord | null> {
  const dir = await getAdhocImportsDir(directoryHandle, false).catch(() => null);
  if (!dir) return null;
  const result = await safeReadJson<AdhocImportRecord>(dir, recordFileName(importId));
  return result.ok ? result.value : null;
}

/**
 * CAS read-modify-write of the per-import `{importId}.json` document, then
 * refreshes its index entry — mirrors `templateStorage.ts`'s
 * `saveTemplateFile`. Returns the saved record (with its stamped revision).
 */
export async function saveAdhocImportRecord(
  directoryHandle: DirectoryHandleLike,
  record: AdhocImportRecord
): Promise<AdhocImportRecord> {
  const dir = await getAdhocImportsDir(directoryHandle, true);
  const fileName = recordFileName(record.importId);

  const outcome = await withResourceLock(`adhoc-import/${record.importId}:rmw`, () =>
    casLoop<{ ok: true; saved: AdhocImportRecord }>(
      async (writeToken) => {
        const existing = await safeReadJson<AdhocImportRecord>(dir, fileName);
        const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
        const updated: AdhocImportRecord = {
          ...record,
          revision: nextRevision,
          _writeToken: writeToken,
        };
        await safeWriteJson(dir, fileName, updated);
        const verify = await safeReadJson<AdhocImportRecord>(dir, fileName);
        if (verify.ok && verify.value.revision === nextRevision && verify.value._writeToken === writeToken) {
          return { done: true, result: { ok: true as const, saved: updated } };
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
