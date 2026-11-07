import type { AnyBlockElement, BlockType } from "../reportTypesV2";
import { BLOCK_DEFINITIONS } from "./blockDefinitions";
import type { BlockDefinition, RenderCtx } from "./blockDefinitions";

export type { BlockDefinition, RenderCtx } from "./blockDefinitions";

export function getBlock<T extends BlockType>(type: T): BlockDefinition<T> {
  return BLOCK_DEFINITIONS[type];
}

/** Palette blocks: every type except the read-only legacyChart placeholder. */
export function listBlocks(): BlockDefinition<BlockType>[] {
  const out: BlockDefinition<BlockType>[] = [];
  for (const def of Object.values(BLOCK_DEFINITIONS)) {
    if (def.type !== "legacyChart") out.push(def as BlockDefinition<BlockType>);
  }
  return out;
}

export function renderBlock(el: AnyBlockElement, ctx: RenderCtx = {}): string {
  switch (el.type) {
    case "kpiBand": return BLOCK_DEFINITIONS.kpiBand.render(el.config, ctx);
    case "tintedPanel": return BLOCK_DEFINITIONS.tintedPanel.render(el.config, ctx);
    case "dataTable": return BLOCK_DEFINITIONS.dataTable.render(el.config, ctx);
    case "barChart": return BLOCK_DEFINITIONS.barChart.render(el.config, ctx);
    case "groupedBarChart": return BLOCK_DEFINITIONS.groupedBarChart.render(el.config, ctx);
    case "sectionHeader": return BLOCK_DEFINITIONS.sectionHeader.render(el.config, ctx);
    case "divider": return BLOCK_DEFINITIONS.divider.render(el.config, ctx);
    case "line": return BLOCK_DEFINITIONS.line.render(el.config, ctx);
    case "richText": return BLOCK_DEFINITIONS.richText.render(el.config, ctx);
    case "image": return BLOCK_DEFINITIONS.image.render(el.config, ctx);
    case "legacyChart": return BLOCK_DEFINITIONS.legacyChart.render(el.config, ctx);
  }
}
