import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../../../storage/memoryDirectory";
import { loadDeckStyleChoices, saveDeckStyleChoices } from "./styleChoices";

describe("styleChoices", () => {
  it("returns null when no choices have been saved yet", async () => {
    const root = createMemoryDirectory();
    const loaded = await loadDeckStyleChoices(root);
    expect(loaded).toBeNull();
  });

  it("round-trips saved choices", async () => {
    const root = createMemoryDirectory();
    const result = await saveDeckStyleChoices(root, { "slide-risk-stages": 1 }, "admin");
    expect(result.ok).toBe(true);

    const loaded = await loadDeckStyleChoices(root);
    expect(loaded?.choices).toEqual({ "slide-risk-stages": 1 });
    expect(loaded?.updatedBy).toBe("admin");
    expect(loaded?.revision).toBe(1);
  });

  it("re-saving replaces the choices (last-writer-wins is the intended contract)", async () => {
    const root = createMemoryDirectory();
    await saveDeckStyleChoices(root, { "slide-risk-stages": 1 }, "admin");
    await saveDeckStyleChoices(root, { "slide-risk-stages": 2, "slide-cover": 1 }, "admin2");

    const loaded = await loadDeckStyleChoices(root);
    expect(loaded?.choices).toEqual({ "slide-risk-stages": 2, "slide-cover": 1 });
    expect(loaded?.updatedBy).toBe("admin2");
    expect(loaded?.revision).toBe(2);
  });

  it("serializes concurrent saves via CAS (revision advances past both attempts)", async () => {
    const root = createMemoryDirectory();
    await Promise.all([
      saveDeckStyleChoices(root, { "slide-cover": 1 }, "admin"),
      saveDeckStyleChoices(root, { "slide-cover": 2 }, "admin"),
    ]);
    const loaded = await loadDeckStyleChoices(root);
    expect(loaded?.revision).toBe(2);
  });
});
