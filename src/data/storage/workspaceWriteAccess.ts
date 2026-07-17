import type { DirectoryHandleLike } from "./fileSystemAccess";

export const WORKSPACE_PERMISSION_LOST_EVENT = "workspace:permission-lost";

export class WorkspacePermissionError extends Error {
  readonly code = "workspace_permission_unavailable";

  constructor() {
    super("فُقد إذن الكتابة على مساحة العمل. أعد الاتصال بالمجلد ثم حاول مرة أخرى.");
    this.name = "WorkspacePermissionError";
  }
}

function errorName(error: unknown): string | undefined {
  return error && typeof error === "object"
    ? (error as { name?: string }).name
    : undefined;
}

function isPermissionFailure(error: unknown): boolean {
  const name = errorName(error);
  return (
    error instanceof WorkspacePermissionError ||
    name === "NotAllowedError" ||
    name === "SecurityError"
  );
}

function notifyPermissionLost(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WORKSPACE_PERMISSION_LOST_EVENT));
  }
}

async function assertCurrentWritePermission(
  directoryHandle: DirectoryHandleLike,
): Promise<void> {
  if (!directoryHandle.queryPermission) return;

  const state = await directoryHandle.queryPermission.call(directoryHandle, {
    mode: "readwrite",
  });
  if (state !== "granted") {
    throw new WorkspacePermissionError();
  }
}

/**
 * Revalidates the live File System Access permission immediately before a disk
 * command. It deliberately does not call requestPermission: permission prompts
 * belong to the explicit workspace reconnect flow and require user activation.
 */
export async function withWorkspaceWriteAccess<T>(
  directoryHandle: DirectoryHandleLike,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    await assertCurrentWritePermission(directoryHandle);
    return await operation();
  } catch (error) {
    if (isPermissionFailure(error)) notifyPermissionLost();
    throw error;
  }
}
