// Canonical stage (المستوى) keys, Arabic labels and display order — the ONE
// definition (C1, 2026-09-28 corrective plan). Every module that needs a stage
// label, the first→fourth order or a stage comparator imports it from here
// (directly, or through stageHelpers.ts which re-exports all of it) instead of
// re-typing its own copy.
//
// Deliberately dependency-free (a single `import type`, erased at build), so
// src/workers/populationQueryWorker.ts can import it without dragging
// populationConfig.ts's main-thread graph into the worker bundle.
//
// The four levels are CATEGORICAL, not a severity ranking: "canonical order"
// is only the display order first→fourth used everywhere.
import type { StageKey } from "./populationConfig";

/** The four mapped levels, in display order. */
export const STAGE_KEY_ORDER = ["first", "second", "third", "fourth"] as const satisfies readonly StageKey[];

/** `STAGE_KEY_ORDER` plus the "unknown" bucket `getStageKey` returns for a blank or unmapped value. */
export const STAGE_COUNT_KEY_ORDER = [...STAGE_KEY_ORDER, "unknown"] as const;

/** Arabic display label per level. */
export const STAGE_LABELS_AR: Readonly<Record<StageKey, string>> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};

/** Label of the "unknown" bucket (a blank or unmapped stage value). */
export const STAGE_UNKNOWN_LABEL = "غير محدد";

export function isCanonicalStageKey(key: string): key is StageKey {
  return (STAGE_KEY_ORDER as readonly string[]).includes(key);
}

/** Arabic label for a level key; «غير محدد» for "unknown"; any other string unchanged. */
export function stageLabelForKey(key: string): string {
  if (isCanonicalStageKey(key)) return STAGE_LABELS_AR[key];
  if (key === "unknown") return STAGE_UNKNOWN_LABEL;
  return key;
}

function stageKeyRank(key: string): number {
  const index = (STAGE_COUNT_KEY_ORDER as readonly string[]).indexOf(key);
  return index === -1 ? STAGE_COUNT_KEY_ORDER.length : index;
}

/**
 * Canonical comparator for stage keys: first→fourth, then "unknown", then any
 * other string (ties broken by plain string order so the result is
 * deterministic).
 */
export function compareStageKeys(a: string, b: string): number {
  const diff = stageKeyRank(a) - stageKeyRank(b);
  if (diff !== 0) return diff;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 1–4 for an Arabic level label, `undefined` for anything else (filter-option ordering). */
export function stageLabelRank(label: string): number | undefined {
  const index = STAGE_KEY_ORDER.findIndex((key) => STAGE_LABELS_AR[key] === label);
  return index === -1 ? undefined : index + 1;
}
