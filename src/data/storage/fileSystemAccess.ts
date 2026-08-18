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
import { retryTransientWrite } from "./transientFileErrors";

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
  // "I could not look" is not "it is not there" — the same contract every
  // storage read in this repo enforces (v97.0), finally applied to the
  // workspace ENTRY check. A probe that rejects with anything other than a
  // named NotFoundError (a NotReadableError on an idle-disconnected SMB
  // session, a revoked grant, a share blip) used to be counted as a missing
  // folder, so a fully-populated live workspace that was merely unreachable
  // for an instant was reported `missing_structure` — whose card offers
  // «إنشاء بنية مساحة العمل», i.e. an invitation to overwrite the live
  // workspace's manifest and users file with defaults. Any unreachable item
  // now short-circuits to an error verdict (XQ-FS-015) that renders the
  // retry card and never the create button.
  const unreachableItems: string[] = [];

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
    if (result.status !== "rejected") return;
    if (isNotFoundError(result.reason)) missingItems.push(allTopFolders[index]);
    else unreachableItems.push(allTopFolders[index]);
  });
  if (unreachableItems.length > 0) {
    logCodedError(
      "fileSystemAccess:check-structure",
      "XQ-FS-015",
      new Error(`Unreachable during structure check: ${unreachableItems.join(", ")}`)
    );
    return {
      status: "error",
      missingItems: [],
      invalidItems: [],
      message: codedMessage("XQ-FS-015"),
    };
  }

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
      if (result.status !== "rejected") return;
      const path = `${WORKSPACE_FILE_NAMES.systemFolder}/${SYSTEM_SUBFOLDERS[index]}`;
      if (isNotFoundError(result.reason)) missingItems.push(path);
      else unreachableItems.push(path);
    });
  }

  // Same discrimination for the directory resolutions: only a named NotFound
  // means "this root does not exist"; any other failure is inconclusive.
  const locateDir = async (
    resolve: () => Promise<DirectoryHandleLike>,
    fileName: string
  ): Promise<{ dir: DirectoryHandleLike | null; fileName: string }> => {
    try {
      return { dir: await resolve(), fileName };
    } catch (error) {
      if (!isNotFoundError(error)) unreachableItems.push(fileName);
      return { dir: null, fileName };
    }
  };
  const requiredFileLocations = await Promise.all([
    locateDir(() => getSystemRoot(directoryHandle, false), WORKSPACE_FILE_NAMES.manifest),
    locateDir(() => getUserDataRoot(directoryHandle, false), WORKSPACE_FILE_NAMES.usersPermissions),
  ]);

  const fileCheckResults = await Promise.all(
    requiredFileLocations.map(async (item) => {
      if (!item.dir) return { fileName: item.fileName, outcome: "missing" as const };
      const result = await readJsonFile<JsonEnvelope<unknown>>(item.dir, item.fileName);
      if (!result.ok) {
        // "missing" is absence; "invalid_json" is a real file we could read and
        // could not parse. A permission/read failure is NEITHER — it must not
        // count as invalid (whose admin card offers a defaults-overwriting
        // repair) any more than as missing.
        if (result.reason === "permission_denied" || result.reason === "read_failed") {
          return { fileName: item.fileName, outcome: "unreachable" as const };
        }
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
    else if (outcome === "unreachable") unreachableItems.push(fileName);
  }

  if (unreachableItems.length > 0) {
    logCodedError(
      "fileSystemAccess:check-structure",
      "XQ-FS-015",
      new Error(`Unreachable during structure check: ${unreachableItems.join(", ")}`)
    );
    return {
      status: "error",
      missingItems: [],
      invalidItems: [],
      message: codedMessage("XQ-FS-015"),
    };
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
  const userDataDir = await getUserDataRoot(directoryHandle, false).catch((error: unknown) => {
    // Only genuine absence may fall back to the legacy root-level location; a
    // transient failure to OPEN the folder must not be read as "no user data".
    if (!isNotFoundError(error)) {
      throw tagErrorOnce(error, "XQ-FS-015");
    }
    return null;
  });

  const usersPermissions = await readJsonFile<
    WorkspaceLoadedFiles["usersPermissions"]
  >(userDataDir ?? directoryHandle, WORKSPACE_FILE_NAMES.usersPermissions);

  // A users file we could not READ is not a users file that does not exist.
  // Returning null here made the provider hydrate the shipped DEFAULT users —
  // and the next admin edit then persisted that default set to disk wholesale
  // (userSync writes the full in-memory state), wiping every real account,
  // role and password hash. The mount must fail loudly instead; the structure
  // check that just passed proves the file was readable moments ago, so this
  // is transient and a retry is the honest advice.
  //
  // `invalid_json` belongs in the SAME bucket, and used to fall through to
  // null. A file that exists but does not parse (a torn write on an SMB share
  // truncating both the live copy and its `.bak`) is not proof that this
  // workspace has no users — yet `refreshPermissions` runs this on every 45s
  // sync tick, with no structure check in front of it, so the swap to the
  // shipped defaults happened silently mid-session and the next admin save
  // persisted it. Only a genuinely ABSENT file (`missing`, after the
  // live/`.bak`/`.tmp` ladder below) may hydrate defaults.
  if (
    !usersPermissions.ok &&
    (usersPermissions.reason === "permission_denied" ||
      usersPermissions.reason === "read_failed" ||
      usersPermissions.reason === "invalid_json")
  ) {
    throw taggedError(
      "XQ-FS-015",
      `Cannot read ${WORKSPACE_FILE_NAMES.usersPermissions}: ${usersPermissions.message}`
    );
  }

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
  //
  // The folder phases ride the transient-write retry ladder: "create structure"
  // after login is typically the session's FIRST write-shaped touch of a
  // UNC/SMB share, and the first I/O against an idle-disconnected SMB session
  // is exactly the operation that fails once and succeeds on the next attempt
  // — which used to force the user through the re-pick + re-grant ritual for a
  // create that a 20 ms retry would have completed.
  const systemHandle = await taggedStep("XQ-FS-006", () =>
    retryTransientWrite(async () => {
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
    })
  );

  await taggedStep("XQ-FS-007", () =>
    retryTransientWrite(async () => {
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
    })
  );

  const userDataHandle = await taggedStep("XQ-FS-006", () =>
    retryTransientWrite(() =>
      directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, {
        create: true
      })
    )
  );

  // NEVER overwrite a live workspace's identity or its user/permission set.
  // The structure check can misfire (or the share can recover between the
  // check and this click), and this function used to rewrite BOTH files with
  // defaults unconditionally — a fresh workspaceId, and every managed user,
  // role and password hash replaced by the shipped defaults, with one .bak
  // generation between the mistake and permanent loss. A file that already
  // holds a valid envelope is kept; a file we could not READ refuses the
  // create outright (XQ-FS-015) rather than treating the failure as absence.
  const keepExisting = async (
    dir: DirectoryHandleLike,
    fileName: string
  ): Promise<boolean> => {
    const existing = await readJsonFile<JsonEnvelope<unknown>>(dir, fileName);
    // Keep only a HEALTHY file (valid envelope, current schema): the
    // invalid-structure repair path routes through this same function, so a
    // corrupt or wrong-version file must still be recreatable.
    if (
      existing.ok &&
      isJsonEnvelope(existing.file) &&
      existing.file.metadata.schemaVersion === WORKSPACE_SCHEMA_VERSION
    ) {
      return true;
    }
    if (!existing.ok && (existing.reason === "permission_denied" || existing.reason === "read_failed")) {
      throw taggedError(
        "XQ-FS-015",
        `Cannot verify existing ${fileName} before create: ${existing.message}`
      );
    }
    return false;
  };

  await taggedStep("XQ-FS-008", async () => {
    if (await keepExisting(systemHandle, WORKSPACE_FILE_NAMES.manifest)) return;
    await writeJsonFile(
      systemHandle,
      WORKSPACE_FILE_NAMES.manifest,
      await prepareFileForWrite(createDefaultWorkspaceManifest(username), username)
    );
  });

  await taggedStep("XQ-FS-009", async () => {
    if (await keepExisting(userDataHandle, WORKSPACE_FILE_NAMES.usersPermissions)) return;
    await writeJsonFile(
      userDataHandle,
      WORKSPACE_FILE_NAMES.usersPermissions,
      await prepareFileForWrite(createDefaultUsersPermissions(username), username)
    );
  });

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
    const recovered = await readFirstRecoverableCopy<TFile>(directoryHandle, fileName);
    if (recovered) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("data:recovered-from-bak", { detail: { fileName } })
        );
      }
      return recovered;
    }
  }

  return primary;
}

/**
 * The `.bak` then `.tmp` half of `safeReadJson`'s recovery ladder.
 *
 * `.tmp` matters because it is exactly what a failed commit leaves behind:
 * `safeWriteJson` stages and byte-verifies `{file}.tmp` before committing, and
 * its documented total-failure outcome keeps that staged copy. Probing only
 * `.bak` here made the one surviving good copy invisible to the bootstrap
 * readers (workspace.manifest.json, users.permissions.json) even though
 * `safeReadJson` recovers it fine.
 */
async function readFirstRecoverableCopy<TFile>(
  directoryHandle: DirectoryHandleLike,
  fileName: string
): Promise<ReadJsonResult<NonNullable<TFile>> | null> {
  for (const suffix of [".bak", ".tmp"]) {
    const candidate = await readAndParseJsonFile<TFile>(
      directoryHandle,
      `${fileName}${suffix}`
    );
    if (candidate.ok) return candidate;
  }
  return null;
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
