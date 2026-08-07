import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { LEGACY_WORKSPACE_ROOTS, WORKSPACE_ROOTS } from "./workspacePaths";
import {
  detectWorkspaceSchema,
  initializeWorkspaceSchemaMetadata,
} from "./workspaceSchema";

describe("workspace schema detection and metadata migration", () => {
  it("detects current, legacy, and mixed layouts without creating directories", async () => {
    const current = createMemoryDirectory();
    await current.getDirectoryHandle(WORKSPACE_ROOTS.system, { create: true });
    expect((await detectWorkspaceSchema(current)).layout).toBe("current");

    const legacy = createMemoryDirectory();
    await legacy.getDirectoryHandle(LEGACY_WORKSPACE_ROOTS.system, { create: true });
    expect((await detectWorkspaceSchema(legacy)).layout).toBe("legacy");

    await legacy.getDirectoryHandle(WORKSPACE_ROOTS.population, { create: true });
    expect((await detectWorkspaceSchema(legacy)).layout).toBe("mixed");
  });

  it("initializes a complete new workspace without a backup migration", async () => {
    const root = createMemoryDirectory();
    for (const name of Object.values(WORKSPACE_ROOTS)) {
      await root.getDirectoryHandle(name, { create: true });
    }
    const metadata = await initializeWorkspaceSchemaMetadata(root, "admin");
    expect(metadata).toMatchObject({
      layout: "current",
      backupId: "not-required:new-workspace",
      legacyReadersRequired: false,
    });
    expect(await initializeWorkspaceSchemaMetadata(root, "other")).toEqual(metadata);
  });
});
