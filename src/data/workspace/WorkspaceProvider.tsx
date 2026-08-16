import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import {
  checkWorkspaceStructure,
  createWorkspaceStructure,
  ensureDirectoryPermission,
  isFileSystemAccessSupported,
  loadWorkspaceFiles,
  queryDirectoryPermission,
  selectWorkspaceDirectory,
  type DirectoryHandleLike
} from "../storage/fileSystemAccess";

import {
  WorkspaceContext,
  emptyLoadedFiles,
  type WorkspaceContextValue
} from "./WorkspaceContext";
import { createDemoWorkspace } from "./demoWorkspace";
import {
  errorCodeOf,
  formatUserError,
  logCodedError,
  tagErrorOnce,
  type ErrorCode
} from "../storage/errorCodes";
import { setReadOnlyMode } from "../storage/readOnlyMode";
import { WORKSPACE_PERMISSION_LOST_EVENT } from "../storage/workspaceWriteAccess";

import type {
  WorkspaceLoadedFiles,
  WorkspaceStatus
} from "./workspaceTypes";

import {
  createDefaultManagedUsers,
  syncUsersFromDisk,
  type ManagedLoginUser
} from "../../auth/userManagement";
import type { RolePermission } from "../../auth/userManagement";
import {
  clearLastWorkspace,
  loadLastWorkspace,
  saveLastWorkspace
} from "./workspacePersistence";

