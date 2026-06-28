import type { DirectoryHandleLike } from "../storage/fileSystemAccess";

const DB_NAME = "xray-quality-app-persistence";
const DB_VERSION = 1;
const STORE_NAME = "workspace";
const LAST_WORKSPACE_KEY = "last-workspace";

export type PersistedWorkspace = {
  directoryHandle: DirectoryHandleLike;
  directoryName: string;
  savedAt: string;
};

type PersistedWorkspaceRecord = PersistedWorkspace & {
  id: string;
};

function openPersistenceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB."));
  });
}

export async function saveLastWorkspace(directoryHandle: DirectoryHandleLike): Promise<void> {
  const db = await openPersistenceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const record: PersistedWorkspaceRecord = {
        id: LAST_WORKSPACE_KEY,
        directoryHandle,
        directoryName: directoryHandle.name,
        savedAt: new Date().toISOString(),
      };

      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to save workspace."));
    });
  } finally {
    db.close();
  }
}

export async function loadLastWorkspace(): Promise<PersistedWorkspace | null> {
  const db = await openPersistenceDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(LAST_WORKSPACE_KEY);

      request.onsuccess = () => {
        const record = request.result as PersistedWorkspaceRecord | undefined;
        resolve(record ? {
          directoryHandle: record.directoryHandle,
          directoryName: record.directoryName,
          savedAt: record.savedAt,
        } : null);
      };
      request.onerror = () => reject(request.error ?? new Error("Failed to load workspace."));
    });
  } finally {
    db.close();
  }
}

export async function clearLastWorkspace(): Promise<void> {
  const db = await openPersistenceDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(LAST_WORKSPACE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Failed to clear workspace."));
    });
  } finally {
    db.close();
  }
}
