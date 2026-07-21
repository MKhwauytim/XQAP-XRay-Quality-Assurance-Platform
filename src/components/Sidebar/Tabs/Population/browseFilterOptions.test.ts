import { describe, expect, it } from "vitest";
import { buildBrowseFilterOptionPreview } from "./browseFilterOptions";

describe("buildBrowseFilterOptionPreview", () => {
  it("keeps selected values visible when unselected options are truncated", () => {
    const rows = Array.from({ length: 150 }, (_, index) => `value-${String(index).padStart(3, "0")}`);
    const selected = "zz-selected";

    const preview = buildBrowseFilterOptionPreview(
      rows,
      [selected],
      (value) => value,
      (first, second) => first.localeCompare(second),
      100,
    );

    expect(preview.options).toHaveLength(100);
    expect(preview.options).toContain(selected);
    expect(preview.truncated).toBe(true);
  });
});
