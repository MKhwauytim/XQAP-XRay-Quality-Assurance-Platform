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
  /**
   * Opt-in, defaults to false so the other ~160 existing test files that build
   * a memory directory are completely unaffected. When true, every `getFile()`
   * call on a handle from this tree appends its full path (relative to the
   * root, "/"-joined) to a read log retrievable via `getReadLog(dir)`. Used to
   * assert acceptance criteria like "this load performed no read of
   * population.final.json" that can't be distinguished from "read it and
   * discarded it" by inspecting returned values alone.
   */
  trackReads?: boolean;
  /**
   * Opt-in fault injection (defaults to none, so every existing test is
   * unaffected). See SimulatedFault — this is how a UNC/SMB share's transient
   * NotFoundError is reproduced deterministically.
   */
  faults?: SimulatedFault[];
  /**
   * Opt-in operation log: records every getFileHandle / getDirectoryHandle /
   * getFile / createWritable call against this tree, retrievable via
   * `getOperationLog(dir)`. Needed to assert *how many* attempts an operation
   * made — the difference between "an absent file resolved to null" and "an
   * absent file resolved to null after burning the whole retry budget" is
   * invisible in the returned value and only shows up as latency.
   */
  trackOperations?: boolean;
}

/**
 * A deterministic stand-in for a flaky network share.
 *
 * The bug this exists for (see transientFileErrors.ts) is that on a UNC/SMB
 * share, `getFileHandle` can raise NotFoundError for a file whose bytes are
 * already durably written — the client's directory listing simply has not
 * caught up. `times` is what makes that reproducible: throw for the first N
 * matching calls, then behave normally, exactly like a listing that refreshes
 * a few milliseconds later.
 */
export type SimulatedFault = {
  /** Which handle method to fail. */
  operation: "getFileHandle" | "getDirectoryHandle" | "getFile" | "createWritable";
  /**
   * Entry name to match. Omit to match every name. For `getFile` /
   * `createWritable` this is the file handle's own name.
   */
  name?: string;
  /**
   * Match by name suffix instead of an exact name — for entries whose name is
   * generated at runtime (the distribution event segments are
   * `{deviceId}-{sessionId}.ndjson`, so only the suffix is knowable in a test).
   */
  nameSuffix?: string;
  /** Only match calls with this `create` flag. Omit to match either. */
  create?: boolean;
  /** DOMException `name` to throw. Defaults to "NotFoundError". */
  errorName?: string;
  /**
   * How many matching calls to fail before letting them through. Defaults to
   * 1. Use `Number.POSITIVE_INFINITY` for a permanent failure.
   */
  times?: number;
};

type FaultState = { faults: SimulatedFault[]; consumed: number[] };
type OperationLogState = { entries: OperationLogEntry[] };

export type OperationLogEntry = {
  operation: SimulatedFault["operation"];
  name: string;
  create?: boolean;
};

type SharedPermission = { state: SimulatedPermissionState; requestOutcome: SimulatedPermissionState };
type ReadLogState = { entries: string[] };

// Every handle derived from the same createMemoryDirectory() call (root and all
// descendants) shares one SharedPermission, mirroring how a real File System
// Access grant covers the whole picked tree. Keyed by handle identity so tests
// can flip permission on an already-connected directory (e.g. simulating a new
// session reconnecting the same on-disk workspace read-only) without needing a
// second constructor parameter threaded through every call site.
const permissionRegistry = new WeakMap<DirectoryHandleLike, SharedPermission>();

// Same sharing shape as permissionRegistry, but only populated when
// `trackReads` is enabled (see MemoryDirectoryOptions.trackReads).
const readLogRegistry = new WeakMap<DirectoryHandleLike, ReadLogState>();

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

/**
 * Test-only: full-path read log for a handle created with `{ trackReads: true }`
 * (root or any descendant obtained from it). Empty array when tracking wasn't
 * enabled. Returns a snapshot copy, not a live reference.
 */
