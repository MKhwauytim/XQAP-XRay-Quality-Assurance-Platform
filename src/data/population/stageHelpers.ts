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

const STAGE_KEY_ORDER = ["first", "second", "third", "fourth"] as const;

// ── Alias-index memoization (hot path) ──────────────────────────────────────
// getStageKey used to re-normalize all ~43 constant aliases on EVERY call, so a
// single pass over a 117k-row month cost ~1.3 s and PhaseThreeSampling's eight
// filter passes cost ~10.3 s. The aliases are constants per mapping table, so
// normalize each table ONCE into an alias -> stageKey lookup and reuse it.
//
// Invalidation — this is the part that must not go wrong. The alias table comes
// from workspace config and an admin CAN edit it (Settings -> mappings), so a
// memo keyed on the wrong thing would keep serving the OLD mapping after an
// edit: a silent data-correctness bug, far worse than the slowness. The cache is
// therefore keyed on the *identity of the caller's argument object* (a WeakMap,
// so an abandoned config is collected with its index) AND revalidated on every
// hit against the four alias arrays that would actually be consulted, by
// reference and by length. Every config edit path in the app rebuilds the object
// immutably (`{ ...config, stageMappings: { ...stageMappings, [key]: [...] } }`),
// which changes both the object identity and the edited array's identity, so a
// stale index cannot survive an edit. A caller that instead mutated an alias
// array in place would still be caught whenever the length changed.
//
// The `undefined` / partial-mapping cases resolve their missing stages from
// DEFAULT_STAGE_MAPPINGS, so the revalidation compares against exactly the
// arrays the lookup was built from — including the defaults.
//
// src/workers/populationQueryWorker.ts carries a deliberate hand-copy of this
// logic (it cannot import this module without dragging populationConfig's
// main-thread dependency graph into the worker bundle). Its
// `formatStageLabelForWorker` mirrors this memoization; keep the two in sync by
// hand, as that file's own header note already requires.
type StageAliasIndex = {
  lookup: Map<string, StageKey>;
  sources: readonly (readonly string[])[];
  /** Lengths captured at build time — comparing `sources[i].length` would compare
   *  the array to itself and see nothing when it is mutated in place. */
  sourceLengths: readonly number[];
};

const stageAliasIndexCache = new WeakMap<object, StageAliasIndex>();

// Stable empty array so the freshness check below compares identities rather
// than allocating a new `[]` (which would never match) on every call.
const NO_ALIASES: readonly string[] = [];

// Exactly reproduces what the old `{ ...DEFAULT_STAGE_MAPPINGS, ...override }`
// merge followed by `mappings[stageKey] ?? []` resolved to — including the
// corner where an override carries the key with an explicit `undefined`, which
// spread copies over the default and which therefore means "no aliases", not
// "fall back to the default".
function aliasesFor(
  stageMappings: Partial<StageAliasMappings> | undefined,
  stageKey: StageKey
): readonly string[] {
  if (stageMappings && Object.prototype.hasOwnProperty.call(stageMappings, stageKey)) {
    return stageMappings[stageKey] ?? NO_ALIASES;
  }
  return DEFAULT_STAGE_MAPPINGS[stageKey] ?? NO_ALIASES;
}

function isIndexFresh(
  index: StageAliasIndex,
  stageMappings: Partial<StageAliasMappings> | undefined
): boolean {
  for (let i = 0; i < STAGE_KEY_ORDER.length; i += 1) {
    const current = aliasesFor(stageMappings, STAGE_KEY_ORDER[i]);
    if (current !== index.sources[i] || current.length !== index.sourceLengths[i]) return false;
  }
  return true;
}

function buildStageAliasIndex(
  stageMappings: Partial<StageAliasMappings> | undefined
): StageAliasIndex {
  const lookup = new Map<string, StageKey>();
  const sources: Array<readonly string[]> = [];
  const sourceLengths: number[] = [];
  for (const stageKey of STAGE_KEY_ORDER) {
    const aliases = aliasesFor(stageMappings, stageKey);
    sources.push(aliases);
    sourceLengths.push(aliases.length);
    for (const alias of aliases) {
      const normalized = normalizeStageToken(alias);
      // First stage in first->fourth order wins, exactly as the original
      // early-returning loop did when the same alias appeared twice.
      if (!lookup.has(normalized)) lookup.set(normalized, stageKey);
    }
  }
  return { lookup, sources, sourceLengths };
}

function getStageAliasIndex(
  stageMappings?: Partial<StageAliasMappings>
): StageAliasIndex {
  // No argument means "defaults only" — cache that under the defaults object so
  // the common call shape shares one index instead of allocating per call.
  const cacheKey: object = stageMappings ?? DEFAULT_STAGE_MAPPINGS;
  const cached = stageAliasIndexCache.get(cacheKey);
  if (cached && isIndexFresh(cached, stageMappings)) return cached;
  const built = buildStageAliasIndex(stageMappings);
  stageAliasIndexCache.set(cacheKey, built);
  return built;
}

export function getStageKey(
  stage: string | null,
  stageMappings?: Partial<StageAliasMappings>
): StageCountKey {
  const up = normalizeStageToken(String(stage ?? ""));
  return getStageAliasIndex(stageMappings).lookup.get(up) ?? "unknown";
}

export function formatStageLabel(
  stage: unknown,
  stageMappings?: Partial<StageAliasMappings>
): string {
  const stageKey = getStageKey(String(stage ?? ""), stageMappings);
  if (stageKey === "unknown") return String(stage ?? "");
  return STAGE_LABELS_AR[stageKey];
}
