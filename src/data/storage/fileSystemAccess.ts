import { safeWriteJson } from "./safeWrite";

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
  type WorkspaceStatus,
  type WorkspaceStructureCheckResult
} from "../workspace/workspaceTypes";

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
    throw new Error("File System Access API is not supported in this browser.");
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

export async function checkWorkspaceStructure(
  directoryHandle: DirectoryHandleLike
): Promise<WorkspaceStructureCheckResult> {
  const hasReadPermission = await ensureDirectoryPermission(
    directoryHandle,
    "readwrite"
  );

  if (!hasReadPermission) {
    return {
      status: "permission_denied",
      missingItems: [],
      invalidItems: [],
      message: "لم يتم منح صلاحية القراءة والكتابة لمجلد مساحة العمل."
    };
  }

  const missingItems: string[] = [];
  const invalidItems: string[] = [];

  const allTopFolders = [
    ...REQUIRED_WORKSPACE_FOLDERS,
    ...TOP_LEVEL_DATA_FOLDERS
  ];
  for (const folderName of allTopFolders) {
    try {
      await directoryHandle.getDirectoryHandle(folderName, { create: false });
    } catch {
      missingItems.push(folderName);
    }
  }

  try {
    const systemHandle = await directoryHandle.getDirectoryHandle(
      WORKSPACE_FILE_NAMES.systemFolder,
      { create: false }
    );

    for (const folderName of SYSTEM_SUBFOLDERS) {
      try {
        await systemHandle.getDirectoryHandle(folderName, { create: false });
      } catch {
        missingItems.push(`${WORKSPACE_FILE_NAMES.systemFolder}/${folderName}`);
      }
    }
  } catch {
    // The .system folder itself is already checked above.
  }

  const requiredFileLocations = [
    { dir: await getSystemRoot(directoryHandle, false).catch(() => null), fileName: WORKSPACE_FILE_NAMES.manifest },
    { dir: await getUserDataRoot(directoryHandle, false).catch(() => null), fileName: WORKSPACE_FILE_NAMES.usersPermissions },
  ];

  for (const item of requiredFileLocations) {
    if (!item.dir) {
      missingItems.push(item.fileName);
      continue;
    }

    const result = await readJsonFile<JsonEnvelope<unknown>>(item.dir, item.fileName);

    if (!result.ok) {
      if (result.reason === "missing") missingItems.push(item.fileName);
      else invalidItems.push(item.fileName);
      continue;
    }

    if (!isJsonEnvelope(result.file) || result.file.metadata.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
      invalidItems.push(item.fileName);
    }
  }

  if (missingItems.length > 0) {
    return {
      status: "missing_structure",
      missingItems,
      invalidItems,
      message:
        "لم يتم العثور على بنية مساحة العمل المطلوبة. يمكن لمسؤول النظام إنشاء البنية."
    };
  }

  if (invalidItems.length > 0) {
    return {
      status: "invalid_structure",
      missingItems,
      invalidItems,
      message:
        "تم العثور على ملفات مساحة العمل، ولكن بعض الملفات غير صالحة أو غير متوافقة."
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
  const systemDir = await getSystemRoot(directoryHandle, false).catch(() => null);
  const userDataDir = await getUserDataRoot(directoryHandle, false).catch(() => null);

  const manifest = await readJsonFile<WorkspaceLoadedFiles["manifest"]>(
    systemDir ?? directoryHandle,
    WORKSPACE_FILE_NAMES.manifest
  );

  const usersPermissions = await readJsonFile<
    WorkspaceLoadedFiles["usersPermissions"]
  >(userDataDir ?? directoryHandle, WORKSPACE_FILE_NAMES.usersPermissions);

  const sampleMaster = await readJsonFile<WorkspaceLoadedFiles["sampleMaster"]>(
    directoryHandle,
    WORKSPACE_FILE_NAMES.sampleMaster
  );

  const sampleDistribution = await readJsonFile<
    WorkspaceLoadedFiles["sampleDistribution"]
  >(directoryHandle, WORKSPACE_FILE_NAMES.sampleDistribution);

  return {
    manifest: manifest.ok ? manifest.file : null,
    usersPermissions: usersPermissions.ok ? usersPermissions.file : null,
    sampleMaster: sampleMaster.ok ? sampleMaster.file : null,
    sampleDistribution: sampleDistribution.ok ? sampleDistribution.file : null
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
    throw new Error("لم يتم منح صلاحية الكتابة لإنشاء بنية مساحة العمل.");
  }

  await directoryHandle.getDirectoryHandle(
    WORKSPACE_FILE_NAMES.employeeAnswersFolder,
    { create: true }
  );

  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.population, { create: true });
  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, { create: true });
  await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.reports, { create: true });

  const systemHandle = await directoryHandle.getDirectoryHandle(
    WORKSPACE_FILE_NAMES.systemFolder,
    { create: true }
  );

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

  const userDataHandle = await directoryHandle.getDirectoryHandle(WORKSPACE_ROOTS.userData, {
    create: true
  });

  await writeJsonFile(
    systemHandle,
    WORKSPACE_FILE_NAMES.manifest,
    await prepareFileForWrite(createDefaultWorkspaceManifest(username), username)
  );

  await writeJsonFile(
    userDataHandle,
    WORKSPACE_FILE_NAMES.usersPermissions,
    await prepareFileForWrite(createDefaultUsersPermissions(username), username)
  );
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
        message: `الملف ${fileName} ليس ملف JSON صالح.`
      };
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        ok: false,
        reason: "missing",
        message: `الملف ${fileName} غير موجود.`
      };
    }

    if (isPermissionError(error)) {
      return {
        ok: false,
        reason: "permission_denied",
        message: `لا توجد صلاحية كافية لقراءة الملف ${fileName}.`
      };
    }

    return {
      ok: false,
      reason: "read_failed",
      message: `تعذر قراءة الملف ${fileName}.`
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

export function getStatusFromStructureResult(
  result: WorkspaceStructureCheckResult
): WorkspaceStatus {
  return result.status;
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
