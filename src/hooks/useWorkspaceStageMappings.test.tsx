/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createMemoryDirectory } from "../data/storage/memoryDirectory";
import {
  DEFAULT_POPULATION_CONFIG,
  DEFAULT_STAGE_MAPPINGS,
  savePopulationConfig,
} from "../data/population/populationConfig";
import { broadcastDataRefresh } from "../data/workspace/dataRefreshSignal";
import { useWorkspaceStageMappings } from "./useWorkspaceStageMappings";

async function seed(root: ReturnType<typeof createMemoryDirectory>, alias: string): Promise<void> {
  const saved = await savePopulationConfig(root, {
    ...DEFAULT_POPULATION_CONFIG,
    stageMappings: { ...DEFAULT_STAGE_MAPPINGS, second: [...DEFAULT_STAGE_MAPPINGS.second, alias] },
  });
  if (!saved.ok) throw new Error(saved.error);
}

describe("useWorkspaceStageMappings", () => {
  it("loads the workspace table and re-reads it on a manual refresh", async () => {
    const root = createMemoryDirectory("root");
    await seed(root, "ALIAS-1");
    const { result } = renderHook(() => useWorkspaceStageMappings(root));
    await waitFor(() => expect(result.current?.second).toContain("ALIAS-1"));

    await seed(root, "ALIAS-2");
    act(() => broadcastDataRefresh("manual"));
    await waitFor(() => expect(result.current?.second).toContain("ALIAS-2"));
  });

  it("stays undefined without a workspace", () => {
    const { result } = renderHook(() => useWorkspaceStageMappings(null));
    expect(result.current).toBeUndefined();
  });
});
