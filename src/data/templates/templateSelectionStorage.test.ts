import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import {
  loadInspectionTemplateSelection,
  saveInspectionTemplateSelection,
  type InspectionTemplateSelection,
} from "./templateSelectionStorage";

function makeSelection(templateId: string): InspectionTemplateSelection {
  return {
    templateId,
    updatedAt: new Date().toISOString(),
    updatedBy: "admin",
  };
}

describe("templateSelectionStorage", () => {
  it("returns null when no selection has been saved yet", async () => {
    const root = createMemoryDirectory();
    const loaded = await loadInspectionTemplateSelection(root);
    expect(loaded).toBeNull();
  });

  it("round-trips a saved selection", async () => {
    const root = createMemoryDirectory();
    const result = await saveInspectionTemplateSelection(root, makeSelection("tmpl-a"));
    expect(result.ok).toBe(true);

    const loaded = await loadInspectionTemplateSelection(root);
    expect(loaded?.templateId).toBe("tmpl-a");
    expect(loaded?.revision).toBe(1);
  });

  it("re-saving replaces the selection (last-writer-wins is the intended contract)", async () => {
    const root = createMemoryDirectory();
    await saveInspectionTemplateSelection(root, makeSelection("tmpl-a"));
    await saveInspectionTemplateSelection(root, makeSelection("tmpl-b"));

    const loaded = await loadInspectionTemplateSelection(root);
    expect(loaded?.templateId).toBe("tmpl-b");
    expect(loaded?.revision).toBe(2);
  });

  it("serializes concurrent saves via CAS (revision advances past both attempts)", async () => {
    const root = createMemoryDirectory();
    await Promise.all([
      saveInspectionTemplateSelection(root, makeSelection("tmpl-x")),
      saveInspectionTemplateSelection(root, makeSelection("tmpl-y")),
    ]);
    const loaded = await loadInspectionTemplateSelection(root);
    expect(loaded?.revision).toBe(2);
    expect(["tmpl-x", "tmpl-y"]).toContain(loaded?.templateId);
  });
});
