import { DEFAULT_STAGE_MAPPINGS } from "./populationConfig";
import type { StageKey, StageAliasMappings } from "./populationConfig";

export type { StageKey, StageAliasMappings };

export type StageCounts = {
  first: number;
  second: number;
  third: number;
  fourth: number;
  unknown: number;
};

// The real return type of getStageKey (5 values, including "unknown") — as
// opposed to the narrower 4-value StageKey re-exported above, which only
// covers the mapped/known stages. Consumers that must handle every row
// (e.g. a partitioned index) need this wider type, not StageKey.
export type StageCountKey = keyof StageCounts;

const STAGE_LABELS_AR: Record<StageKey, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع"
};

function normalizeStageToken(value: string): string {
  return value
    .trim()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ـ]/g, "")
    .replace(/[\s_]+/g, "_")
    .toUpperCase();
}

export function createEmptyStageCounts(): StageCounts {
  return { first: 0, second: 0, third: 0, fourth: 0, unknown: 0 };
}

// Single source of truth for "defaults + override" merge, so any code that
// needs to reason about the mappings getStageKey will actually use (e.g. to
// hash them for staleness detection) resolves them identically.
export function resolveStageMappings(
  stageMappings?: Partial<StageAliasMappings>
): StageAliasMappings {
  return {
    ...DEFAULT_STAGE_MAPPINGS,
    ...(stageMappings ?? {})
  };
}

export function getStageKey(
  stage: string | null,
  stageMappings?: Partial<StageAliasMappings>
): StageCountKey {
  const text = String(stage ?? "").trim();
  const up = normalizeStageToken(text);
  const mappings = resolveStageMappings(stageMappings);

  for (const stageKey of ["first", "second", "third", "fourth"] as const) {
    const aliases = mappings[stageKey] ?? [];
    if (aliases.some((alias) => normalizeStageToken(alias) === up)) {
      return stageKey;
    }
  }

  return "unknown";
}

export function formatStageLabel(
  stage: unknown,
  stageMappings?: Partial<StageAliasMappings>
): string {
  const stageKey = getStageKey(String(stage ?? ""), stageMappings);
  if (stageKey === "unknown") return String(stage ?? "");
  return STAGE_LABELS_AR[stageKey];
}
