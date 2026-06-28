import type { DirectoryHandleLike } from "../../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../../storage/safeWrite";
import { withResourceLock } from "../../storage/webLocks";
import { getReportsRoot } from "../../workspace/workspacePaths";
import type { ReportDocument } from "../reportTypes";

const INDEX_FILE = "designs.index.json";

export type DesignIndex = {
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
  return reports.getDirectoryHandle("designs", { create: true });
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
      await safeWriteJson(dir, `${doc.reportId}.json`, doc);

      const indexResult = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
      const existing: DesignIndex = indexResult.ok
        ? indexResult.value
        : { designs: [] };

      const others = existing.designs.filter((d) => d.reportId !== doc.reportId);
      const updated: DesignIndex = {
        designs: [
          ...others,
          {
            reportId: doc.reportId,
            reportName: doc.reportName,
            version: doc.version,
            updatedAt: doc.updatedAt,
          },
        ].sort((a, b) => a.reportName.localeCompare(b.reportName, "ar")),
      };
      await safeWriteJson(dir, INDEX_FILE, updated);
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
      const indexResult = await safeReadJson<DesignIndex>(dir, INDEX_FILE);
      if (indexResult.ok) {
        const updated: DesignIndex = {
          designs: indexResult.value.designs.filter(
            (d) => d.reportId !== reportId
          ),
        };
        await safeWriteJson(dir, INDEX_FILE, updated);
      }

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
