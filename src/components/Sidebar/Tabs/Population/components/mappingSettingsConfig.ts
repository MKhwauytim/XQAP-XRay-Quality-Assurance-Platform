import type {
  PopulationConfig,
  ProcessingWorkflowStep,
  StageKey,
} from "../../../../../data/population/populationConfig";

export function parseMappingAliases(value: string): string[] {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
}

export const STAGE_KEY_LABELS: Record<StageKey, string> = {
  first: "المستوى الأول",
  second: "المستوى الثاني",
  third: "المستوى الثالث",
  fourth: "المستوى الرابع",
};

const STAGE_KEYS: StageKey[] = ["first", "second", "third", "fourth"];

/**
 * System field keys whose value is derived entirely from the workbook sheet name
 * (`detectMovementType` in `riskDataWorkbook.ts`), never from a column alias. The discovered-
 * columns UI (`ColumnHints` in `MappingSettingsSecondarySections.tsx`) must not report these as
 * "no clear match found" — a column alias can never exist for them, so that warning would
 * describe a structurally impossible match as a user-fixable problem.
 */
export const SHEET_DERIVED_FIELD_KEYS: ReadonlySet<string> = new Set(["movementType"]);

/**
 * Which kind of thing an alias list is matched against. Aliases only ever compete within one
 * namespace, never across:
 *
 * - `"column"` aliases are matched against **column header names** in the imported workbook.
 * - `"stage-value"` aliases are matched against **the value inside a cell** to classify a row's
 *   stage.
 *
 * The same literal string can legitimately appear in both. `"المستوى الاول"` is shipped as a
 * column-header alias for `xrayLevelOneResult` *and* as a stage-value alias for `first`, and both
 * are correct: a column titled "المستوى الاول" holds the level-one result, while a cell containing
 * "المستوى الاول" denotes the first stage. Comparing across namespaces would flag the shipped
 * defaults as broken — and a warning that is always wrong trains users to ignore every warning.
 */
export type AliasNamespace = "column" | "stage-value";

export type AliasFieldGroup = {
  /** Unique identifier for the target field — a system/custom field key, or `stage:<StageKey>`. */
  key: string;
  /** Arabic label shown to the user, e.g. "نتيجة المستوى الأول للأشعة" or "المستوى (تصنيف) — المستوى الأول". */
  label: string;
  /** What this list is matched against. Overlap is only meaningful within one namespace. */
  namespace: AliasNamespace;
  aliases: string[];
};

/**
 * Pools every alias list configured across the app into "target field -> its configured aliases"
 * groups, each tagged with the namespace it is matched in: each system/custom field's Risk + BI
 * column aliases (matching how `buildColumnHintsFromRows` already pools them for column-hint
 * matching), plus each of the four stage-classification value lists (`config.stageMappings`).
 */
export function buildAliasFieldGroups(config: PopulationConfig): AliasFieldGroup[] {
  const template = config.mappingTemplates[0];

  const fieldGroups: AliasFieldGroup[] = [
    ...config.systemFields,
    ...config.customFields,
  ].map((field) => ({
    key: field.key,
    label: field.labelAr,
    namespace: "column" as const,
    aliases: Array.from(
      new Set([
        ...(template?.columnMappings[field.key] ?? []),
        ...(template?.biColumnMappings?.[field.key] ?? []),
      ]),
    ),
  }));

  const stageGroups: AliasFieldGroup[] = STAGE_KEYS.map((stageKey) => ({
    key: `stage:${stageKey}`,
    label: `تصنيف المستوى — ${STAGE_KEY_LABELS[stageKey]}`,
    namespace: "stage-value" as const,
    aliases: config.stageMappings?.[stageKey] ?? [],
  }));

  return [...fieldGroups, ...stageGroups];
}

export type AliasOverlapWarning = {
  alias: string;
  fields: { key: string; label: string }[];
};

/**
 * Detects when the exact same alias string is configured under more than one target field
 * **within the same namespace** — a state the source defaults never produce, and which is most
 * likely evidence of a corrupted edit (e.g. the trailing-comma input bug clobbering one field's
 * list with fragments meant for another). This never auto-repairs; it only surfaces the conflict
 * so a human can resolve it.
 *
 * Cross-namespace repeats are **not** conflicts — see `AliasNamespace`. A column-header alias and
 * a stage-value alias are matched against entirely different things and can share a string
 * legitimately, as the shipped defaults do.
 */
export function findAliasOverlaps(groups: AliasFieldGroup[]): AliasOverlapWarning[] {
  const aliasToGroups = new Map<string, AliasFieldGroup[]>();

  for (const group of groups) {
    for (const rawAlias of group.aliases) {
      const alias = rawAlias.trim();
      if (!alias) continue;
      // Namespace-scoped key: the same string under `column` and `stage-value` never collides.
      const scopedAlias = `${group.namespace}::${alias}`;
      const existing = aliasToGroups.get(scopedAlias);
      if (existing) {
        existing.push(group);
      } else {
        aliasToGroups.set(scopedAlias, [group]);
      }
    }
  }

  const warnings: AliasOverlapWarning[] = [];
  for (const [scopedAlias, groupsForAlias] of aliasToGroups) {
    const uniqueByKey = Array.from(
      new Map(groupsForAlias.map((group) => [group.key, group])).values(),
    );
    if (uniqueByKey.length > 1) {
      warnings.push({
        // Strip the `namespace::` prefix added above — the user sees the bare alias they typed.
        // `indexOf` (not `split`) because an alias may itself contain "::".
        alias: scopedAlias.slice(scopedAlias.indexOf("::") + 2),
        fields: uniqueByKey.map((group) => ({ key: group.key, label: group.label })),
      });
    }
  }

  return warnings.sort((a, b) => a.alias.localeCompare(b.alias));
}

export function mergeMappingAliases(
  current: Record<string, string[]> = {},
  hints: Record<string, string[]> = {},
): Record<string, string[]> {
  const mergedMappings = { ...current };
  for (const [fieldKey, aliases] of Object.entries(hints)) {
    mergedMappings[fieldKey] = Array.from(
      new Set([...(mergedMappings[fieldKey] ?? []), ...aliases]),
    );
  }
  return mergedMappings;
}

export function normalizeWorkflowOrders(
  steps: ProcessingWorkflowStep[],
): ProcessingWorkflowStep[] {
  return steps.map((step, index) => ({
    ...step,
    order: (index + 1) * 10,
  }));
}
