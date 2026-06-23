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

export function getStageKey(
  stage: string | null,
  stageMappings?: Partial<StageAliasMappings>
): keyof StageCounts {
  const text = String(stage ?? "").trim();
  const up = normalizeStageToken(text);
  const mappings = {
    ...DEFAULT_STAGE_MAPPINGS,
    ...(stageMappings ?? {})
  };

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
