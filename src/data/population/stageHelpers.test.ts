import { expect, test } from "vitest";

import { resolveStageMappings, getStageKey } from "./stageHelpers";
import { DEFAULT_STAGE_MAPPINGS } from "./populationConfig";

test("resolveStageMappings returns the defaults when no override is given", () => {
  expect(resolveStageMappings()).toEqual(DEFAULT_STAGE_MAPPINGS);
});

test("resolveStageMappings merges a partial override on top of the defaults", () => {
  const resolved = resolveStageMappings({ first: ["مرحلة اولى مخصصة"] });

  expect(resolved.first).toEqual(["مرحلة اولى مخصصة"]);
  expect(resolved.second).toEqual(DEFAULT_STAGE_MAPPINGS.second);
});

test("resolveStageMappings is exactly what getStageKey uses internally (same resolution for the same inputs)", () => {
  const override = { first: ["CUSTOM-FIRST"] };
  const resolved = resolveStageMappings(override);

  expect(getStageKey("CUSTOM-FIRST", override)).toBe("first");
  expect(resolved.first).toContain("CUSTOM-FIRST");
});

// ── Alias-index memoization: correctness of the cache invalidation ──────────
// getStageKey memoizes the normalized alias table per mapping object. The alias
// table comes from workspace config and an admin CAN edit it (Settings ->
// mappings), so a stale index would silently misclassify every row from then on.
// These tests pin the invalidation, not the speed.

test("memoized alias index: a rebuilt mappings object (the shape every config edit produces) takes effect immediately", () => {
  const before = { ...DEFAULT_STAGE_MAPPINGS, third: ["THIRD_STAGE"] };
  expect(getStageKey("L3", before)).toBe("unknown");
  expect(getStageKey("THIRD_STAGE", before)).toBe("third");

  // Exactly what useMappingSettingsController does: spread the config, spread the
  // stage mappings, replace the edited stage's array.
  const after = { ...before, third: [...before.third, "L3"] };
  expect(getStageKey("L3", after)).toBe("third");

  // ...and the pre-edit object still resolves by its own (unchanged) table.
  expect(getStageKey("L3", before)).toBe("unknown");
});

test("memoized alias index: an in-place edit of the SAME mappings object is not served stale", () => {
  const mappings: { first: string[]; second: string[]; third: string[]; fourth: string[] } = {
    first: ["FIRST_STAGE"],
    second: ["SECOND_STAGE"],
    third: ["THIRD_STAGE"],
    fourth: ["FOURTH_STAGE"]
  };

  expect(getStageKey("L3", mappings)).toBe("unknown"); // populates the cache

  // Same object identity, replaced array — the per-hit revalidation compares the
  // alias arrays by reference, so this is caught.
  mappings.third = ["THIRD_STAGE", "L3"];
  expect(getStageKey("L3", mappings)).toBe("third");
  expect(getStageKey("THIRD_STAGE", mappings)).toBe("third");

  // Same object identity AND same array identity, mutated by push — caught by the
  // length half of the revalidation.
  mappings.third.push("LEVEL-THREE");
  expect(getStageKey("LEVEL-THREE", mappings)).toBe("third");

  // Removing an alias in place is equally visible.
  mappings.third = ["THIRD_STAGE"];
  expect(getStageKey("L3", mappings)).toBe("unknown");
});

test("memoized alias index: two different mapping tables never bleed into each other", () => {
  const a = { ...DEFAULT_STAGE_MAPPINGS, first: ["ONLY-IN-A"] };
  const b = { ...DEFAULT_STAGE_MAPPINGS, first: ["ONLY-IN-B"] };

  // Interleave so a shared single-slot cache would show up as a wrong answer.
  expect(getStageKey("ONLY-IN-A", a)).toBe("first");
  expect(getStageKey("ONLY-IN-A", b)).toBe("unknown");
  expect(getStageKey("ONLY-IN-B", b)).toBe("first");
  expect(getStageKey("ONLY-IN-B", a)).toBe("unknown");
  expect(getStageKey("ONLY-IN-A", a)).toBe("first");
});

test("memoized alias index: a partial override still resolves its untouched stages from the defaults", () => {
  const partial = { third: ["L3"] };
  expect(getStageKey("L3", partial)).toBe("third");
  expect(getStageKey("THIRD_STAGE", partial)).toBe("unknown"); // override replaces, not merges
  expect(getStageKey("FIRST_STAGE", partial)).toBe("first"); // untouched stage -> defaults
  expect(getStageKey("المستوى الرابع", partial)).toBe("fourth");
});

test("memoized alias index: an explicit-undefined stage means 'no aliases', matching the old spread-then-?? [] merge", () => {
  const override = { first: undefined } as Partial<typeof DEFAULT_STAGE_MAPPINGS>;
  expect(getStageKey("FIRST_STAGE", override)).toBe("unknown");
  expect(getStageKey("SECOND_STAGE", override)).toBe("second");
});

test("memoized alias index: repeated calls stay consistent and the earlier-listed stage still wins a duplicated alias", () => {
  const overlapping = {
    first: ["SHARED"],
    second: ["SHARED"],
    third: ["THIRD_STAGE"],
    fourth: ["FOURTH_STAGE"]
  };
  for (let i = 0; i < 5; i += 1) {
    expect(getStageKey("SHARED", overlapping)).toBe("first");
  }
});

test("memoized alias index: the real-world misspellings and Arabic normalization forms still classify", () => {
  expect(getStageKey("SECOND_STAG")).toBe("second");
  expect(getStageKey("FORTH_STAGE")).toBe("fourth");
  expect(getStageKey("FORTH STAGE")).toBe("fourth");
  expect(getStageKey("المستوى الأول")).toBe("first");
  expect(getStageKey("المستوي الاول")).toBe("first");
  expect(getStageKey("  stage 1  ")).toBe("first");
  expect(getStageKey(null)).toBe("unknown");
});
