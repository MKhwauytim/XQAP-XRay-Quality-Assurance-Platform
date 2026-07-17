import { describe, expect, it } from "vitest";
import { createMemoryDirectory } from "../storage/memoryDirectory";
import { LEGACY_WORKSPACE_ROOTS, WORKSPACE_ROOTS } from "./workspacePaths";
import {
  detectWorkspaceSchema,
  initializeWorkspaceSchemaMetadata,
  migrateWorkspaceSchema,
  WORKSPACE_LAYOUT_SCHEMA_VERSION,
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

  it("dry-runs without writing and requires a verified backup to apply", async () => {
    const root = createMemoryDirectory();
    for (const name of Object.values(WORKSPACE_ROOTS)) {
      await root.getDirectoryHandle(name, { create: true });
    }

    const dryRun = await migrateWorkspaceSchema({ root, migratedBy: "admin" });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.backupRequired).toBe(true);
    expect((await detectWorkspaceSchema(root)).metadata).toBeNull();

    await expect(
      migrateWorkspaceSchema({ root, migratedBy: "admin", dryRun: false })
    ).rejects.toMatchObject({ code: "backup_required" });
  });

  it("records validated metadata idempotently and keeps legacy layout in place", async () => {
    const root = createMemoryDirectory();
    await root.getDirectoryHandle(LEGACY_WORKSPACE_ROOTS.system, { create: true });
    await root.getDirectoryHandle(LEGACY_WORKSPACE_ROOTS.population, { create: true });

    const applied = await migrateWorkspaceSchema({
      root,
      migratedBy: "admin",
      backupConfirmed: true,
      backupId: "backup-2026-07-17",
      dryRun: false,
    });
    expect(applied.alreadyApplied).toBe(true);
    const detected = await detectWorkspaceSchema(root);
    expect(detected.layout).toBe("legacy");
    expect(detected.metadata).toMatchObject({
      schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
      layout: "legacy",
      backupId: "backup-2026-07-17",
      legacyReadersRequired: true,
    });

    const second = await migrateWorkspaceSchema({
      root,
      migratedBy: "another-admin",
      dryRun: false,
    });
    expect(second.actions).toEqual([]);
    expect((await detectWorkspaceSchema(root)).metadata?.backupId).toBe("backup-2026-07-17");
    await expect(root.getDirectoryHandle(WORKSPACE_ROOTS.system, { create: false })).rejects.toThrow();
  });

  it("refuses to stamp an empty directory", async () => {
    const root = createMemoryDirectory();
    await expect(migrateWorkspaceSchema({
      root,
      migratedBy: "admin",
      backupConfirmed: true,
      backupId: "backup-1",
      dryRun: false,
    })).rejects.toMatchObject({ code: "empty_workspace" });
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
