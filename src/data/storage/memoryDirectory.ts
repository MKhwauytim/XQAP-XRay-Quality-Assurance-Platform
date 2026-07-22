import type {
  DirectoryHandleLike,
  FileHandleLike
} from "./fileSystemAccess";

function notFound(name: string): Error {
  const error = new Error(`Not found: ${name}`);
  error.name = "NotFoundError";
  return error;
}

function writePermissionDenied(name: string): Error {
  const error = new Error(
    `Simulated write permission not granted for "${name}" — call requestPermission({ mode: "readwrite" }) first.`
  );
  error.name = "NotAllowedError";
  return error;
}

export type SimulatedPermissionState = "granted" | "denied" | "prompt";

export interface MemoryDirectoryOptions {
  /**
   * Initial state `queryPermission({ mode: "readwrite" })` reports. Defaults to
   * "granted" so existing tests that never touch permissions are unaffected.
   * Set to "prompt" (matching a freshly-restored, read-only-by-default remembered
   * workspace — see PR #36) to make any `{ create: true }` call made before a
   * `requestPermission` call throw a simulated `NotAllowedError`, the same way a
   * real browser would.
   */
  initialWritePermission?: SimulatedPermissionState;
  /**
   * State `requestPermission({ mode: "readwrite" })` transitions to. Defaults to
   * "granted" (the user accepts the prompt).
   */
  writePermissionRequestOutcome?: SimulatedPermissionState;
}

type SharedPermission = { state: SimulatedPermissionState; requestOutcome: SimulatedPermissionState };

// Every handle derived from the same createMemoryDirectory() call (root and all
// descendants) shares one SharedPermission, mirroring how a real File System
// Access grant covers the whole picked tree. Keyed by handle identity so tests
// can flip permission on an already-connected directory (e.g. simulating a new
// session reconnecting the same on-disk workspace read-only) without needing a
// second constructor parameter threaded through every call site.
const permissionRegistry = new WeakMap<DirectoryHandleLike, SharedPermission>();

/**
 * Test-only: change the simulated write-permission state of a handle returned
 * by createMemoryDirectory() (root or any descendant obtained from it) after
 * the fact. No-op for a handle that isn't a memory directory.
 */
export function setSimulatedWritePermission(
  dir: DirectoryHandleLike,
  state: SimulatedPermissionState,
  requestOutcome: SimulatedPermissionState = "granted"
): void {
  const permission = permissionRegistry.get(dir);
  if (!permission) return;
  permission.state = state;
  permission.requestOutcome = requestOutcome;
}

type MemoryNode = {
  files: Map<string, { content: string }>;
  dirs: Map<string, MemoryNode>;
};

function createNode(): MemoryNode {
  return { files: new Map(), dirs: new Map() };
}

function makeFileHandle(
  name: string,
  node: MemoryNode
): FileHandleLike {
  return {
    kind: "file",
    name,
    getFile: async () => {
      const entry = node.files.get(name);
      const content = entry ? entry.content : "";
      return new File([content], name, { type: "application/json" });
    },
    createWritable: async () => {
      let buffer = "";
      return {
        write: async (data: string) => {
          buffer += data;
        },
        close: async () => {
          node.files.set(name, { content: buffer });
        }
      };
    }
  };
}

function makeDirectoryHandle(
  name: string,
  node: MemoryNode,
  permission: SharedPermission
): DirectoryHandleLike {
  // Build with extra `values` for in-memory iteration support, then cast
  const handle = {
    kind: "directory" as const,
    name,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (!node.files.has(fileName)) {
        if (!options?.create) {
          throw notFound(fileName);
        }
        if (permission.state !== "granted") {
          throw writePermissionDenied(fileName);
        }
        node.files.set(fileName, { content: "" });
      }
      return makeFileHandle(fileName, node);
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      let child = node.dirs.get(dirName);
      if (!child) {
        if (!options?.create) {
          throw notFound(dirName);
        }
        if (permission.state !== "granted") {
          throw writePermissionDenied(dirName);
        }
        child = createNode();
        node.dirs.set(dirName, child);
      }
      return makeDirectoryHandle(dirName, child, permission);
    },
    removeEntry: async (entryName: string, options?: { recursive?: boolean }) => {
      if (node.files.has(entryName)) {
        node.files.delete(entryName);
        return;
      }
      const child = node.dirs.get(entryName);
      if (child) {
        if (!options?.recursive && (child.files.size > 0 || child.dirs.size > 0)) {
          const error = new Error(`Directory not empty: ${entryName}`);
          error.name = "InvalidModificationError";
          throw error;
        }
        node.dirs.delete(entryName);
        return;
      }
      throw notFound(entryName);
    },
    queryPermission: async (opts?: { mode?: string }) =>
      opts?.mode === "readwrite" ? permission.state : "granted",
    requestPermission: async (opts?: { mode?: string }) => {
      if (opts?.mode === "readwrite") {
        permission.state = permission.requestOutcome;
        return permission.state;
      }
      return "granted";
    },
    values: async function* () {
      for (const [fileName] of node.files) {
        yield { name: fileName, kind: "file" as const };
      }
      for (const [dirName] of node.dirs) {
        yield { name: dirName, kind: "directory" as const };
      }
    }
  };
  const typedHandle = handle as DirectoryHandleLike;
  permissionRegistry.set(typedHandle, permission);
  return typedHandle;
}

export function createMemoryDirectory(
  name = "root",
  options: MemoryDirectoryOptions = {}
): DirectoryHandleLike {
  const permission: SharedPermission = {
    state: options.initialWritePermission ?? "granted",
    requestOutcome: options.writePermissionRequestOutcome ?? "granted"
  };
  return makeDirectoryHandle(name, createNode(), permission);
}
