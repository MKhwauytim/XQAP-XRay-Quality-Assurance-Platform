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
  selectWorkspace: () => Promise<void>;
  reconnectWorkspace: () => Promise<void>;
  reloadWorkspace: () => Promise<void>;
  createInitialStructure: (username: string) => Promise<void>;
  clearWorkspace: () => void;
  /** Mount a read-only, in-memory demo workspace (the viewer account). */
  enterDemoWorkspace: () => Promise<void>;
};

export const emptyLoadedFiles: WorkspaceLoadedFiles = {
  manifest: null,
  usersPermissions: null,
  sampleMaster: null,
  sampleDistribution: null
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(
  null
);