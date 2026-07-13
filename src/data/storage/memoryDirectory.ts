import type {
  DirectoryHandleLike,
  FileHandleLike
} from "./fileSystemAccess";

function notFound(name: string): Error {
  const error = new Error(`Not found: ${name}`);
  error.name = "NotFoundError";
  return error;
}

type MemoryNode = {
  files: Map<string, { content: string }>;
  dirs: Map<string, MemoryNode>;
};

function createNode(): MemoryNode {
  return { files: new Map(), dirs: new Map() };
}

function makeFileHandle(
  name: string,
  node: MemoryNode
): FileHandleLike {
  return {
    kind: "file",
    name,
    getFile: async () => {
      const entry = node.files.get(name);
      const content = entry ? entry.content : "";
      return new File([content], name, { type: "application/json" });
    },
    createWritable: async () => {
      let buffer = "";
      return {
        write: async (data: string) => {
          buffer += data;
        },
        close: async () => {
          node.files.set(name, { content: buffer });
        }
      };
    }
  };
}

function makeDirectoryHandle(
  name: string,
  node: MemoryNode
): DirectoryHandleLike {
  // Build with extra `values` for in-memory iteration support, then cast
  const handle = {
    kind: "directory" as const,
    name,
    getFileHandle: async (fileName: string, options?: { create?: boolean }) => {
      if (!node.files.has(fileName)) {
        if (!options?.create) {
          throw notFound(fileName);
        }
        node.files.set(fileName, { content: "" });
      }
      return makeFileHandle(fileName, node);
    },
    getDirectoryHandle: async (dirName: string, options?: { create?: boolean }) => {
      let child = node.dirs.get(dirName);
      if (!child) {
        if (!options?.create) {
          throw notFound(dirName);
        }
        child = createNode();
        node.dirs.set(dirName, child);
      }
      return makeDirectoryHandle(dirName, child);
    },
    removeEntry: async (entryName: string, options?: { recursive?: boolean }) => {
      if (node.files.has(entryName)) {
        node.files.delete(entryName);
        return;
      }
      const child = node.dirs.get(entryName);
      if (child) {
        if (!options?.recursive && (child.files.size > 0 || child.dirs.size > 0)) {
          const error = new Error(`Directory not empty: ${entryName}`);
          error.name = "InvalidModificationError";
          throw error;
        }
        node.dirs.delete(entryName);
        return;
      }
      throw notFound(entryName);
    },
    queryPermission: async () => "granted" as const,
    requestPermission: async () => "granted" as const,
    values: async function* () {
      for (const [fileName] of node.files) {
        yield { name: fileName, kind: "file" as const };
      }
      for (const [dirName] of node.dirs) {
        yield { name: dirName, kind: "directory" as const };
      }
    }
  };
  return handle as DirectoryHandleLike;
}

export function createMemoryDirectory(name = "root"): DirectoryHandleLike {
  return makeDirectoryHandle(name, createNode());
}