export function getReadLog(dir: DirectoryHandleLike): string[] {
  return [...(readLogRegistry.get(dir)?.entries ?? [])];
}

/** Test-only: clear the read log in place (e.g. between phases of one test). */
export function clearReadLog(dir: DirectoryHandleLike): void {
  const state = readLogRegistry.get(dir);
  if (state) state.entries = [];
}

// Same whole-tree sharing as permissionRegistry: a fault plan describes the
// simulated share, not one handle.
const faultRegistry = new WeakMap<DirectoryHandleLike, FaultState>();
const operationLogRegistry = new WeakMap<DirectoryHandleLike, OperationLogState>();

/**
 * Test-only: install (or replace) the fault plan for a tree after it was
 * created. Installing faults *after* the seeding phase is usually what you
 * want — it keeps `createMemoryDirectory` + fixture setup on the happy path and
 * makes only the operation under test flaky.
 */
export function setSimulatedFaults(dir: DirectoryHandleLike, faults: SimulatedFault[]): void {
  const state = faultRegistry.get(dir);
  if (!state) return;
  state.faults = faults;
  state.consumed = faults.map(() => 0);
}

/** Test-only: remove every installed fault (equivalent to `setSimulatedFaults(dir, [])`). */
export function clearSimulatedFaults(dir: DirectoryHandleLike): void {
  setSimulatedFaults(dir, []);
}

/** Test-only: operation log for a tree created with `{ trackOperations: true }`. Snapshot copy. */
export function getOperationLog(dir: DirectoryHandleLike): OperationLogEntry[] {
  return [...(operationLogRegistry.get(dir)?.entries ?? [])];
}

/** Test-only: clear the operation log in place. */
export function clearOperationLog(dir: DirectoryHandleLike): void {
  const state = operationLogRegistry.get(dir);
  if (state) state.entries = [];
}

function simulatedError(errorName: string, entryName: string): Error {
  const error = new Error(`Simulated ${errorName} for "${entryName}".`);
  error.name = errorName;
  return error;
}

/**
 * Records the call, then throws if a fault matches and still has budget left.
 * Budget is consumed only when the fault actually fires, so `times: 1` means
 * "the first matching call fails and every later one succeeds".
 */
