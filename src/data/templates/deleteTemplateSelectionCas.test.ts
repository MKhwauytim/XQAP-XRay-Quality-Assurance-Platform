// Regression test (P1-B): `deleteTemplate` must not clobber the CAS-protected
// `template.selection.json`.
//
// The file is shared by every supervisor/manager/admin on every machine and is
// written through `casLoop` by `saveInspectionTemplateSelection` (revision +
// `_writeToken`, verified on read-back). `deleteTemplate` cleared the active
// selection with a RAW `safeWriteJson`, so it:
//   * dropped `revision`/`_writeToken` entirely — the counter reset (8 → 1),
//     which makes every later CAS read-back compare against a rewound counter;
//   * silently overwrote a concurrent admin's selection change instead of
//     retrying, blanking the inspection form workspace-wide.

import { describe, expect, it } from "vitest";

import { createMemoryDirectory } from "../storage/memoryDirectory";
import type { TemplateSchema } from "./templateTypes";
import { deleteTemplate, saveTemplate } from "./templateStorage";
import {
  loadInspectionTemplateSelection,
  saveInspectionTemplateSelection,
} from "./templateSelectionStorage";

function makeTemplate(templateId: string): TemplateSchema {
  return {
    templateId,
    templateName: `قالب ${templateId}`,
    version: 1,
    createdAt: "2026-05-01T00:00:00.000Z",
    createdBy: "admin",
    updatedAt: "2026-05-01T00:00:00.000Z",
    updatedBy: "admin",
    phases: [],
    fields: [],
  };
}

async function selectTemplate(root: ReturnType<typeof createMemoryDirectory>, templateId: string) {
  return saveInspectionTemplateSelection(root, {
    templateId,
    updatedAt: "2026-05-02T00:00:00.000Z",
    updatedBy: "admin",
  });
}

describe("P1-B — deleteTemplate clears the selection through the CAS protocol", () => {
  it("advances the CAS revision instead of resetting it", async () => {
    const root = createMemoryDirectory();
    await saveTemplate(root, makeTemplate("tmpl-a"));

    // Three real selection changes — the counter is now at 3.
    await selectTemplate(root, "tmpl-a");
    await selectTemplate(root, "tmpl-a");
    await selectTemplate(root, "tmpl-a");
    expect((await loadInspectionTemplateSelection(root))?.revision).toBe(3);

    const result = await deleteTemplate(root, "tmpl-a");
    expect(result.ok).toBe(true);

    const cleared = await loadInspectionTemplateSelection(root);
    expect(cleared?.templateId).toBe("");
    // The clear is a write like any other: revision 3 → 4, with a fresh token.
    expect(cleared?.revision).toBe(4);
    expect(typeof cleared?._writeToken).toBe("string");
  });

  it("leaves the counter monotonic for the next writer (no 8 → 1 rewind)", async () => {
    const root = createMemoryDirectory();
    await saveTemplate(root, makeTemplate("tmpl-a"));
    await saveTemplate(root, makeTemplate("tmpl-b"));

    for (let i = 0; i < 8; i += 1) await selectTemplate(root, "tmpl-a");
    expect((await loadInspectionTemplateSelection(root))?.revision).toBe(8);

    await deleteTemplate(root, "tmpl-a");
    await selectTemplate(root, "tmpl-b");

    const after = await loadInspectionTemplateSelection(root);
    expect(after?.templateId).toBe("tmpl-b");
    expect(after?.revision).toBe(10);
  });

  it("does not touch the selection when it points at a different template", async () => {
    const root = createMemoryDirectory();
    await saveTemplate(root, makeTemplate("tmpl-a"));
    await saveTemplate(root, makeTemplate("tmpl-b"));
    await selectTemplate(root, "tmpl-b");

    await deleteTemplate(root, "tmpl-a");

    const after = await loadInspectionTemplateSelection(root);
    expect(after?.templateId).toBe("tmpl-b");
    expect(after?.revision).toBe(1);
  });
});
