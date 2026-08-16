import { safeWriteJson } from "./safeWrite";
import {
  codedMessage,
  logCodedError,
  tagErrorOnce,
  taggedError,
  type ErrorCode
} from "./errorCodes";

import {
  createDefaultUsersPermissions,
  createDefaultWorkspaceManifest,
  REQUIRED_WORKSPACE_FOLDERS,
  SYSTEM_SUBFOLDERS,
  TOP_LEVEL_DATA_FOLDERS,
  WORKSPACE_FILE_NAMES
} from "../workspace/workspaceDefaults";
import {
  getSystemRoot,
  getUserDataRoot,
  WORKSPACE_ROOTS,
} from "../workspace/workspacePaths";

import {
  WORKSPACE_SCHEMA_VERSION,
  type JsonEnvelope,
  type WorkspaceLoadedFiles,
  type WorkspaceStructureCheckResult
} from "../workspace/workspaceTypes";
import { detectWorkspaceSchema, initializeWorkspaceSchemaMetadata } from "../workspace/workspaceSchema";

type FileSystemPermissionMode = "read" | "readwrite";
type FileSystemPermissionState = "granted" | "denied" | "prompt";

type WritableFileStreamLike = {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
};

export type FileHandleLike = {
  kind: "file";
  name: string;
  getFile: () => Promise<File>;
  createWritable?: () => Promise<WritableFileStreamLike>;
  queryPermission?: (descriptor?: {
    mode?: FileSystemPermissionMode;
  }) => Promise<FileSystemPermissionState>;
  requestPermission?: (descriptor?: {
    mode?: FileSystemPermissionMode;
  }) => Promise<FileSystemPermissionState>;
};

export type DirectoryHandleLike = {
  kind: "directory";
  name: string;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<FileHandleLike>;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<DirectoryHandleLike>;
  removeEntry?: (
    name: string,
    options?: { recursive?: boolean }
  ) => Promise<void>;
  queryPermission?: (descriptor?: {
    mode?: FileSystemPermissionMode;
  }) => Promise<FileSystemPermissionState>;
  requestPermission?: (descriptor?: {
    mode?: FileSystemPermissionMode;
  }) => Promise<FileSystemPermissionState>;
};

type FilePickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    mode?: FileSystemPermissionMode;
  }) => Promise<DirectoryHandleLike>;
};

export type ReadJsonResult<TFile> =
  | {
      ok: true;
      file: TFile;
      rawText: string;
      hash: string;
    }
  | {
      ok: false;
      reason: "missing" | "invalid_json" | "permission_denied" | "read_failed";
      message: string;
    };

export function isFileSystemAccessSupported(): boolean {
  return typeof (window as FilePickerWindow).showDirectoryPicker === "function";
}

export async function selectWorkspaceDirectory(
  mode: FileSystemPermissionMode = "readwrite"
): Promise<DirectoryHandleLike> {
  const picker = (window as FilePickerWindow).showDirectoryPicker;

  if (!picker) {
    throw taggedError(
      "XQ-FS-001",
      "File System Access API is not supported in this browser."
    );
  }

  return picker({
    mode
  });
}

export async function ensureDirectoryPermission(
  directoryHandle: DirectoryHandleLike,
  mode: FileSystemPermissionMode
): Promise<boolean> {
  const queryPermission = directoryHandle.queryPermission;
  const requestPermission = directoryHandle.requestPermission;

  if (!queryPermission || !requestPermission) {
    return true;
  }

  const currentPermission = await queryPermission.call(directoryHandle, {
    mode
  });

  if (currentPermission === "granted") {
    return true;
  }

  if (currentPermission === "denied") {
    return false;
  }

  const requestedPermission = await requestPermission.call(directoryHandle, {
    mode
  });

  return requestedPermission === "granted";
}

export async function queryDirectoryPermission(
  directoryHandle: DirectoryHandleLike,
  mode: FileSystemPermissionMode
): Promise<FileSystemPermissionState> {
  const queryPermission = directoryHandle.queryPermission;

  if (!queryPermission) {
    return "granted";
  }

  return queryPermission.call(directoryHandle, { mode });
}