type WorkspaceProviderProps = {
  children: ReactNode;
};

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  const [status, setStatus] = useState<WorkspaceStatus>(() =>
    isFileSystemAccessSupported() ? "not_selected" : "unsupported_browser"
  );

  const [directoryHandle, setDirectoryHandle] =
    useState<DirectoryHandleLike | null>(null);

  const [selectedDirectoryName, setSelectedDirectoryName] = useState("");

  const [loadedFiles, setLoadedFiles] =
    useState<WorkspaceLoadedFiles>(emptyLoadedFiles);

  // See the usersHydrated doc comment on WorkspaceContextValue: flips true
  // only once applyDiskUsers has actually synced this workspace connection's
  // users.permissions.json into the in-memory user-management state, which
  // happens strictly after (and separately from) the `status` transition to
  // "ready". Consumers must gate any "does this session's user still exist"
  // check on this flag, not on status alone.
  const [usersHydrated, setUsersHydrated] = useState(false);

  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [invalidItems, setInvalidItems] = useState<string[]>([]);
  const [pendingReconnect, setPendingReconnect] = useState(false);

  const [message, setMessage] = useState(
    isFileSystemAccessSupported()
      ? "لم يتم اختيار مساحة العمل بعد."
      : "المتصفح الحالي لا يدعم الوصول المباشر إلى ملفات النظام."
  );

  const applyWorkspaceHandle = useCallback(async (
    handle: DirectoryHandleLike,
    options?: { persist?: boolean; restored?: boolean }
  ): Promise<void> => {
    setPendingReconnect(false);
    setDirectoryHandle(handle);
    setSelectedDirectoryName(handle.name);

    const result = await checkWorkspaceStructure(handle);

    setStatus(result.status);
    setMissingItems(result.missingItems);
    setInvalidItems(result.invalidItems);
    setMessage(
      options?.restored && result.status === "ready"
        ? "تمت استعادة آخر مساحة عمل بنجاح."
        : result.message
    );

    if (result.status === "ready") {
      const files = await loadWorkspaceFiles(handle);
      setLoadedFiles(files);
      applyDiskUsers(files);
      setUsersHydrated(true);
    } else {
      setLoadedFiles(emptyLoadedFiles);
    }

    if (options?.persist !== false) {
      await saveLastWorkspace(handle).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!isFileSystemAccessSupported()) return;

    let cancelled = false;

    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        setStatus("checking");
        setMessage("جار البحث عن آخر مساحة عمل محفوظة.");
        return loadLastWorkspace();
      })
      .then(async (persisted) => {
        if (cancelled) return;

        if (!persisted) {
          setStatus("not_selected");
          setMessage("لم يتم اختيار مساحة العمل بعد.");
          return;
        }

        setMessage(`جار إعادة الاتصال بمساحة العمل: ${persisted.directoryName}.`);
        // §S: query "readwrite", not "read" -- this app never does read-only
        // work, so a handle whose browser-remembered grant covers only "read"
        // must fall through to the reconnect button below (which prompts for
        // "readwrite" inside a real user gesture) rather than silently
        // auto-restoring here and then hitting a second prompt at the first
        // write. This query never itself prompts.
        const permission = await queryDirectoryPermission(
          persisted.directoryHandle,
          "readwrite"
        );
        if (permission !== "granted") {
          setDirectoryHandle(persisted.directoryHandle);
          setSelectedDirectoryName(persisted.directoryName);
          setPendingReconnect(true);
          setStatus("not_selected");
          logCodedError("workspace:restore-permission", "XQ-WS-015");
          setMessage(formatUserError("XQ-WS-015"));
          return;
        }
        await applyWorkspaceHandle(persisted.directoryHandle, {
          persist: false,
          restored: true
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logCodedError("workspace:restore", "XQ-WS-014", error);
        setStatus("not_selected");
        setMessage(formatUserError("XQ-WS-014", error));
      });

    return () => {
      cancelled = true;
    };
  }, [applyWorkspaceHandle]);

  const reconnectWorkspace = useCallback(async (): Promise<void> => {
    const persisted = await loadLastWorkspace().catch(() => null);

    if (!persisted) {
      logCodedError("workspace:reconnect", "XQ-WS-008");
      setMessage(formatUserError("XQ-WS-008"));
      return;
    }

    try {
      setStatus("checking");
      setMessage(`جار إعادة الاتصال بمساحة العمل: ${persisted.directoryName}.`);
      const hasReadWritePermission = await ensureDirectoryPermission(
        persisted.directoryHandle,
        "readwrite"
      );
      if (!hasReadWritePermission) {
        setPendingReconnect(true);
        setStatus("not_selected");
        logCodedError("workspace:reconnect-permission", "XQ-WS-009");
        setMessage(formatUserError("XQ-WS-009"));
        return;
      }
      await applyWorkspaceHandle(persisted.directoryHandle, {
        persist: false,
        restored: true
      });
    } catch (error) {
      logCodedError("workspace:reconnect", "XQ-WS-010", error);
      setPendingReconnect(true);
      setStatus("not_selected");
      setMessage(formatUserError("XQ-WS-010", error));
    }
  }, [applyWorkspaceHandle]);


  const selectWorkspace = useCallback(async (): Promise<void> => {
    if (!isFileSystemAccessSupported()) {
      setStatus("unsupported_browser");
      logCodedError("workspace:select", "XQ-WS-001");
      setMessage(formatUserError("XQ-WS-001"));
      return;
    }

    try {
      setStatus("checking");
      setMessage("جار اختيار وفحص مجلد مساحة العمل.");

      const handle = await selectWorkspaceDirectory("readwrite");
      // Picking a REAL folder always leaves read-only (viewer/demo) mode.
      //
      // `enterDemoWorkspace` sets the flag and only `enterDemoWorkspace` itself
      // and `clearWorkspace` ever cleared it — but the demo entry point sits on
      // the same picker screen as "choose a folder", so demo → pick a real
      // folder left the flag ON against a live workspace. Every folder was then
      // created normally (raw `getDirectoryHandle(create:true)` is not mode-
      // guarded) and the first `safeWriteJson` threw `ReadOnlyModeError`, which
      // surfaced as the bare "تعذر فتح مساحة عمل" on a brand-new empty folder
      // with permission already granted — and left a half-built structure
      // behind, so the retry then failed differently.
      //
      // Cleared here rather than inside `applyWorkspaceHandle` because that is
      // also the demo path's own entry point.
      setReadOnlyMode(false);
      await applyWorkspaceHandle(handle);
    } catch (error) {
      if (isAbortError(error)) {
        setStatus("not_selected");
        // Not a fault: the user dismissed the picker. Coded so the sentence on
        // screen is still identifiable in a support report, not logged as an
        // error, because nothing went wrong.
        setMessage(formatUserError("XQ-WS-002"));
        return;
      }

      // This catch used to swallow the failure entirely: no log, and a generic
      // message that named neither the step nor the exception. When workspace
      // selection failed in a real browser there was literally nothing to go on
      // -- and the error log is unreachable, because it lives behind Settings,
      // which needs a mounted workspace. So the one place a user could look is
      // the one place they cannot reach.
      //
      // The detail is now both logged (for the error-log panel, once a workspace
      // IS open) and appended to the on-screen message, which is the only
      // surface visible in this state.
      logCodedError("workspace:select", "XQ-WS-003", error);
      setStatus("error");
      setMessage(formatUserError("XQ-WS-003", error));
    }
  }, [applyWorkspaceHandle]);

  const reloadWorkspace = useCallback(async (): Promise<void> => {
    if (!directoryHandle) {
      setStatus("not_selected");
      logCodedError("workspace:reload", "XQ-WS-011");
      setMessage(formatUserError("XQ-WS-011"));
      return;
    }

    try {
      setStatus("checking");
      setMessage("جار إعادة فحص مساحة العمل.");

      const result = await checkWorkspaceStructure(directoryHandle);

      setStatus(result.status);
      setMissingItems(result.missingItems);
      setInvalidItems(result.invalidItems);
      setMessage(result.message);

      if (result.status === "ready") {
        const files = await loadWorkspaceFiles(directoryHandle);
        setLoadedFiles(files);
        applyDiskUsers(files);
        setUsersHydrated(true);
      } else {
        setLoadedFiles(emptyLoadedFiles);
      }
    } catch (error) {
      logCodedError("workspace:reload", "XQ-WS-012", error);
      setStatus("error");
      setMessage(formatUserError("XQ-WS-012", error));
    }
  }, [directoryHandle]);

  const refreshPermissions = useCallback(async (): Promise<boolean> => {
    if (!directoryHandle) return false;
    try {
      const files = await loadWorkspaceFiles(directoryHandle);
      applyDiskUsers(files);
      return true;
    } catch (error) {
      logCodedError("workspace:refresh-permissions", "XQ-WS-013", error);
      return false;
    }
  }, [directoryHandle]);

  const createInitialStructure = useCallback(
    async (username: string): Promise<void> => {
      if (!directoryHandle) {
        setStatus("not_selected");
        logCodedError("workspace:create-structure", "XQ-WS-004");
        setMessage(formatUserError("XQ-WS-004"));
        return;
      }

      try {
        setStatus("checking");
        setMessage("جار إنشاء بنية مساحة العمل.");

        // The three steps below used to share one catch that blamed write
        // permissions unconditionally. Each now tags whatever it throws with
        // its own code, so the message names the step that actually failed
        // (and, via fileSystemAccess.ts, which part of step 1 it was).
        await taggedStep("XQ-WS-005", () =>
          createWorkspaceStructure(directoryHandle, username)
        );

        const result = await taggedStep("XQ-WS-006", () =>
          checkWorkspaceStructure(directoryHandle)
        );

        setStatus(result.status);
        setMissingItems(result.missingItems);
        setInvalidItems(result.invalidItems);
        setMessage(
          result.status === "ready"
            ? "تم إنشاء بنية مساحة العمل بنجاح."
            : result.message
        );

        if (result.status === "ready") {
          const files = await taggedStep("XQ-WS-007", async () => {
            const loaded = await loadWorkspaceFiles(directoryHandle);
            applyDiskUsers(loaded);
            return loaded;
          });
          setLoadedFiles(files);
          setUsersHydrated(true);
        } else {
          setLoadedFiles(emptyLoadedFiles);
        }
      } catch (error) {
        // XQ-WS-005/006/007 identify which of the three steps threw; XQ-WS-018
        // is the fallback for anything raised outside them. The old message
        // claimed a write-permission cause it had never established.
        const code: ErrorCode = errorCodeOf(error) ?? "XQ-WS-018";
        logCodedError("workspace:create-structure", code, error);
        setStatus("error");
        setMessage(formatUserError(code, error));
      }
    },
    [directoryHandle]
  );

  const enterDemoWorkspace = useCallback(async (): Promise<void> => {
    setReadOnlyMode(false);
    setStatus("checking");
    setMessage("جارٍ تحضير وضع العرض التجريبي...");
    // Observability only: the rejection still propagates exactly as before.
    let handle;
    try {
      handle = await createDemoWorkspace();
    } catch (error) {
      logCodedError("workspace:demo", "XQ-WS-016", error);
      throw error;
    }
    await applyWorkspaceHandle(handle, { persist: false });
    setReadOnlyMode(true);
  }, [applyWorkspaceHandle]);

  const clearWorkspace = useCallback((): void => {
    setReadOnlyMode(false);
    setDirectoryHandle(null);
    setSelectedDirectoryName("");
    setLoadedFiles(emptyLoadedFiles);
    setUsersHydrated(false);
    setMissingItems([]);
    setInvalidItems([]);
    setPendingReconnect(false);

    setStatus(
      isFileSystemAccessSupported() ? "not_selected" : "unsupported_browser"
    );

    setMessage(
      isFileSystemAccessSupported()
        ? "لم يتم اختيار مساحة العمل بعد."
        : "المتصفح الحالي لا يدعم الوصول المباشر إلى ملفات النظام."
    );
    void clearLastWorkspace();
  }, []);

  useEffect(() => {
    const handlePermissionLost = () => {
      if (!directoryHandle) return;
      setStatus("permission_denied");
      setLoadedFiles(emptyLoadedFiles);
      logCodedError("workspace:permission-lost", "XQ-WS-017");
      setMessage(formatUserError("XQ-WS-017"));
    };

    window.addEventListener(
      WORKSPACE_PERMISSION_LOST_EVENT,
      handlePermissionLost,
    );
    return () =>
      window.removeEventListener(
        WORKSPACE_PERMISSION_LOST_EVENT,
        handlePermissionLost,
      );
  }, [directoryHandle]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      status,
      directoryHandle,
      selectedDirectoryName,
      loadedFiles,
      missingItems,
      invalidItems,
      message,
      isSupported: isFileSystemAccessSupported(),
      pendingReconnect,
      usersHydrated,
      selectWorkspace,
      reconnectWorkspace,
      reloadWorkspace,
      refreshPermissions,
      createInitialStructure,
      clearWorkspace,
      enterDemoWorkspace
    }),
    [
      status,
      directoryHandle,
      selectedDirectoryName,
      loadedFiles,
      missingItems,
      invalidItems,
      pendingReconnect,
      usersHydrated,
      message,
      selectWorkspace,
      reconnectWorkspace,
      reloadWorkspace,
      refreshPermissions,
      createInitialStructure,
      clearWorkspace,
      enterDemoWorkspace
    ]
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * Runs one step of a multi-step flow and stamps its error code onto whatever it
 * throws. `tagError` mutates the existing error rather than wrapping it, so the
 * error's identity, name, message and stack reach the outer catch untouched --
 * this adds a label, it does not change what is thrown or how it is handled.
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

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { name?: string }).name === "AbortError";
}