function applyFaults(
  faultState: FaultState | null,
  operationLog: OperationLogState | null,
  entry: OperationLogEntry
): void {
  operationLog?.entries.push(entry);
  if (!faultState) return;
  for (let index = 0; index < faultState.faults.length; index += 1) {
    const fault = faultState.faults[index]!;
    if (fault.operation !== entry.operation) continue;
    if (fault.name !== undefined && fault.name !== entry.name) continue;
    if (fault.nameSuffix !== undefined && !entry.name.endsWith(fault.nameSuffix)) continue;
    if (fault.create !== undefined && fault.create !== (entry.create ?? false)) continue;
    const limit = fault.times ?? 1;
    if (faultState.consumed[index]! >= limit) continue;
    faultState.consumed[index] += 1;
    throw simulatedError(fault.errorName ?? "NotFoundError", entry.name);
  }
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
  node: MemoryNode,
  permission: SharedPermission,
  path: string,
  readLog: ReadLogState | null,
  faultState: FaultState | null,
  operationLog: OperationLogState | null
): FileHandleLike {
  return {
    kind: "file",
    name,
    getFile: async () => {
      applyFaults(faultState, operationLog, { operation: "getFile", name });
      readLog?.entries.push(path);
      const entry = node.files.get(name);
      const content = entry ? entry.content : "";
      return new File([content], name, { type: "application/json" });
    },
    createWritable: async () => {
      applyFaults(faultState, operationLog, { operation: "createWritable", name });
      // Mirrors the real File System Access API: createWritable() itself
      // requires (and re-checks) readwrite permission at call time — a handle
      // obtained while permission was "granted" doesn't stay valid forever.
      // Without this, a test that flips permission via
      // setSimulatedWritePermission() AFTER a handle was already obtained
      // couldn't observe the resulting write failure through this handle.
      if (permission.state !== "granted") {
        throw writePermissionDenied(name);
      }
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
  permission: SharedPermission,
  path: string,
  readLog: ReadLogState | null,
  faultState: FaultState | null,
  operationLog: OperationLogState | null
): DirectoryHandleLike {
  // Build with extra `values` for in-memory iteration support, then cast
  const handle = {
    kind: "directory" as const,
    name,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      applyFaults(faultState, operationLog, {
        operation: "getFileHandle",
        name: fileName,
        create: options?.create ?? false,
      });
      const exists = node.files.has(fileName);
      if (!exists && !options?.create) {
        throw notFound(fileName);
      }
      // B11: this check used to live inside the `!exists` branch only, so
      // `getFileHandle(existingFile, { create: true })` — the common
      // "get-or-create for writing" call shape — silently bypassed the
      // permission gate for any file that already happened to exist. The real
      // File System Access API requires readwrite permission for `create: true`
      // unconditionally, whether or not the target already exists.
      if (options?.create && permission.state !== "granted") {
        throw writePermissionDenied(fileName);
      }
      if (!exists) {
        node.files.set(fileName, { content: "" });
      }
      return makeFileHandle(
        fileName,
        node,
        permission,
        path ? `${path}/${fileName}` : fileName,
        readLog,
        faultState,
        operationLog
      );
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      applyFaults(faultState, operationLog, {
        operation: "getDirectoryHandle",
        name: dirName,
        create: options?.create ?? false,
      });
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
      return makeDirectoryHandle(
        dirName,
        child,
        permission,
        path ? `${path}/${dirName}` : dirName,
        readLog,
        faultState,
        operationLog
      );
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
    // Yields real HANDLES, exactly as FileSystemDirectoryHandle.values() does.
    // The narrow `{name, kind}` records this used to yield made it impossible
    // for a test to observe that a caller re-opened an already-enumerated entry
    // by name — the extra round trip that costs the most on a UNC/SMB share.
    // Enumeration itself is one operation for the whole directory (that is what
    // the real API does), so no per-entry entry is logged here; the per-entry
    // cost a caller pays shows up as `getFile` (handle reused) or
    // `getFileHandle` + `getFile` (handle discarded and re-opened by name).
    values: async function* () {
      for (const [fileName] of node.files) {
        yield makeFileHandle(
          fileName,
          node,
          permission,
          path ? `${path}/${fileName}` : fileName,
          readLog,
          faultState,
          operationLog
        );
      }
      for (const [dirName, child] of node.dirs) {
        yield makeDirectoryHandle(
          dirName,
          child,
          permission,
          path ? `${path}/${dirName}` : dirName,
          readLog,
          faultState,
          operationLog
        );
      }
    }
  };
  const typedHandle = handle as DirectoryHandleLike;
  permissionRegistry.set(typedHandle, permission);
  if (readLog) readLogRegistry.set(typedHandle, readLog);
  if (faultState) faultRegistry.set(typedHandle, faultState);
  if (operationLog) operationLogRegistry.set(typedHandle, operationLog);
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
  const readLog: ReadLogState | null = options.trackReads ? { entries: [] } : null;
  // Always allocated (even with no faults) so setSimulatedFaults can install a
  // plan later — the common shape is "seed the fixture cleanly, then make one
  // operation flaky". An empty plan costs one comparison-free early return per
  // call, so trees that never inject faults are unaffected.
  const faultState: FaultState = {
    faults: options.faults ?? [],
    consumed: (options.faults ?? []).map(() => 0),
  };
  const operationLog: OperationLogState | null = options.trackOperations ? { entries: [] } : null;
  return makeDirectoryHandle(name, createNode(), permission, "", readLog, faultState, operationLog);
}
