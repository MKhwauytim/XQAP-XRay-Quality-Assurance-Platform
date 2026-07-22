import { createContext } from "react";

import type { DirectoryHandleLike } from "../storage/fileSystemAccess";
import type {
  WorkspaceLoadedFiles,
  WorkspaceStatus
} from "./workspaceTypes";

export type WorkspaceContextValue = {
  status: WorkspaceStatus;
  directoryHandle: DirectoryHandleLike | null;
  selectedDirectoryName: string;
  loadedFiles: WorkspaceLoadedFiles;
  missingItems: string[];
  invalidItems: string[];
  message: string;
  isSupported: boolean;
  pendingReconnect: boolean;
  /**
   * True once the current workspace connection's on-disk managed-user list
   * (`users.permissions.json`) has been synced into the in-memory
   * user-management runtime state at least once (see `applyDiskUsers` in
   * WorkspaceProvider). `status` can already read "ready" for a render or two
   * before that sync actually runs (it happens after an additional
   * `loadWorkspaceFiles` await), so consumers that need to validate a
   * persisted session's user against `getManagedLoginUsers()` must gate that
   * check on this flag instead of on `status === "ready"` — otherwise they can
   * only ever see the default seed users and wrongly treat a legitimate
   * session as stale (the startup session-drop race). Optional so existing
   * hand-rolled test stubs of WorkspaceContextValue keep compiling; the real
   * WorkspaceProvider always supplies it.
   */
  usersHydrated?: boolean;
  selectWorkspace: () => Promise<void>;
  reconnectWorkspace: () => Promise<void>;
  reloadWorkspace: () => Promise<void>;
  createInitialStructure: (username: string) => Promise<void>;
  clearWorkspace: () => void;
  /** Mount a read-only, in-memory demo workspace (the viewer account). */
  enterDemoWorkspace: () => Promise<void>;
};

// manifest / sampleMaster / sampleDistribution are always null: the root-level
// workspace.manifest.json / sample.master.json / sample.distribution.json
// paths these once mapped to don't exist under the current numbered layout
// (1-population/, 2-samples/, ...), and nothing reads these three
// WorkspaceLoadedFiles fields — only usersPermissions is consumed (by
// applyDiskUsers). loadWorkspaceFiles (fileSystemAccess.ts) no longer reads
// them from disk; a full type-level removal would touch workspaceTypes.ts,
// which is outside this change's scope.
export const emptyLoadedFiles: WorkspaceLoadedFiles = {
  manifest: null,
  usersPermissions: null,
  sampleMaster: null,
  sampleDistribution: null
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null
);