import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../../storage/memoryDirectory";
import { deleteDeckTextPreset, loadDeckTextPresets, saveDeckTextPreset } from "./textPresets";

describe("deck2 text presets", () => {
  it("is empty before anything is saved (the default deck is never stored)", async () => {
    expect(await loadDeckTextPresets(createMemoryDirectory())).toEqual([]);
  });

  it("round-trips a named preset", async () => {
    const root = createMemoryDirectory();
    const result = await saveDeckTextPreset(root, "نسخة الإدارة", { "محتويات التقرير": "الفهرس" }, "admin");
    expect(result.ok).toBe(true);
    const loaded = await loadDeckTextPresets(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ name: "نسخة الإدارة", overrides: { "محتويات التقرير": "الفهرس" }, updatedBy: "admin" });
  });

  it("saving an existing name replaces it and keeps its id", async () => {
    const root = createMemoryDirectory();
    await saveDeckTextPreset(root, "A", { "المعجم": "القاموس" }, "admin");
    const first = (await loadDeckTextPresets(root))[0];
    await saveDeckTextPreset(root, "A", { "المعجم": "المصطلحات" }, "admin");
    const after = await loadDeckTextPresets(root);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first.id);
    expect(after[0].overrides).toEqual({ "المعجم": "المصطلحات" });
  });

  it("drops overrides that touch data (digits) or change nothing", async () => {
    const root = createMemoryDirectory();
    const result = await saveDeckTextPreset(
      root,
      "A",
      { "القسم 1 — مجتمع الفحص": "x", "المعجم": "المعجم", "مجتمع الفحص": "نطاق الفحص", "نتائج فحص الجودة": "رقم 5" },
      "admin",
    );
    expect(result.ok).toBe(true);
    expect((await loadDeckTextPresets(root))[0].overrides).toEqual({ "مجتمع الفحص": "نطاق الفحص" });
  });

  it("rejects an empty name or a preset with no valid edits", async () => {
    const root = createMemoryDirectory();
    expect((await saveDeckTextPreset(root, "  ", { "المعجم": "x" }, "admin")).ok).toBe(false);
    expect((await saveDeckTextPreset(root, "A", { "المعجم": "المعجم" }, "admin")).ok).toBe(false);
    expect(await loadDeckTextPresets(root)).toEqual([]);
  });

  it("deletes a preset by id", async () => {
    const root = createMemoryDirectory();
    await saveDeckTextPreset(root, "A", { "المعجم": "x" }, "admin");
    await saveDeckTextPreset(root, "B", { "المعجم": "y" }, "admin");
    const [a] = await loadDeckTextPresets(root);
    const result = await deleteDeckTextPreset(root, a.id, "admin");
    expect(result.ok).toBe(true);
    expect((await loadDeckTextPresets(root)).map((p) => p.name)).toEqual(["B"]);
  });

  it("concurrent saves both survive (CAS serializes the read-modify-write)", async () => {
    const root = createMemoryDirectory();
    await Promise.all([
      saveDeckTextPreset(root, "A", { "المعجم": "x" }, "admin"),
      saveDeckTextPreset(root, "B", { "المعجم": "y" }, "admin"),
    ]);
    expect((await loadDeckTextPresets(root)).map((p) => p.name).sort()).toEqual(["A", "B"]);
  });
});
