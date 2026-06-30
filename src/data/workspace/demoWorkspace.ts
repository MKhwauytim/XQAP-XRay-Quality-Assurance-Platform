import {
  createWorkspaceStructure,
  type DirectoryHandleLike
} from "../storage/fileSystemAccess";
import { createMemoryDirectory } from "../storage/memoryDirectory";

/**
 * Build a valid, "ready" in-memory workspace for the demo/viewer account.
 *
 * No real folder or File System Access permission is required — the handle is
 * backed by an in-memory tree, so nothing is ever written to the user's disk.
 * `createWorkspaceStructure` seeds the required folders plus the default
 * managed users, so User Management and role routing are populated out of the
 * box. (Richer seeded population/sample data can be layered on here later.)
 */
/** Name of the in-memory demo directory handle — used to detect demo mode. */
export const DEMO_WORKSPACE_NAME = "Demo-Workspace";

export async function createDemoWorkspace(): Promise<DirectoryHandleLike> {
  const handle = createMemoryDirectory(DEMO_WORKSPACE_NAME);
  await createWorkspaceStructure(handle, "viewer");
  return handle;
}
