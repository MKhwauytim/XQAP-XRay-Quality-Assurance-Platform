import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { withWorkspaceWriteAccess } from "../storage/workspaceWriteAccess";
import { getSystemRoot, SYSTEM_FOLDER_NAMES } from "../workspace/workspacePaths";
import { toCsvString } from "./csvSerializer";
import type { ExportManifest, ExportFileResult } from "./exportTypes";

async function getExportDir(root: DirectoryHandleLike, month: string): Promise<DirectoryHandleLike> {
  const sys = await getSystemRoot(root, true);
  const expRoot = await sys.getDirectoryHandle(SYSTEM_FOLDER_NAMES.powerbiExport, { create: true });
  return expRoot.getDirectoryHandle(month, { create: true });
}

async function writeTextFile(dir: DirectoryHandleLike, fileName: string, content: string): Promise<void> {
  const fh = await dir.getFileHandle(fileName, { create: true });
  if (!fh.createWritable) throw new Error("createWritable not supported in this environment");
  const writable = await fh.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function writeCsvExport(
  root: DirectoryHandleLike,
  month: string,
  exports: Array<{ fileName: string; headers: string[]; rows: Record<string, unknown>[] }>
): Promise<ExportManifest> {
  return withWorkspaceWriteAccess(root, async () => {
    const dir = await getExportDir(root, month);
    const files: ExportFileResult[] = [];

    for (const exp of exports) {
      const csv = toCsvString(exp.headers, exp.rows);
      await writeTextFile(dir, exp.fileName, csv);
      files.push({ fileName: exp.fileName, rowCount: exp.rows.length });
    }

    const instructions = [
      "Power BI Data Export",
      "====================",
      "",
      "Arabic:",
      "لاستيراد هذه الملفات في Power BI Desktop:",
      "1. افتح Power BI Desktop",
      "2. الصفحة الرئيسية > الحصول على البيانات > نص/CSV",
      `3. انتقل إلى مجلد '5-system/powerbi-export/${month}/'`,
      "4. افتح كل ملف CSV واضغط 'تحميل'",
      "5. في نموذج البيانات، يمكنك إنشاء علاقات بين الجداول باستخدام عمود xrayImageId",
      "",
      "English:",
      "To import these files into Power BI Desktop:",
      "1. Open Power BI Desktop",
      "2. Home > Get Data > Text/CSV",
      `3. Browse to '5-system/powerbi-export/${month}/'`,
      "4. Open each CSV file and click 'Load'",
      "5. In the Data Model, create relationships between tables using the xrayImageId column",
      "",
      "Files in this export:",
      ...files.map((f) => `  - ${f.fileName} (${f.rowCount} rows)`),
      "",
      `Exported at: ${new Date().toISOString()}`,
    ].join("\n");

    await writeTextFile(dir, "README.txt", instructions);

    return {
      month,
      exportedAt: new Date().toISOString(),
      files,
    };
  });
}