export async function checkWorkspaceStructure(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceStructureCheckResult> {
  const hasReadPermission = await ensureDirectoryPermission(
    directoryHandle,
    "read"
  );

  if (!hasReadPermission) {
    logCodedError("fileSystemAccess:check-structure", "XQ-FS-002");
    return {
      status: "permission_denied",
      missingItems: [],
      invalidItems: [],
      message: codedMessage("XQ-FS-002")
    };
  }

  const missingItems: string[] = [];
  const invalidItems: string[] = [];

  // Every check below is independent -- none depends on another's result,
  // only on accumulating into missingItems/invalidItems -- so they run
  // concurrently (Promise.allSettled, not Promise.all: one missing folder
  // must not abort the rest of the scan) instead of one network round trip
  // at a time. Results are reassembled in the exact same category order the
  // sequential code produced, so the returned arrays stay byte-identical to
  // before -- only the round trips now overlap (§V).
  const allTopFolders = [
    ...REQUIRED_WORKSPACE_FOLDERS,
    ...TOP_LEVEL_DATA_FOLDERS
  ];
  const topFolderResults = await Promise.allSettled(
    allTopFolders.map((folderName) =>
      directoryHandle.getDirectoryHandle(folderName, { create: false })
    )
  );
  topFolderResults.forEach((result, index) => {
    if (result.status === "rejected") missingItems.push(allTopFolders[index]);
  });

  // If the .system folder itself is missing, it's already recorded above
  // (it's one of allTopFolders) -- this only needs to run when it exists.
  const systemHandle = await directoryHandle
    .getDirectoryHandle(WORKSPACE_FILE_NAMES.systemFolder, { create: false })
    .catch(() => null);

  if (systemHandle) {
    const systemSubfolderResults = await Promise.allSettled(
      SYSTEM_SUBFOLDERS.map((folderName) =>
        systemHandle.getDirectoryHandle(folderName, { create: false })
      )
    );
    systemSubfolderResults.forEach((result, index) => {
      if (result.status === "rejected") {
        missingItems.push(`${WORKSPACE_FILE_NAMES.systemFolder}/${SYSTEM_SUBFOLDERS[index]}`);
      }
    });
  }

  const requiredFileLocations = await Promise.all([
    getSystemRoot(directoryHandle, false)
      .then((dir) => ({ dir, fileName: WORKSPACE_FILE_NAMES.manifest }))
      .catch(() => ({ dir: null as DirectoryHandleLike | null, fileName: WORKSPACE_FILE_NAMES.manifest })),
    getUserDataRoot(directoryHandle, false)
      .then((dir) => ({ dir, fileName: WORKSPACE_FILE_NAMES.usersPermissions }))
      .catch(() => ({ dir: null as DirectoryHandleLike | null, fileName: WORKSPACE_FILE_NAMES.usersPermissions })),
  ]);

  const fileCheckResults = await Promise.all(
    requiredFileLocations.map(async (item) => {
      if (!item.dir) return { fileName: item.fileName, outcome: "missing" as const };
      const result = await readJsonFile<JsonEnvelope<unknown>>(item.dir, item.fileName);
      if (!result.ok) {
        return {
          fileName: item.fileName,
          outcome: result.reason === "missing" ? ("missing" as const) : ("invalid" as const),
        };
      }
      if (!isJsonEnvelope(result.file) || result.file.metadata.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
        return { fileName: item.fileName, outcome: "invalid" as const };
      }
      return { fileName: item.fileName, outcome: "ok" as const };
    })
  );
  for (const { fileName, outcome } of fileCheckResults) {
    if (outcome === "missing") missingItems.push(fileName);
    else if (outcome === "invalid") invalidItems.push(fileName);
  }

  if (missingItems.length > 0) {
    return {
      status: "missing_structure",
      missingItems,
      invalidItems,
      message: codedMessage("XQ-FS-003")
    };
  }

  if (invalidItems.length > 0) {
    return {
      status: "invalid_structure",
      missingItems,
      invalidItems,
      message: codedMessage("XQ-FS-004")
    };
  }

  return {
    status: "ready",
    missingItems: [],
    invalidItems: [],
    message: "مساحة العمل جاهزة."
  };
}

export async function loadWorkspaceFiles(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceLoadedFiles> {
  // Only usersPermissions is actually consumed (by WorkspaceProvider's
  // applyDiskUsers). manifest/sampleMaster/sampleDistribution used to be read
  // here too, but nothing ever read the results back out of WorkspaceLoadedFiles
  // — and the root-level sample.master.json / sample.distribution.json paths
  // don't even exist under the current numbered layout (2-samples/{month}/...),
  // so those two reads always failed with "missing" on every workspace load.
  // They're kept as always-null in the returned shape (rather than removed from
  // the WorkspaceLoadedFiles type) since that type lives in workspaceTypes.ts,
  // outside this change's scope.
  const userDataDir = await getUserDataRoot(directoryHandle, false).catch(() => null);

  const usersPermissions = await readJsonFile<
    WorkspaceLoadedFiles["usersPermissions"]
  >(userDataDir ?? directoryHandle, WORKSPACE_FILE_NAMES.usersPermissions);

  return {
    manifest: null,
    usersPermissions: usersPermissions.ok ? usersPermissions.file : null,
    sampleMaster: null,
    sampleDistribution: null
  };
}

export async function createWorkspaceStructure(
  directoryHandle: DirectoryHandleLike,
  username: string
): Promise<void> {
  const hasWritePermission = await ensureDirectoryPermission(
    directoryHandle,
    "readwrite"
  );

  if (!hasWritePermission) {
    throw taggedError(
      "XQ-FS-005",
      "لم يتم منح صلاحية الكتابة لإنشاء بنية مساحة العمل."
    );
  }

  // Each phase below is tagged with its own code. Creating the folders, writing
  // the manifest, writing the permissions file and stamping the schema fail for
  // completely different reasons, and the caller previously saw one
  // undifferentiated "check write permissions" message for all of them.
  const systemHandle = await taggedStep("XQ-FS-006", async () => {
    await directoryHandle.getDirectoryHandle(
      WORKSPACE_FILE_NAMES.employeeAnswersFolder,
      { create: true }
    );

    await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.population, { create: true });
    await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, { create: true });
    await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.reports, { create: true });

    return directoryHandle.getDirectoryHandle(
      WORKSPACE_FILE_NAMES.systemFolder,
      { create: true }
    );
  });

  await taggedStep("XQ-FS-007", async () => {
    await systemHandle.getDirectoryHandle(WORKSPACE_FILE_NAMES.locksFolder, {
      create: true
    });

    await systemHandle.getDirectoryHandle(WORKSPACE_FILE_NAMES.auditFolder, {
      create: true
    });

    await systemHandle.getDirectoryHandle(WORKSPACE_FILE_NAMES.backupsFolder, {
      create: true
    });

    await directoryHandle.getDirectoryHandle(
      WORKSPACE_FILE_NAMES.templatesFolder,
      { create: true }
    );
  });

  const userDataHandle = await taggedStep("XQ-FS-006", () =>
    directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, {
      create: true
    })
  );

  await taggedStep("XQ-FS-008", async () =>
    writeJsonFile(
      systemHandle,
      WORKSPACE_FILE_NAMES.manifest,
      await prepareFileForWrite(createDefaultWorkspaceManifest(username), username)
    )
  );

  await taggedStep("XQ-FS-009", async () =>
    writeJsonFile(
      userDataHandle,
      WORKSPACE_FILE_NAMES.usersPermissions,
      await prepareFileForWrite(createDefaultUsersPermissions(username), username)
    )
  );

  await taggedStep("XQ-FS-010", async () => {
    const schema = await detectWorkspaceSchema(directoryHandle);
    if (schema.layout === "current" && schema.missingCurrentRoots.length === 0) {
      await initializeWorkspaceSchemaMetadata(directoryHandle, username);
    }
  });
}

