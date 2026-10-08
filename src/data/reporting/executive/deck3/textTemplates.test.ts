import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../../storage/memoryDirectory";
import type { DirectoryHandleLike } from "../../../storage/fileSystemAccess";
import {
  MAX_DECK_TEXT_TEMPLATES,
  deleteDeckTextTemplate,
  loadDeckTextTemplates,
  saveDeckTextTemplate,
} from "./textTemplates";

const entries = { "s1|0|0": { from: "أ", to: "ب" } };
const fresh = (): DirectoryHandleLike => createMemoryDirectory("root") as unknown as DirectoryHandleLike;

describe("deck text templates storage", () => {
  it("returns an empty list when nothing was saved", async () => {
    expect(await loadDeckTextTemplates(fresh())).toEqual([]);
  });

  it("round-trips a template and lists the newest first", async () => {
    const dir = fresh();
    const first = await saveDeckTextTemplate(dir, "الأول", entries, "u1");
    expect(first.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    await saveDeckTextTemplate(dir, "الثاني", entries, "u2");
    const list = await loadDeckTextTemplates(dir);
    expect(list.map((t) => t.name)).toEqual(["الثاني", "الأول"]);
    expect(list[1]).toMatchObject({ entries, createdBy: "u1" });
  });

  it("replaces a same-name template instead of duplicating it", async () => {
    const dir = fresh();
    await saveDeckTextTemplate(dir, "قالب", entries, "u1");
    await saveDeckTextTemplate(dir, "قالب", { "s2|0|0": { from: "x", to: "y" } }, "u2");
    const list = await loadDeckTextTemplates(dir);
    expect(list).toHaveLength(1);
    expect(list[0].entries).toEqual({ "s2|0|0": { from: "x", to: "y" } });
  });

  it("rejects an empty name and an empty edit set", async () => {
    const dir = fresh();
    expect((await saveDeckTextTemplate(dir, "   ", entries, "u")).ok).toBe(false);
    expect((await saveDeckTextTemplate(dir, "اسم", {}, "u")).ok).toBe(false);
    expect(await loadDeckTextTemplates(dir)).toEqual([]);
  });

  it("deletes by id and caps the list", async () => {
    const dir = fresh();
    const saved = await saveDeckTextTemplate(dir, "حذف", entries, "u");
    if (!saved.ok) throw new Error("save failed");
    expect((await deleteDeckTextTemplate(dir, saved.template.id)).ok).toBe(true);
    expect(await loadDeckTextTemplates(dir)).toEqual([]);
    for (let i = 0; i < MAX_DECK_TEXT_TEMPLATES + 3; i++) await saveDeckTextTemplate(dir, `ق${i}`, entries, "u");
    expect(await loadDeckTextTemplates(dir)).toHaveLength(MAX_DECK_TEXT_TEMPLATES);
  });
});
