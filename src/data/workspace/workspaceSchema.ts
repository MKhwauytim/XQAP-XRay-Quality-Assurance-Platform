import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import { safeReadJson, safeWriteJson } from "../storage/safeWrite";
import { getSystemRoot, LEGACY_WORKSPACE_ROOTS, WORKSPACE_ROOTS } from "./workspacePaths";

export const WORKSPACE_LAYOUT_SCHEMA_VERSION = "1.0.0" as const;
export const WORKSPACE_SCHEMA_METADATA_FILE = "workspace.schema.json";

export type WorkspaceLayoutKind = "current" | "legacy" | "mixed" | "empty";

export type WorkspaceSchemaMetadata = {
  schemaVersion: typeof WORKSPACE_LAYOUT_SCHEMA_VERSION;
  layout: Exclude<WorkspaceLayoutKind, "empty">;
  detectedAt: string;
  migratedAt: string;
  migratedBy: string;
  backupId: string;
  legacyReadersRequired: boolean;
};

export type WorkspaceSchemaDetection = {
  layout: WorkspaceLayoutKind;
  currentRoots: string[];
  legacyRoots: string[];
  missingCurrentRoots: string[];
  metadata: WorkspaceSchemaMetadata | null;
};

export type WorkspaceMigrationPlan = {
  from: WorkspaceLayoutKind;
  toSchemaVersion: typeof WORKSPACE_LAYOUT_SCHEMA_VERSION;
  dryRun: boolean;
  backupRequired: true;
  alreadyApplied: boolean;
  actions: string[];
  blockingIssues: string[];
};

export class WorkspaceMigrationError extends Error {
  readonly code: "backup_required" | "empty_workspace" | "validation_failed";

  constructor(
    code: "backup_required" | "empty_workspace" | "validation_failed",
    message: string
  ) {
    super(message);
    this.name = "WorkspaceMigrationError";
    this.code = code;
  }
}

async function directoryExists(root: DirectoryHandleLike, name: string): Promise<boolean> {
  try {
    await root.getDirectoryHandle(name, { create: false });
    return true;
  } catch {
    return false;
  }
}

