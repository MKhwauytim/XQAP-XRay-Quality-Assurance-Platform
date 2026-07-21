export type BrowseFilterOptionPreview = {
  options: string[];
  truncated: boolean;
};

export function buildBrowseFilterOptionPreview<TRow>(
  rows: TRow[],
  selectedValues: string[],
  getValue: (row: TRow) => string,
  compare: (first: string, second: string) => number,
  limit: number,
): BrowseFilterOptionPreview {
  const selected = Array.from(new Set(selectedValues)).sort(compare);
  const selectedSet = new Set(selected);
  const unselectedLimit = Math.max(0, limit - selected.length);
  const unselected = new Set<string>();
  let truncated = false;

  for (const row of rows) {
    const value = getValue(row);
    if (selectedSet.has(value)) continue;
    unselected.add(value);
    if (unselected.size > unselectedLimit) {
      truncated = true;
      break;
    }
  }

  return {
    options: [
      ...selected,
      ...Array.from(unselected).sort(compare).slice(0, unselectedLimit),
    ],
    truncated,
  };
}
