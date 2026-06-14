import type { AuthRole } from "../../auth/authTypes";
import { safeWriteJson } from "./safeWrite";

import {
  createDefaultProcessedData,
  createDefaultRawData,
  createDefaultSampleDistribution,
  createDefaultSampleMaster,
  createDefaultUsersPermissions,
  createDefaultWorkspaceManifest,
  OPTIONAL_WORKSPACE_FILES,
  REQUIRED_WORKSPACE_FILES,
  REQUIRED_WORKSPACE_FOLDERS,
  SYSTEM_SUBFOLDERS,
  TOP_LEVEL_DATA_FOLDERS,
  WORKSPACE_FILE_NAMES
} from "../workspace/workspaceDefaults";

import {
  WORKSPACE_SCHEMA_VERSION,
  type AcquireLockResult,
  type JsonEnvelope,
  type SaveWithRevisionResult,
  type WorkspaceLoadedFiles,
  type WorkspaceLockFile,
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
  mode: FileSystemPermissionMode = "read"
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
    "read"
  );

  if (!hasReadPermission) {
    return {
      status: "permission_denied",
      missingItems: [],
      invalidItems: [],
      message: "لم يتم منح صلاحية قراءة مجلد مساحة العمل."
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

  for (const fileName of REQUIRED_WORKSPACE_FILES) {
    const result = await readJsonFile<JsonEnvelope<unknown>>(
      directoryHandle,
      fileName
    );

    if (!result.ok) {
      if (result.reason === "missing") {
        missingItems.push(fileName);
      } else {
        invalidItems.push(fileName);
      }

      continue;
    }

    if (
      !isJsonEnvelope(result.file) ||
      result.file.metadata.schemaVersion !== WORKSPACE_SCHEMA_VERSION
    ) {
      invalidItems.push(fileName);
    }
  }

  for (const fileName of OPTIONAL_WORKSPACE_FILES) {
    const result = await readJsonFile<JsonEnvelope<unknown>>(
      directoryHandle,
      fileName
    );

    if (!result.ok) {
      if (result.reason !== "missing") {
        invalidItems.push(fileName);
      }

      continue;
    }

    if (
      !isJsonEnvelope(result.file) ||
      result.file.metadata.schemaVersion !== WORKSPACE_SCHEMA_VERSION
    ) {
      invalidItems.push(fileName);
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
  const manifest = await readJsonFile<WorkspaceLoadedFiles["manifest"]>(
    directoryHandle,
    WORKSPACE_FILE_NAMES.manifest
  );

  const usersPermissions = await readJsonFile<
    WorkspaceLoadedFiles["usersPermissions"]
  >(directoryHandle, WORKSPACE_FILE_NAMES.usersPermissions);

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

  await writeJsonFile(
    directoryHandle,
    WORKSPACE_FILE_NAMES.manifest,
    await prepareFileForWrite(createDefaultWorkspaceManifest(username), username)
  );

  await writeJsonFile(
    directoryHandle,
    WORKSPACE_FILE_NAMES.usersPermissions,
    await prepareFileForWrite(createDefaultUsersPermissions(username), username)
  );

  await writeJsonFile(
    directoryHandle,
    WORKSPACE_FILE_NAMES.dataRaw,
    await prepareFileForWrite(createDefaultRawData(username), username)
  );

  await writeJsonFile(
    directoryHandle,
    WORKSPACE_FILE_NAMES.dataProcessed,
    await prepareFileForWrite(createDefaultProcessedData(username), username)
  );

  await writeJsonFile(
    directoryHandle,
    WORKSPACE_FILE_NAMES.sampleMaster,
    await prepareFileForWrite(createDefaultSampleMaster(username), username)
  );

  await writeJsonFile(
    directoryHandle,
    WORKSPACE_FILE_NAMES.sampleDistribution,
    await prepareFileForWrite(
      createDefaultSampleDistribution(username),
      username
    )
  );
}

export async function readJsonFile<TFile>(
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

export async function acquireEditLock(params: {
  directoryHandle: DirectoryHandleLike;
  resourceName: string;
  username: string;
  role: AuthRole;
  baseRevision: number;
  baseHash: string;
  expiresInMinutes?: number;
}): Promise<AcquireLockResult> {
  const {
    directoryHandle,
    resourceName,
    username,
    role,
    baseRevision,
    baseHash,
    expiresInMinutes = 15
  } = params;

  const hasWritePermission = await ensureDirectoryPermission(
    directoryHandle,
    "readwrite"
  );

  if (!hasWritePermission) {
    return {
      ok: false,
      reason: "permission_denied",
      message: "لم يتم منح صلاحية الكتابة لإنشاء قفل التحرير."
    };
  }

  const locksHandle = await getLocksDirectoryHandle(directoryHandle, true);
  const lockFileName = getLockFileName(resourceName);

  const existingLock = await readJsonFile<WorkspaceLockFile>(
    locksHandle,
    lockFileName
  );

  if (existingLock.ok && !isExpired(existingLock.file.data.expiresAt)) {
    if (existingLock.file.data.lockedByUsername !== username) {
      return {
        ok: false,
        reason: "locked_by_other_user",
        message: `هذا الملف قيد التحرير بواسطة ${existingLock.file.data.lockedByUsername}.`,
        existingLock: existingLock.file
      };
    }
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + expiresInMinutes * 60 * 1000
  ).toISOString();

  const lock: WorkspaceLockFile = {
    metadata: {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      fileType: "workspace.lock",
      revision: 1,
      createdAt: now.toISOString(),
      createdBy: username,
      updatedAt: now.toISOString(),
      updatedBy: username,
      contentHash: ""
    },
    data: {
      resourceName,
      lockedByUsername: username,
      lockedByRole: role,
      lockId: createId("lock"),
      createdAt: now.toISOString(),
      expiresAt,
      baseRevision,
      baseHash
    }
  };

  const preparedLock = await prepareFileForWrite(lock, username);

  try {
    await writeJsonFile(locksHandle, lockFileName, preparedLock);

    return {
      ok: true,
      lock: preparedLock
    };
  } catch {
    return {
      ok: false,
      reason: "write_failed",
      message: "تعذر إنشاء قفل التحرير."
    };
  }
}

export async function releaseEditLock(params: {
  directoryHandle: DirectoryHandleLike;
  resourceName: string;
  username: string;
  lockId?: string;
}): Promise<void> {
  const { directoryHandle, resourceName, username, lockId } = params;

  const locksHandle = await getLocksDirectoryHandle(directoryHandle, true);
  const lockFileName = getLockFileName(resourceName);

  const existingLock = await readJsonFile<WorkspaceLockFile>(
    locksHandle,
    lockFileName
  );

  if (!existingLock.ok) {
    return;
  }

  const isSameUser = existingLock.file.data.lockedByUsername === username;
  const isSameLock = !lockId || existingLock.file.data.lockId === lockId;

  if (!isSameUser || !isSameLock) {
    return;
  }

  const expiredLock: WorkspaceLockFile = {
    ...existingLock.file,
    metadata: {
      ...existingLock.file.metadata,
      updatedAt: new Date().toISOString(),
      updatedBy: username
    },
    data: {
      ...existingLock.file.data,
      expiresAt: new Date(0).toISOString()
    }
  };

  await writeJsonFile(
    locksHandle,
    lockFileName,
    await prepareFileForWrite(expiredLock, username)
  );
}

export async function saveJsonWithRevisionCheck<
  TFile extends JsonEnvelope<TData>,
  TData
>(params: {
  directoryHandle: DirectoryHandleLike;
  fileName: string;
  draftFile: TFile;
  baseHash: string;
  username: string;
  lockId?: string;
}): Promise<SaveWithRevisionResult<TFile>> {
  const { directoryHandle, fileName, draftFile, baseHash, username, lockId } =
    params;

  const hasWritePermission = await ensureDirectoryPermission(
    directoryHandle,
    "readwrite"
  );

  if (!hasWritePermission) {
    return {
      ok: false,
      reason: "permission_denied",
      message: "لم يتم منح صلاحية الكتابة لحفظ الملف."
    };
  }

  const latest = await readJsonFile<TFile>(directoryHandle, fileName);

  if (!latest.ok) {
    return {
      ok: false,
      reason: "invalid_file",
      message: "تعذر قراءة آخر نسخة من الملف قبل الحفظ."
    };
  }

  if (latest.hash !== baseHash) {
    return {
      ok: false,
      reason: "conflict",
      message:
        "تم تعديل الملف بواسطة مستخدم آخر بعد بدء التحرير. لم يتم الحفظ لتجنب الكتابة فوق التعديلات.",
      latestHash: latest.hash
    };
  }

  const now = new Date().toISOString();

  const nextFile: TFile = {
    ...draftFile,
    metadata: {
      ...draftFile.metadata,
      revision: latest.file.metadata.revision + 1,
      updatedAt: now,
      updatedBy: username,
      contentHash: ""
    }
  };

  const preparedFile = await prepareFileForWrite(nextFile, username);

  try {
    await writeJsonFile(directoryHandle, fileName, preparedFile);

    if (lockId) {
      await releaseEditLock({
        directoryHandle,
        resourceName: fileName,
        username,
        lockId
      });
    }

    return {
      ok: true,
      savedFile: preparedFile,
      newHash: await hashText(JSON.stringify(preparedFile, null, 2))
    };
  } catch {
    return {
      ok: false,
      reason: "write_failed",
      message: "تعذر حفظ الملف."
    };
  }
}

export function getStatusFromStructureResult(
  result: WorkspaceStructureCheckResult
): WorkspaceStatus {
  return result.status;
}

async function getLocksDirectoryHandle(
  directoryHandle: DirectoryHandleLike,
  create: boolean
): Promise<DirectoryHandleLike> {
  const systemHandle = await directoryHandle.getDirectoryHandle(
    WORKSPACE_FILE_NAMES.systemFolder,
    { create }
  );

  return systemHandle.getDirectoryHandle(WORKSPACE_FILE_NAMES.locksFolder, {
    create
  });
}

function getLockFileName(resourceName: string): string {
  const safeName = resourceName.replace(/[^a-zA-Z0-9._-]/g, "_");

  return `${safeName}.lock.json`;
}

function isExpired(isoDate: string): boolean {
  return Date.parse(isoDate) <= Date.now();
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

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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