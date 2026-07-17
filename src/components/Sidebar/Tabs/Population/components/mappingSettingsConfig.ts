import type {
  ProcessingWorkflowStep,
} from "../../../../../data/population/populationConfig";

export function parseMappingAliases(value: string): string[] {
  return value
    .split(",")
    .map((alias) => alias.trim())
    .filter(Boolean);
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