/**
 * Runs one phase of `createWorkspaceStructure` and stamps its error code onto
 * whatever it throws. `tagError` mutates the error in place rather than
 * wrapping it, so name/message/stack/`instanceof` all reach the caller
 * unchanged -- this is a label, not a rethrow of something different.
 */
async function taggedStep<T>(code: ErrorCode, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    // `tagErrorOnce`, not `tagError`: this code is the OUTER, coarser label, and
    // tagging runs innermost-first as the exception unwinds. Overwriting here
    // erased whatever more specific code the layer below had already attached —
    // which phase of the create failed, or the XQ-IO-030/031 "re-pick the
    // folder" vs "retry" verdict. First writer wins keeps the specific one.
    throw tagErrorOnce(error, code);
  }
}

export async function readJsonFile<TFile>(
  directoryHandle: DirectoryHandleLike,
  fileName: string
): Promise<ReadJsonResult<NonNullable<TFile>>> {
  const primary = await readAndParseJsonFile<TFile>(directoryHandle, fileName);
  if (primary.ok) {
    return primary;
  }

  // A torn write (safeWriteJson stages/commits without an atomic rename) can
  // leave the live file missing or truncated. Mirror safeReadJson's recovery:
  // fall back to the `{file}.bak` snapshot so bootstrap files (workspace.manifest
  // .json, users.permissions.json) don't brick workspace entry. Permission /
  // read failures are NOT recoverable here — pass them through unchanged.
  if (primary.reason === "missing" || primary.reason === "invalid_json") {
    const backup = await readAndParseJsonFile<TFile>(
      directoryHandle,
      `${fileName}.bak`
    );
    if (backup.ok) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("data:recovered-from-bak", { detail: { fileName } })
        );
      }
      return backup;
    }
  }

  return primary;
}

