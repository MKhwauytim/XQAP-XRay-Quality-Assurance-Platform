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
  clearWorkspaceHandle,
  loadWorkspaceHandle,
  saveWorkspaceHandle
} from "../storage/handleStore";

import {
  WorkspaceContext,
  emptyLoadedFiles,
  type WorkspaceContextValue
} from "./WorkspaceContext";

import type {
  WorkspaceLoadedFiles,
  WorkspaceStatus
} from "./workspaceTypes";

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

  // Pending reconnect handle: permission is "prompt" — user gesture required.
  const [pendingReconnectHandle, setPendingReconnectHandle] =
    useState<FileSystemDirectoryHandle | null>(null);

  const adoptHandle = useCallback(
    async (handle: FileSystemDirectoryHandle): Promise<void> => {
      const rawHandle = handle as DirectoryHandleLike;
      setDirectoryHandle(rawHandle);
      setSelectedDirectoryName(rawHandle.name);
      setStatus("checking");
      setMessage("جار فحص مساحة العمل.");

      const result = await checkWorkspaceStructure(rawHandle);
      setStatus(result.status);
      setMissingItems(result.missingItems);
      setInvalidItems(result.invalidItems);
      setMessage(result.message);

      if (result.status === "ready") {
        const files = await loadWorkspaceFiles(rawHandle);
        setLoadedFiles(files);
      }
    },
    []
  );

  // On mount: try to restore the previously-picked handle from IndexedDB.
  useEffect(() => {
    if (!isFileSystemAccessSupported()) {
      return;
    }

    void (async () => {
      try {
        const stored = await loadWorkspaceHandle();
        if (!stored) {
          return;
        }
        const asLike = stored as unknown as DirectoryHandleLike;
        const permission = await asLike.queryPermission?.({ mode: "readwrite" });
        if (permission === "granted") {
          await adoptHandle(stored);
        } else if (permission === "prompt" || permission === undefined) {
          setPendingReconnectHandle(stored);
          setMessage("انقر على «إعادة الاتصال» لاستعادة مساحة العمل.");
        }
        // "denied" → fall through to normal pick flow
      } catch {
        // IndexedDB unavailable or handle stale — ignore and let user pick
      }
    })();
  }, [adoptHandle]);

  const reconnectWorkspace = useCallback(async (): Promise<void> => {
    if (!pendingReconnectHandle) {
      return;
    }
    try {
      const asLike = pendingReconnectHandle as unknown as DirectoryHandleLike;
      const permission = await asLike.requestPermission?.({ mode: "readwrite" });
      if (permission === "granted") {
        setPendingReconnectHandle(null);
        await adoptHandle(pendingReconnectHandle);
      } else {
        setPendingReconnectHandle(null);
        setMessage("لم يتم منح الإذن. يمكنك اختيار مجلد يدوياً.");
      }
    } catch {
      setPendingReconnectHandle(null);
      setMessage("حدث خطأ أثناء طلب الإذن.");
    }
  }, [pendingReconnectHandle, adoptHandle]);

  const selectWorkspace = useCallback(async (): Promise<void> => {
    if (!isFileSystemAccessSupported()) {
      setStatus("unsupported_browser");
      setMessage("المتصفح الحالي لا يدعم File System Access API.");
      return;
    }

    try {
      setStatus("checking");
      setMessage("جار اختيار وفحص مجلد مساحة العمل.");

      const handle = await selectWorkspaceDirectory("read");

      await saveWorkspaceHandle(handle as unknown as FileSystemDirectoryHandle).catch(() => undefined);

      setDirectoryHandle(handle);
      setSelectedDirectoryName(handle.name);

      const result = await checkWorkspaceStructure(handle);

      setStatus(result.status);
      setMissingItems(result.missingItems);
      setInvalidItems(result.invalidItems);
      setMessage(result.message);

      if (result.status === "ready") {
        const files = await loadWorkspaceFiles(handle);
        setLoadedFiles(files);
      } else {
        setLoadedFiles(emptyLoadedFiles);
      }
    } catch (error) {
      if (isAbortError(error)) {
        setStatus("not_selected");
        setMessage("لم يتم اختيار مجلد مساحة العمل.");
        return;
      }

      setStatus("error");
      setMessage("حدث خطأ أثناء اختيار أو فحص مجلد مساحة العمل.");
    }
  }, []);

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

  const clearWorkspace = useCallback((): void => {
    void clearWorkspaceHandle().catch(() => undefined);
    setPendingReconnectHandle(null);
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
  }, []);

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
      pendingReconnect: pendingReconnectHandle !== null,
      selectWorkspace,
      reconnectWorkspace,
      reloadWorkspace,
      createInitialStructure,
      clearWorkspace
    }),
    [
      status,
      directoryHandle,
      selectedDirectoryName,
      loadedFiles,
      missingItems,
      invalidItems,
      message,
      pendingReconnectHandle,
      selectWorkspace,
      reconnectWorkspace,
      reloadWorkspace,
      createInitialStructure,
      clearWorkspace
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