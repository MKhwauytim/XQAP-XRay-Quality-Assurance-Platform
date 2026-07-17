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
  isFileSystemAccessSupported,
  loadWorkspaceFiles,
  selectWorkspaceDirectory,
  type DirectoryHandleLike
} from "../storage/fileSystemAccess";

import {
  WorkspaceContext,
  emptyLoadedFiles,
  type WorkspaceContextValue
} from "./WorkspaceContext";
import { createDemoWorkspace } from "./demoWorkspace";
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

  const [missingItems, setMissingItems] = useState<string[]>([]);
  const [invalidItems, setInvalidItems] = useState<string[]>([]);

  const [message, setMessage] = useState(
    isFileSystemAccessSupported()
      ? "لم يتم اختيار مساحة العمل بعد."
      : "المتصفح الحالي لا يدعم الوصول المباشر إلى ملفات النظام."
  );

  const applyWorkspaceHandle = useCallback(async (
    handle: DirectoryHandleLike,
    options?: { persist?: boolean; restored?: boolean }
  ): Promise<void> => {
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
        await applyWorkspaceHandle(persisted.directoryHandle, {
          persist: false,
          restored: true
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("not_selected");
        setMessage("لم يتم اختيار مساحة العمل بعد.");
      });

    return () => {
      cancelled = true;
    };
  }, [applyWorkspaceHandle]);

  const reconnectWorkspace = useCallback(async (): Promise<void> => {
    const persisted = await loadLastWorkspace().catch(() => null);

    if (!persisted) {
      setMessage("اختر مجلد مساحة العمل يدوياً للمتابعة.");
      return;
    }

    try {
      setStatus("checking");
      setMessage(`جار إعادة الاتصال بمساحة العمل: ${persisted.directoryName}.`);
      await applyWorkspaceHandle(persisted.directoryHandle, {
        persist: false,
        restored: true
      });
    } catch {
      setStatus("permission_denied");
      setMessage("تعذر استعادة مساحة العمل المحفوظة. اختر المجلد يدوياً.");
    }
  }, [applyWorkspaceHandle]);


  const selectWorkspace = useCallback(async (): Promise<void> => {
    if (!isFileSystemAccessSupported()) {
      setStatus("unsupported_browser");
      setMessage("المتصفح الحالي لا يدعم File System Access API.");
      return;
    }

    try {
      setStatus("checking");
      setMessage("جار اختيار وفحص مجلد مساحة العمل.");

      const handle = await selectWorkspaceDirectory("readwrite");
      await applyWorkspaceHandle(handle);
    } catch (error) {
      if (isAbortError(error)) {
        setStatus("not_selected");
        setMessage("لم يتم اختيار مجلد مساحة العمل.");
        return;
      }

      setStatus("error");
      setMessage("حدث خطأ أثناء اختيار أو فحص مجلد مساحة العمل.");
    }
  }, [applyWorkspaceHandle]);

  const reloadWorkspace = useCallback(async (): Promise<void> => {
    if (!directoryHandle) {
      setStatus("not_selected");
      setMessage("لم يتم اختيار مساحة العمل بعد.");
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
      } else {
        setLoadedFiles(emptyLoadedFiles);
      }
    } catch {
      setStatus("error");
      setMessage("حدث خطأ أثناء إعادة تحميل مساحة العمل.");
    }
  }, [directoryHandle]);

  const createInitialStructure = useCallback(
    async (username: string): Promise<void> => {
      if (!directoryHandle) {
        setStatus("not_selected");
        setMessage("يجب اختيار مجلد مساحة العمل قبل إنشاء البنية.");
        return;
      }

      try {
        setStatus("checking");
        setMessage("جار إنشاء بنية مساحة العمل.");

        await createWorkspaceStructure(directoryHandle, username);

        const result = await checkWorkspaceStructure(directoryHandle);

        setStatus(result.status);
        setMissingItems(result.missingItems);
        setInvalidItems(result.invalidItems);
        setMessage(
          result.status === "ready"
            ? "تم إنشاء بنية مساحة العمل بنجاح."
            : result.message
        );

        if (result.status === "ready") {
          const files = await loadWorkspaceFiles(directoryHandle);
          setLoadedFiles(files);
          applyDiskUsers(files);
        } else {
          setLoadedFiles(emptyLoadedFiles);
        }
      } catch {
        setStatus("error");
        setMessage("تعذر إنشاء بنية مساحة العمل. تحقق من صلاحيات الكتابة.");
      }
    },
    [directoryHandle]
  );

  const enterDemoWorkspace = useCallback(async (): Promise<void> => {
    setReadOnlyMode(false);
    setStatus("checking");
    setMessage("جارٍ تحضير وضع العرض التجريبي...");
    const handle = await createDemoWorkspace();
    await applyWorkspaceHandle(handle, { persist: false });
    setReadOnlyMode(true);
  }, [applyWorkspaceHandle]);

  const clearWorkspace = useCallback((): void => {
    setReadOnlyMode(false);
    setDirectoryHandle(null);
    setSelectedDirectoryName("");
    setLoadedFiles(emptyLoadedFiles);
    setMissingItems([]);
    setInvalidItems([]);

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
      setMessage(
        "فُقد إذن الوصول إلى مساحة العمل. أعد اختيار المجلد لاستعادة الاتصال.",
      );
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
      pendingReconnect: false,
      selectWorkspace,
      reconnectWorkspace,
      reloadWorkspace,
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
      message,
      selectWorkspace,
      reconnectWorkspace,
      reloadWorkspace,
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
    diskFeaturePermissions.length > 0 ? diskFeaturePermissions : undefined
  );
}