async function readAndParseJsonFile<TFile>(
  directoryHandle: DirectoryHandleLike,
  fileName: string
): Promise<ReadJsonResult<NonNullable<TFile>>> {
  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName, {
      create: false
    });

    const file = await fileHandle.getFile();
    const rawText = await file.text();

    try {
      const parsed = JSON.parse(rawText) as NonNullable<TFile>;

      return {
        ok: true,
        file: parsed,
        rawText,
        hash: await hashText(rawText)
      };
    } catch {
      return {
        ok: false,
        reason: "invalid_json",
        message: codedMessage("XQ-FS-012", { file: fileName })
      };
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: false,
        reason: "missing",
        message: codedMessage("XQ-FS-011", { file: fileName })
      };
    }

    if (isPermissionError(error)) {
      return {
        ok: false,
        reason: "permission_denied",
        message: codedMessage("XQ-FS-013", { file: fileName })
      };
    }

    logCodedError("fileSystemAccess:read-json", "XQ-FS-014", error);
    return {
      ok: false,
      reason: "read_failed",
      message: codedMessage("XQ-FS-014", { file: fileName })
    };
  }
}

export async function writeJsonFile<TFile>(
  directoryHandle: DirectoryHandleLike,
  fileName: string,
  value: TFile
): Promise<void> {
  await safeWriteJson(directoryHandle, fileName, value);
}

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as { name?: string };

  return value.name === "NotFoundError";
}

function isPermissionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const value = error as { name?: string };

  return value.name === "NotAllowedError" || value.name === "SecurityError";
}

function isJsonEnvelope(value: unknown): value is JsonEnvelope<unknown> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const envelope = value as Partial<JsonEnvelope<unknown>>;

  if (!envelope.metadata || typeof envelope.metadata !== "object") {
    return false;
  }

  const metadata = envelope.metadata as Record<string, unknown>;

  return (
    typeof metadata.schemaVersion === "string" &&
    typeof metadata.fileType === "string" &&
    typeof metadata.revision === "number" &&
    typeof metadata.createdAt === "string" &&
    typeof metadata.createdBy === "string" &&
    typeof metadata.updatedAt === "string" &&
    typeof metadata.updatedBy === "string" &&
    typeof metadata.contentHash === "string" &&
    "data" in envelope
  );
}

async function prepareFileForWrite<TData, TFile extends JsonEnvelope<TData>>(
  file: TFile,
  username: string
): Promise<TFile> {
  const now = new Date().toISOString();

  const withoutHash: TFile = {
    ...file,
    metadata: {
      ...file.metadata,
      updatedAt: now,
      updatedBy: username,
      contentHash: ""
    }
  };

  const contentHash = await hashText(stableStringify(withoutHash.data));

  return {
    ...withoutHash,
    metadata: {
      ...withoutHash.metadata,
      contentHash
    }
  };
}

async function hashText(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return fallbackHash(value);
  }

  const encoded = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);

  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackHash(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }

  return `fallback-${Math.abs(hash).toString(16)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const objectValue = value as Record<string, unknown>;
  const keys = Object.keys(objectValue).sort();

  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
    .join(",")}}`;
}
