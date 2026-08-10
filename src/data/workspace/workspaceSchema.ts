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
