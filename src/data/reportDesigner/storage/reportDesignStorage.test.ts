import { describe, it, expect } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { createEmptyDocument } from "../reportTypes";
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
});
