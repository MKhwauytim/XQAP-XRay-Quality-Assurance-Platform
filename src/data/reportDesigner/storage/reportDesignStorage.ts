import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { casLoop } from "../../storage/casLoop";
import { withResourceLock } from "../../storage/webLocks";
import { getReportsRoot, REPORTS_SUBFOLDERS } from "../../workspace/workspacePaths";
import type { ReportDocument } from "../reportTypes";

const INDEX_FILE = "designs.index.json";

export type DesignIndex = {
  /** Monotonic CAS revision for the shared multi-writer index (see below). */
  revision?: number;
  /** Per-write UUID embedded by casLoop for cross-machine race detection. */
  _writeToken?: string;
  designs: Array<{
    reportId: string;
    reportName: string;
    version: number;
    updatedAt: string;
  }>;
};

async function getDesignsDir(
  directoryHandle: DirectoryHandleLike
): Promise<DirectoryHandleLike> {
  const reports = await getReportsRoot(directoryHandle, true);
  return reports.getDirectoryHandle(REPORTS_SUBFOLDERS.designs, { create: true });
}

/**
 * CAS read-modify-write of the shared `designs.index.json`. Edited by every
 * supervisor/manager/admin on every machine; the caller's outer
 * `withResourceLock` serializes same-tab writers, casLoop re-reads fresh, bumps
 * `revision`, stamps `_writeToken`, and verifies both on read-back so a concurrent
 * author's index entry on another machine is never silently dropped.
 *
 * No delayed verify: index entries are eventually-consistent by nature — a
 * transient one-write-behind entry self-heals on the next save. The
 * stronger protection lives on the per-id document (saveDesignFile, below,
 * hardened in Task 4), which is where real content divergence would
 * actually matter.
 */
async function updateDesignIndex(
  dir: DirectoryHandleLike,
  apply: (designs: DesignIndex["designs"]) => DesignIndex["designs"]
): Promise<void> {
  const outcome = await casLoop<{ ok: true }>(
    async (writeToken) => {
      const indexResult = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
      const existing: DesignIndex = indexResult.ok ? indexResult.value : { designs: [] };
      const nextRevision = (existing.revision ?? 0) + 1;
      const updated: DesignIndex = {
        revision: nextRevision,
        _writeToken: writeToken,
        designs: apply(existing.designs),
      };
      await safeWriteJson(dir, INDEX_FILE, updated);
      const verify = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
      if (
        verify.ok &&
        verify.value.revision === nextRevision &&
        verify.value._writeToken === writeToken
      ) {
        return { done: true, result: { ok: true as const } };
      }
      return { done: false };
    },
    { conflictError: "تعذّر تحديث فهرس التقارير: تعارض في الكتابة بعد عدة محاولات." }
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
}

/**
 * CAS read-modify-write of the shared per-id `{reportId}.json` document. Two
 * supervisors/managers on two machines can edit the same report design
 * concurrently; casLoop bumps `revision`, stamps `_writeToken`, and verifies
 * both on read-back (plus a delayed re-verify) so a concurrent clobber fails
 * loudly and retries rather than silently overwriting the other author's
 * edit. Mirrors `templateStorage.ts`'s `saveTemplateFile` for the analogous
 * per-id shape.
 */
async function saveDesignFile(
  dir: DirectoryHandleLike,
  doc: ReportDocument
): Promise<ReportDocument> {
  const fileName = `${doc.reportId}.json`;
  // Wrap the doc in { ok: true; doc } (rather than casLoop<ReportDocument>
  // directly) so the `!outcome.ok` failure check below is a valid discriminant:
  // ReportDocument itself has no `ok` field, so casLoop<ReportDocument> would
  // make a *successful* outcome (a bare ReportDocument) also read as falsy
  // `outcome.ok`, tripping the throw on every save.
  const outcome = await casLoop<{ ok: true; doc: ReportDocument }>(
    async (writeToken) => {
      const existing = await safeReadJson<ReportDocument>(dir, fileName);
      const nextRevision = (existing.ok ? existing.value.revision ?? 0 : 0) + 1;
      const updated: ReportDocument = {
        ...doc,
        revision: nextRevision,
        _writeToken: writeToken,
      };
      await safeWriteJson(dir, fileName, updated);
      const verify = await safeReadJson<ReportDocument>(dir, fileName);
      if (
        verify.ok &&
        verify.value.revision === nextRevision &&
        verify.value._writeToken === writeToken
      ) {
        return {
          done: true,
          result: { ok: true as const, doc: updated },
          verify: async () => {
            const recheck = await safeReadJson<ReportDocument>(dir, fileName);
            return (
              recheck.ok &&
              recheck.value.revision === nextRevision &&
              recheck.value._writeToken === writeToken
            );
          },
        };
      }
      return { done: false };
    },
    { conflictError: "تعذّر حفظ تصميم التقرير: تعارض في الكتابة بعد عدة محاولات." }
  );
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  return outcome.doc;
}

export async function saveDesign(
  directoryHandle: DirectoryHandleLike,
  doc: ReportDocument
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!doc.reportId || !doc.reportName) {
      return { ok: false, error: "بيانات التقرير غير مكتملة، ولم يتم الحفظ." };
    }

    const dir = await getDesignsDir(directoryHandle);
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      // Shared per-id doc — two supervisors/managers on two machines can edit
      // the same design. CAS (revision + _writeToken, verified on read-back)
      // makes a concurrent clobber fail loudly and retry instead of silently
      // winning.
      await saveDesignFile(dir, doc);

      await updateDesignIndex(dir, (designs) =>
        [
          ...designs.filter((d) => d.reportId !== doc.reportId),
          {
            reportId: doc.reportId,
            reportName: doc.reportName,
            version: doc.version,
            updatedAt: doc.updatedAt,
          },
        ].sort((a, b) => a.reportName.localeCompare(b.reportName, "ar"))
      );
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function loadDesign(
  directoryHandle: DirectoryHandleLike,
  reportId: string
): Promise<ReportDocument | null> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    const result = await safeReadJson<ReportDocument>(dir, `${reportId}.json`);
    return result.ok && typeof result.value.reportId === "string"
      ? result.value
      : null;
  } catch {
    return null;
  }
}

export async function loadDesignIndex(
  directoryHandle: DirectoryHandleLike
): Promise<DesignIndex> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    const result = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
    return result.ok ? result.value : { designs: [] };
  } catch {
    return { designs: [] };
  }
}

export async function deleteDesign(
  directoryHandle: DirectoryHandleLike,
  reportId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const dir = await getDesignsDir(directoryHandle);
    await withResourceLock(`${dir.name}/designs-index`, async () => {
      await updateDesignIndex(dir, (designs) =>
        designs.filter((d) => d.reportId !== reportId)
      );

      if (dir.removeEntry) {
        await dir.removeEntry(`${reportId}.json`);
      } else {
        await safeWriteJson(dir, `${reportId}.json`, {
          deleted: true,
          reportId,
          deletedAt: new Date().toISOString(),
        });
      }
    });

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}
