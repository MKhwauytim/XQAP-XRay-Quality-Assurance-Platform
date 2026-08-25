// src/data/reporting/executive/deckEditionPreference.test.ts
import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../storage/memoryDirectory";
import { loadDeckEditionPreference, saveDeckEditionPreference } from "./deckEditionPreference";

describe("deckEditionPreference", () => {
  it("returns null when nothing has been saved yet", async () => {
    const dir = createMemoryDirectory();
    const result = await loadDeckEditionPreference(dir);
    expect(result).toBeNull();
  });

  it("round-trips a saved edition", async () => {
    const dir = createMemoryDirectory();
    const saveResult = await saveDeckEditionPreference(dir, "v3", "tester");
    expect(saveResult).toEqual({ ok: true });
    const loaded = await loadDeckEditionPreference(dir);
    expect(loaded?.edition).toBe("v3");
    expect(loaded?.updatedBy).toBe("tester");
    expect(loaded?.revision).toBe(1);
  });

  it("bumps the revision on a second save", async () => {
    const dir = createMemoryDirectory();
    await saveDeckEditionPreference(dir, "v3", "tester");
    await saveDeckEditionPreference(dir, "v2", "tester");
    const loaded = await loadDeckEditionPreference(dir);
    expect(loaded?.edition).toBe("v2");
    expect(loaded?.revision).toBe(2);
  });
});
