import type { DirectoryHandleLike } from "./fileSystemAccess";

export const WORKSPACE_PERMISSION_LOST_EVENT = "workspace:permission-lost";

export class WorkspacePermissionError extends Error {
  readonly code = "workspace_permission_unavailable";

  constructor() {
    super("يلزم السماح بالكتابة على مساحة العمل لإكمال هذا الإجراء.");
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

  let state = await directoryHandle.queryPermission.call(directoryHandle, {
    mode: "readwrite",
  });

  if (state === "prompt" && directoryHandle.requestPermission) {
    try {
      state = await directoryHandle.requestPermission.call(directoryHandle, {
        mode: "readwrite",
      });
    } catch {
      throw new WorkspacePermissionError();
    }
  }

  if (state !== "granted") {
    throw new WorkspacePermissionError();
  }
}

/**
 * Revalidates the live File System Access permission immediately before a disk
 * command. A remembered workspace is opened read-only, so the first mutation
 * requests write access from the user instead of forcing them to pick the
 * directory again.
 */
export async function withWorkspaceWriteAccess<T>(
  directoryHandle: DirectoryHandleLike,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    await assertCurrentWritePermission(directoryHandle);
    return await operation();
  } catch (error) {
    if (!(error instanceof WorkspacePermissionError) && isPermissionFailure(error)) {
      notifyPermissionLost();
    }
    throw error;
  }
}
