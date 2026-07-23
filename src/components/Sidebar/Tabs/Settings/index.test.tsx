// B10 — label editor reachability (synthesis medium, Settings/index.tsx:58).
//
// LABEL_GROUPS is a hand-curated list: any DEFAULT_LABELS key added without
// also adding a row to one of these groups used to be permanently invisible
// in the editor (no way to reach it from the Settings UI at all). The
// generated "أخرى" (Other) fallback group closes that gap for every key that
// isn't explicitly claimed. This test is the enforcement mechanism: it fails
// the moment LABEL_GROUPS + the fallback stop covering 100% of DEFAULT_LABELS.
import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS, type LabelKey } from "../../../../data/labels/labelsStore";
import { LABEL_GROUPS, OTHER_LABEL_KEYS } from "./index";

function allExplicitKeys(): LabelKey[] {
  return LABEL_GROUPS.flatMap((group) => group.keys.map((k) => k.key));
}

describe("Settings label groups — full DEFAULT_LABELS reachability", () => {
  it("LABEL_GROUPS union OTHER_LABEL_KEYS covers every DEFAULT_LABELS key exactly once", () => {
    const explicit = allExplicitKeys();
    const union = [...explicit, ...OTHER_LABEL_KEYS].sort();
    const allKeys = (Object.keys(DEFAULT_LABELS) as LabelKey[]).sort();

    expect(union).toEqual(allKeys);
  });

  it("has no key claimed by more than one explicit group (OTHER_LABEL_KEYS would double-count it)", () => {
    const explicit = allExplicitKeys();
    const seen = new Set<LabelKey>();
    const duplicates: LabelKey[] = [];
    for (const key of explicit) {
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });

  it("OTHER_LABEL_KEYS contains no key that is also in an explicit LABEL_GROUPS entry", () => {
    const explicitSet = new Set(allExplicitKeys());
    const overlap = OTHER_LABEL_KEYS.filter((key) => explicitSet.has(key));
    expect(overlap).toEqual([]);
  });

  it("every explicit group key and every fallback key is a real DEFAULT_LABELS key", () => {
    const validKeys = new Set(Object.keys(DEFAULT_LABELS));
    for (const key of allExplicitKeys()) {
      expect(validKeys.has(key)).toBe(true);
    }
    for (const key of OTHER_LABEL_KEYS) {
      expect(validKeys.has(key)).toBe(true);
    }
  });
});
