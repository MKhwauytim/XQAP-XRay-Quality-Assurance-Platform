import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { createEmptyDocument, type Page } from "../reportTypes";
import {
  saveDesign,
  loadDesign,
  loadDesignIndex,
  deleteDesign,
} from "./reportDesignStorage";

describe("reportDesignStorage", () => {
  it("round-trips a design and updates the index", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("تقرير الأداء", "admin");
    const saved = await saveDesign(dir, doc);
    expect(saved.ok).toBe(true);

    const loaded = await loadDesign(dir, doc.reportId);
    expect(loaded?.reportName).toBe("تقرير الأداء");

    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId)).toContain(doc.reportId);
  });

  it("deletes a design and removes it from the index", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("للحذف", "admin");
    await saveDesign(dir, doc);
    const del = await deleteDesign(dir, doc.reportId);
    expect(del.ok).toBe(true);
    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId)).not.toContain(doc.reportId);
  });

  it("preserves both index entries on concurrent saves (cross-machine CAS)", async () => {
    const dir = createMemoryDirectory("root");
    // Two authors on two PCs save different designs at the same instant. The
    // withResourceLock + casLoop index RMW must land BOTH index entries.
    const docA = createEmptyDocument("تصميم أ", "admin");
    const docB = createEmptyDocument("تصميم ب", "admin");
    await Promise.all([saveDesign(dir, docA), saveDesign(dir, docB)]);

    const index = await loadDesignIndex(dir);
    expect(index.designs.map((d) => d.reportId).sort()).toEqual(
      [docA.reportId, docB.reportId].sort()
    );
    // Both writes participated in the CAS protocol → revision advanced past both.
    expect(index.revision).toBe(2);
  });

  it("serializes concurrent saves of the SAME report id via per-id CAS (no silent clobber)", async () => {
    const dir = createMemoryDirectory("root");
    const doc = createEmptyDocument("تصميم مشترك", "admin");
    // Two supervisors on two PCs edit the SAME design at the same instant.
    const docA = { ...doc, pages: [] };
    const extraPage: Page = { pageId: "p1", name: "صفحة 2", order: 1, filters: [], elements: [] };
    const docB = { ...doc, pages: [extraPage] };
    await Promise.all([saveDesign(dir, docA), saveDesign(dir, docB)]);

    const loaded = await loadDesign(dir, doc.reportId);
    expect(loaded).not.toBeNull();
    expect(loaded?.revision).toBe(2); // both writes participated in the CAS chain

    // The real no-clobber proof: without the fix, saveDesignFile throws on
    // every save (see reportDesignStorage.ts), which short-circuits the index
    // update inside the same withResourceLock callback — so this assertion is
    // what actually fails under the bug, not the revision check above.
    const index = await loadDesignIndex(dir);
    expect(index.designs).toHaveLength(1); // one entry, not duplicated
  });
});
