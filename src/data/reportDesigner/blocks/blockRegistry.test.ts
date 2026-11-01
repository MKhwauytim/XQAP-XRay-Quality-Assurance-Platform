import { describe, expect, it } from "vitest";
import { DEFAULT_LABELS } from "../../labels/labelsStore";
import { kpiBand } from "../../reporting/executive/deck3/slideKit";
import type { AnyBlockElement, BlockType } from "../reportTypesV2";
import { getBlock, listBlocks, renderBlock } from "./blockRegistry";

const frame = { elementId: "e1", name: "n", x: 0, y: 0, w: 1, h: 1, z: 0 };
function el<T extends BlockType>(type: T, config: ReturnType<typeof getBlock<T>>["defaultConfig"] extends () => infer C ? C : never): AnyBlockElement {
  return { ...frame, type, config } as AnyBlockElement;
}

describe("block registry", () => {
  it("every listed block has a known label key and positive size", () => {
    for (const b of listBlocks()) {
      expect(Object.keys(DEFAULT_LABELS)).toContain(b.labelKey);
      expect(b.defaultSize.w).toBeGreaterThan(0);
      expect(b.defaultSize.h).toBeGreaterThan(0);
    }
  });
  it("kpiBand renders byte-equal to the kit", () => {
    const cells = [{ label: "إجمالي", value: "1", valueTone: "gold" as const }];
    expect(renderBlock(el("kpiBand", { cells, variant: "solo" }))).toBe(kpiBand(cells, "solo"));
  });
  it("richText escapes", () => {
    const html = renderBlock(el("richText", { text: "<script>x</script>" }));
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script");
  });
  it("tintedPanel embeds child html", () => {
    const html = renderBlock(
      el("tintedPanel", { variant: "all", title: "t", childIds: ["a"] }),
      { childHtml: () => "<i>c</i>" },
    );
    expect(html).toContain("<i>c</i>");
  });
  it("legacyChart is a placeholder and not listed", () => {
    expect(renderBlock(el("legacyChart", { original: { kind: "text", text: "" } }))).toContain('data-legacy="1"');
    expect(listBlocks().map((b) => b.type)).not.toContain("legacyChart");
  });
});