async function readSchemaMetadata(root: DirectoryHandleLike): Promise<WorkspaceSchemaMetadata | null> {
  try {
    const systemDir = await getSystemRoot(root, false);
    const result = await safeReadJson<WorkspaceSchemaMetadata>(systemDir, WORKSPACE_SCHEMA_METADATA_FILE);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

/** Read-only detection. It never creates folders and keeps legacy readers active. */
export async function detectWorkspaceSchema(root: DirectoryHandleLike): Promise<WorkspaceSchemaDetection> {
  const currentRoots: string[] = [];
  for (const name of Object.values(WORKSPACE_ROOTS)) {
    if (await directoryExists(root, name)) currentRoots.push(name);
  }
  const legacyRoots: string[] = [];
  for (const name of Object.values(LEGACY_WORKSPACE_ROOTS)) {
    if (await directoryExists(root, name)) legacyRoots.push(name);
  }

  const hasCurrent = currentRoots.length > 0;
  const hasLegacy = legacyRoots.length > 0;
  const layout: WorkspaceLayoutKind = hasCurrent && hasLegacy
    ? "mixed"
    : hasCurrent
      ? "current"
      : hasLegacy
        ? "legacy"
        : "empty";
  return {
    layout,
    currentRoots,
    legacyRoots,
    missingCurrentRoots: Object.values(WORKSPACE_ROOTS).filter((name) => !currentRoots.includes(name)),
    metadata: await readSchemaMetadata(root),
  };
}

export async function planWorkspaceSchemaMigration(
  root: DirectoryHandleLike,
  dryRun = true
): Promise<WorkspaceMigrationPlan> {
  const detected = await detectWorkspaceSchema(root);
  const alreadyApplied = detected.metadata?.schemaVersion === WORKSPACE_LAYOUT_SCHEMA_VERSION
    && detected.metadata.layout === detected.layout;
  const blockingIssues = detected.layout === "empty"
    ? ["No current or legacy workspace roots were found."]
    : detected.layout === "current" && detected.missingCurrentRoots.length > 0
      ? [`Current workspace layout is incomplete: ${detected.missingCurrentRoots.join(", ")}`]
      : [];
  return {
    from: detected.layout,
    toSchemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    dryRun,
    backupRequired: true,
    alreadyApplied,
    actions: alreadyApplied
      ? []
      : ["Record validated workspace layout metadata without moving or deleting legacy data."],
    blockingIssues,
  };
}

/** Stamp a newly created, empty-of-business-data workspace. No backup is needed. */
export async function initializeWorkspaceSchemaMetadata(
  root: DirectoryHandleLike,
  createdBy: string
): Promise<WorkspaceSchemaMetadata> {
  const detected = await detectWorkspaceSchema(root);
  if (detected.metadata?.schemaVersion === WORKSPACE_LAYOUT_SCHEMA_VERSION) {
    return detected.metadata;
  }
  if (detected.layout !== "current" || detected.missingCurrentRoots.length > 0) {
    throw new WorkspaceMigrationError(
      "validation_failed",
      "New workspace schema metadata requires a complete current layout."
    );
  }
  const now = new Date().toISOString();
  const metadata: WorkspaceSchemaMetadata = {
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    layout: "current",
    detectedAt: now,
    migratedAt: now,
    migratedBy: createdBy,
    backupId: "not-required:new-workspace",
    legacyReadersRequired: false,
  };
  const systemDir = await getSystemRoot(root, false);
  await safeWriteJson(systemDir, WORKSPACE_SCHEMA_METADATA_FILE, metadata);
  const verify = await readSchemaMetadata(root);
  if (verify?.schemaVersion !== WORKSPACE_LAYOUT_SCHEMA_VERSION || verify.layout !== "current") {
    throw new WorkspaceMigrationError("validation_failed", "New workspace schema metadata verification failed.");
  }
  return verify;
}

/**
 * Records an explicit schema/layout marker after a caller-confirmed backup.
 *
 * This intentionally does not move legacy directories: copying/moving a whole
 * workspace is not atomic in the File System Access API. Legacy and mixed
 * layouts remain readable, while a future migration tool can use this marker
 * as its validated starting point. Re-running with matching metadata is a
 * no-op, so interrupted workflows are safe to resume.
 */
export async function migrateWorkspaceSchema(params: {
  root: DirectoryHandleLike;
  migratedBy: string;
  backupId?: string;
  backupConfirmed?: boolean;
  dryRun?: boolean;
}): Promise<WorkspaceMigrationPlan> {
  const dryRun = params.dryRun ?? true;
  const plan = await planWorkspaceSchemaMigration(params.root, dryRun);
  if (dryRun) return plan;
  if (plan.blockingIssues.length > 0) {
    throw new WorkspaceMigrationError(
      plan.from === "empty" ? "empty_workspace" : "validation_failed",
      plan.blockingIssues.join(" ")
    );
  }
  if (plan.alreadyApplied) return plan;
  if (!params.backupConfirmed || !params.backupId?.trim()) {
    throw new WorkspaceMigrationError(
      "backup_required",
      "A verified backup id is required before workspace schema metadata is written."
    );
  }

  const detected = await detectWorkspaceSchema(params.root);
  if (detected.layout === "empty") {
    throw new WorkspaceMigrationError("empty_workspace", "Workspace layout changed during migration.");
  }
  const now = new Date().toISOString();
  const metadata: WorkspaceSchemaMetadata = {
    schemaVersion: WORKSPACE_LAYOUT_SCHEMA_VERSION,
    layout: detected.layout,
    detectedAt: now,
    migratedAt: now,
    migratedBy: params.migratedBy,
    backupId: params.backupId.trim(),
    legacyReadersRequired: detected.layout !== "current",
  };
  const systemDir = await getSystemRoot(params.root, false);
  await safeWriteJson(systemDir, WORKSPACE_SCHEMA_METADATA_FILE, metadata);

  const verify = await detectWorkspaceSchema(params.root);
  if (
    verify.metadata?.schemaVersion !== WORKSPACE_LAYOUT_SCHEMA_VERSION
    || verify.metadata.layout !== detected.layout
    || verify.metadata.backupId !== metadata.backupId
  ) {
    throw new WorkspaceMigrationError("validation_failed", "Workspace schema metadata verification failed.");
  }
  return { ...plan, alreadyApplied: true, actions: [] };
}
