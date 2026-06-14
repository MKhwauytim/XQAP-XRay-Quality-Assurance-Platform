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
  return {
    kind: "directory",
    name,
    getFileHandle: async (fileName, options) => {
      if (!node.files.has(fileName)) {
        if (!options?.create) {
          throw notFound(fileName);
        }
        node.files.set(fileName, { content: "" });
      }
      return makeFileHandle(fileName, node);
    },
    getDirectoryHandle: async (dirName, options) => {
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
    queryPermission: async () => "granted",
    requestPermission: async () => "granted"
  };
}

export function createMemoryDirectory(name = "root"): DirectoryHandleLike {
  return makeDirectoryHandle(name, createNode());
}