/**
 * Convert users from the disk `UsersPermissionsFile` into `ManagedLoginUser`
 * format and replace the runtime auth state with the selected workspace data.
 */
function applyDiskUsers(files: WorkspaceLoadedFiles): void {
  const diskData = files.usersPermissions?.data;

  const now = new Date().toISOString();

  const managedUsers: ManagedLoginUser[] = diskData?.users.length
    ? diskData.users.map((diskUser) => ({
    id: diskUser.id,
    username: diskUser.username,
    displayName: diskUser.displayName,
    role: diskUser.role,
    passwordHash: diskUser.passwordHash,
    isActive: diskUser.isActive,
    hasCertScanLicense: diskUser.hasCertScanLicense,
    createdAt: diskUser.createdAt ?? now,
    updatedAt: diskUser.updatedAt ?? now
      }))
    : createDefaultManagedUsers();

  const diskPermissions: RolePermission[] = (diskData?.permissions ?? []).map((p) => ({
    role: p.role,
    tabId: p.tabId,
    access: p.access
  }));

  const diskFeaturePermissions = (diskData?.featurePermissions ?? []).map((f) => ({
    role: f.role,
    featureId: f.featureId,
    enabled: f.enabled,
  }));

  syncUsersFromDisk(
    managedUsers,
    diskPermissions.length > 0 ? diskPermissions : undefined,
    diskFeaturePermissions.length > 0 ? diskFeaturePermissions : undefined,
    // Absent on a workspace written before the admin-account block existed —
    // syncUsersFromDisk falls back to the shipped defaults in that case.
    diskData?.adminAccount
  );
}
