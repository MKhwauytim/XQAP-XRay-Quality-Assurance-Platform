// Recovery for a template file that reads fine through the `.bak`/`.tmp`
// fallback but whose LIVE copy is damaged. Reported: "تعذّرت قراءة النسخة
// الأصلية من الملف "tmpl-1787457917309-ngm1iq.json"، وتم عرضه من النسخة
// ".bak"" — recurring on every read because nothing before this module
// rewrote the live file (see templateFileRecovery.ts's docblock).
//
// Same safety property as decisionFileRecovery.test.ts: a file that is
// merely TRANSIENTLY unreadable must never be archived, and this module never
// invents a blank template — only a genuinely damaged file with a readable
// sibling is eligible for repair.
import { beforeEach, describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { getTemplatesRoot } from "../workspace/workspacePaths";
import { safeReadJson } from "../storage/safeWrite";
import { loadTemplate, saveTemplate } from "./templateStorage";
import type { TemplateSchema } from "./templateTypes";
import {
  inspectAllTemplateFiles,
  inspectTemplateFile,
  recoverTemplateFile,
} from "./templateFileRecovery";

const TEMPLATE_ID = "tmpl-1787457917309-ngm1iq";
const FILE = `${TEMPLATE_ID}.json`;

function makeTemplate(overrides: Partial<TemplateSchema> = {}): TemplateSchema {
  return {
    templateId: TEMPLATE_ID,
    templateName: "قالب الفحص",
    version: 1,
    createdAt: "2026-09-01T10:00:00.000Z",
    createdBy: "admin",
    updatedAt: "2026-09-01T10:00:00.000Z",
    updatedBy: "admin",
    fields: [
      { fieldId: "fld-1", label: "الحقل الأول", type: "text", required: true, options: [] },
    ],
    ...overrides,
  };
}

/**
 * Overwrite a file with raw bytes that are not valid content — deliberately
 * NOT through `safeWriteJsonText`, which validates and would refuse. This is
 * what a torn write or a damaged share actually leaves behind.
 */
async function writeRawBytes(root: DirectoryHandleLike, name: string, text: string): Promise<void> {
  const dir = await getTemplatesRoot(root, true);
  const handle = await dir.getFileHandle(name, { create: true });
  const writable = await handle.createWritable!();
  await writable.write(text);
  await writable.close();
}

async function corruptLiveFile(root: DirectoryHandleLike): Promise<void> {
  await writeRawBytes(root, FILE, "{ this is not json");
}

async function corruptSibling(root: DirectoryHandleLike, suffix: string): Promise<void> {
  await writeRawBytes(root, `${FILE}${suffix}`, "{ also not json");
}

let root: DirectoryHandleLike;

beforeEach(() => {
  root = createMemoryDirectory("root") as unknown as DirectoryHandleLike;
});

describe("inspectTemplateFile", () => {
  it("reports a healthy template as readable, with its name and field count", async () => {
    await saveTemplate(root, makeTemplate());

    const report = await inspectTemplateFile(root, TEMPLATE_ID);
    expect(report.live.kind).toBe("readable");
    expect(report.live.kind === "readable" && report.live.templateName).toBe("قالب الفحص");
    expect(report.live.kind === "readable" && report.live.fieldCount).toBe(1);
    expect(report.needsRepair).toBe(false);
  });

  it("reports a templateId with no file at all as absent, not broken", async () => {
    const report = await inspectTemplateFile(root, TEMPLATE_ID);
    expect(report.live.kind).toBe("absent");
    expect(report.needsRepair).toBe(false);
    expect(report.recoverableFrom).toBeNull();
  });

  it("flags a damaged live file that a .bak sibling still covers for", async () => {
    await saveTemplate(root, makeTemplate());
    await saveTemplate(root, makeTemplate({ templateName: "قالب الفحص (معدّل)" }));
    await corruptLiveFile(root);

    const report = await inspectTemplateFile(root, TEMPLATE_ID);
    expect(report.live.kind).toBe("corrupt");
    expect(report.needsRepair).toBe(true);
    // safeWriteJson snapshots the previous contents to `.bak` before each
    // write, so `safeReadJson`'s ladder still answers via .bak.
    expect(report.recoverableFrom).toBe("bak");
    expect(report.bak.kind).toBe("readable");

    // ...and a plain read still succeeds, which is exactly why the banner
    // recurs on every read instead of surfacing as an outage.
    const read = await loadTemplate(root, TEMPLATE_ID);
    expect(read?.templateName).toBe("قالب الفحص");
  });

  it("reports nothing readable anywhere", async () => {
    await saveTemplate(root, makeTemplate());
    await corruptLiveFile(root);
    await corruptSibling(root, ".bak");
    await corruptSibling(root, ".tmp");

    const report = await inspectTemplateFile(root, TEMPLATE_ID);
    expect(report.live.kind).toBe("corrupt");
    expect(report.needsRepair).toBe(true);
    expect(report.recoverableFrom).toBeNull();
  });
});

describe("recoverTemplateFile", () => {
  it("rewrites the live file from the readable .bak copy and archives the damaged original", async () => {
    await saveTemplate(root, makeTemplate());
    await saveTemplate(root, makeTemplate({ templateName: "قالب الفحص (معدّل)" }));
    await corruptLiveFile(root);

    const outcome = await recoverTemplateFile(root, TEMPLATE_ID);
    expect(outcome.kind).toBe("restored");
    expect(outcome.kind === "restored" && outcome.from).toBe("bak");

    // The live file now reads without any fallback, so the banner stops
    // recurring.
    const dir = await getTemplatesRoot(root, true);
    const liveRead = await safeReadJson<TemplateSchema>(dir, FILE);
    expect(liveRead.ok).toBe(true);
    expect(liveRead.ok && liveRead.recoveredFromBak).toBe(false);

    const report = await inspectTemplateFile(root, TEMPLATE_ID);
    expect(report.needsRepair).toBe(false);
  });

  it("archives the damaged bytes rather than deleting them", async () => {
    await saveTemplate(root, makeTemplate());
    await saveTemplate(root, makeTemplate({ templateName: "قالب الفحص (معدّل)" }));
    await corruptLiveFile(root);

    const outcome = await recoverTemplateFile(root, TEMPLATE_ID);
    expect(outcome.kind).toBe("restored");
    const archivedAs = outcome.kind === "restored" ? outcome.archivedAs : "";
    expect(archivedAs).toMatch(new RegExp(`^${TEMPLATE_ID}\\.json\\.unreadable-`));

    const dir = await getTemplatesRoot(root, true);
    const handle = await dir.getFileHandle(archivedAs, { create: false });
    const text = await (await handle.getFile()).text();
    expect(text).toContain("this is not json");
  });

  it("refuses to invent a blank template when nothing is recoverable", async () => {
    await saveTemplate(root, makeTemplate());
    await corruptLiveFile(root);
    await corruptSibling(root, ".bak");
    await corruptSibling(root, ".tmp");

    const outcome = await recoverTemplateFile(root, TEMPLATE_ID);
    expect(outcome.kind).toBe("unrecoverable");

    // Nothing was touched — the damaged file is still exactly where it was.
    const report = await inspectTemplateFile(root, TEMPLATE_ID);
    expect(report.live.kind).toBe("corrupt");
  });

  it("does nothing when the file reads fine", async () => {
    await saveTemplate(root, makeTemplate());
    const outcome = await recoverTemplateFile(root, TEMPLATE_ID);
    expect(outcome.kind).toBe("not-needed");
    expect((await loadTemplate(root, TEMPLATE_ID))?.templateName).toBe("قالب الفحص");
  });

  it("does nothing when the templateId simply has no file yet", async () => {
    const outcome = await recoverTemplateFile(root, TEMPLATE_ID);
    expect(outcome.kind).toBe("not-needed");
  });
});

describe("inspectAllTemplateFiles", () => {
  it("finds the damaged template without being told which id it is", async () => {
    await saveTemplate(root, makeTemplate());
    await saveTemplate(root, makeTemplate({ templateId: "tmpl-ok", templateName: "قالب سليم" }));
    await corruptLiveFile(root);
    await corruptSibling(root, ".bak");
    await corruptSibling(root, ".tmp");

    const reports = await inspectAllTemplateFiles(root);
    expect(reports.map((r) => r.templateId).sort()).toEqual([TEMPLATE_ID, "tmpl-ok"].sort());
    // Needing repair first — the one that needs doing is at the top.
    expect(reports[0].needsRepair).toBe(true);
    expect(reports[0].templateId).toBe(TEMPLATE_ID);
    expect(reports[1].live.kind).toBe("readable");
  });

  it("returns an empty list for a workspace with no templates", async () => {
    await expect(inspectAllTemplateFiles(root)).resolves.toEqual([]);
  });

  it("excludes the shared index and selection files from the scan", async () => {
    await saveTemplate(root, makeTemplate());
    const reports = await inspectAllTemplateFiles(root);
    expect(reports.map((r) => r.templateId)).toEqual([TEMPLATE_ID]);
  });
});
