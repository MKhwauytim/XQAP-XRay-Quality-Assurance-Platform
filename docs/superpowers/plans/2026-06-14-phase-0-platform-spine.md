# Phase 0 — Platform Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing on-disk data layer into the load-bearing, corruption-resistant foundation every later phase assumes — a tested safe-write layer, same-machine write serialization, modern password hashing, the per-user CertScan flag, persisted workspace access, and the `.system` scaffold.

**Architecture:** The prototype already has `DirectoryHandleLike`/`FileHandleLike` abstractions, `JsonEnvelope` metadata, SHA-256 `contentHash`, revision-checked saves, and advisory lock files (`src/data/storage/fileSystemAccess.ts`). We layer on top of these rather than replacing them: (1) a Vitest harness + in-memory FS double so the pure logic is testable without a browser; (2) a `safeWriteJson`/`safeReadJson` layer that snapshots `.bak`, validates after write, and restores on corruption, serialized per-resource via a Web Locks wrapper; (3) Argon2id-preferred password hashing with a PBKDF2-600k fallback and a re-hash path; (4) the `hasCertScanLicense` user attribute (§4/§8/§13.5); plus browser-integration tasks (IndexedDB handle persistence, `.system` scaffold, workspace bootstrap gate) verified manually.

**Tech Stack:** React 19 + TypeScript + Vite 8; Vitest (node environment) for tests; `hash-wasm` for Argon2id; WebCrypto for PBKDF2; `navigator.locks` (Web Locks API) with a no-op fallback; IndexedDB for handle persistence. Final ship remains a single self-contained `index.html` via `vite-plugin-singlefile` (tests are dev-only and never bundled).

**Spec reference:** `docs/04-build-spec-v0.10.md` — §5.2 (JsonEnvelope/concurrency), §11A.6 (two-tier locking), §16.3 (safe-write), §5.1/§16.4 (auth), §4/§8/§13.5 (CertScan license), §16.2 (handle persistence), §6 (`.system` layout).

---

## File Structure

**New files (this phase):**
- `vitest.config.ts` — Vitest config (node environment), kept separate from `vite.config.ts` so the singlefile build is untouched.
- `src/data/storage/memoryDirectory.ts` — in-memory `DirectoryHandleLike` implementation used by tests (and only by tests).
- `src/data/storage/memoryDirectory.test.ts` — proves the double honours the handle contract.
- `src/data/storage/webLocks.ts` — `withResourceLock(name, fn)` over `navigator.locks`, with a same-thread queue fallback.
- `src/data/storage/webLocks.test.ts`
- `src/data/storage/safeWrite.ts` — `safeWriteJson` / `safeReadJson` (`.bak` snapshot + validate + restore).
- `src/data/storage/safeWrite.test.ts`
- `src/data/storage/handleStore.ts` — IndexedDB persistence of the workspace directory handle (Task 8).
- `src/auth/passwordCrypto.test.ts` — round-trip + fallback + re-hash tests.

**Modified files:**
- `package.json` — add dev deps (`vitest`, `happy-dom` is not needed; node env) + `hash-wasm`; add `test`/`test:run` scripts.
- `src/auth/passwordCrypto.ts` — add Argon2id, bump PBKDF2 default to 600k, add `needsRehash`.
- `src/auth/authConfig.ts` — bump `PASSWORD_HASH_ITERATIONS` to 600000 (bootstrap admin hash regenerated, Task 6 Step 7).
- `src/auth/userManagement.ts` — add `hasCertScanLicense` to `ManagedLoginUser` + `createManagedUser`.
- `src/data/workspace/workspaceTypes.ts` — add `hasCertScanLicense` to `ManagedUser`.
- `src/data/storage/fileSystemAccess.ts` — route `writeJsonFile` writes through `safeWriteJson`; extend scaffold with `.system/backups` + `templates/` (Task 9).

**Deliberately deferred to later phases:** the per-month `Data/Population/MM-MonthName-YYYY/...` tree (Phase 1), distribution/sample logic (Phases 2–3), and the workspace bootstrap UI gate is Task 10 here but verified manually, not via unit tests.

---

## Task 1: Vitest harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/data/storage/smoke.test.ts` (temporary, deleted in Step 6)

- [ ] **Step 1: Add dev dependencies and scripts**

Run:
```bash
cd /c/Users/Shado/EggBrain/code/x-ray-quality-app-v1
npm install -D vitest
npm install hash-wasm
```
> Note: install whatever `vitest` version `npm` resolves as compatible with the installed Vite 8. Do not pin an older Vitest that forces a Vite downgrade. `hash-wasm` is a runtime dep (used by `passwordCrypto.ts`) but is tree-shaken into the singlefile build only where imported.

Then edit `package.json` `"scripts"` to add:
```json
    "test": "vitest",
    "test:run": "vitest run"
```

- [ ] **Step 2: Create the Vitest config**

Create `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false
  }
});
```
> `environment: "node"` is intentional: every test in this phase exercises pure logic (WebCrypto, the in-memory FS double, the lock queue). Node 24 provides `globalThis.crypto.subtle`, `btoa`, and `atob`, so no DOM is required. UI components are not unit-tested here.

- [ ] **Step 3: Write a smoke test**

Create `src/data/storage/smoke.test.ts`:
```ts
import { expect, test } from "vitest";

test("vitest harness runs and WebCrypto is available", async () => {
  expect(typeof globalThis.crypto?.subtle?.digest).toBe("function");
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("x")
  );
  expect(digest.byteLength).toBe(32);
});
```

- [ ] **Step 4: Run the smoke test**

Run: `npm run test:run -- src/data/storage/smoke.test.ts`
Expected: PASS (1 test). If `crypto.subtle` is undefined, the Node version is too old — confirm Node ≥ 20.

- [ ] **Step 5: Delete the smoke test**

```bash
rm src/data/storage/smoke.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add Vitest harness and hash-wasm dependency"
```

---

## Task 2: In-memory FileSystem double

A test double implementing the existing `DirectoryHandleLike`/`FileHandleLike` contracts from `fileSystemAccess.ts`, so safe-write and scaffold logic can be tested without a browser. It must reproduce the real API's quirks the code relies on: `getFileHandle(name, {create:false})` throws a `NotFoundError`-named error when missing; `createWritable()` truncates then writes.

**Files:**
- Create: `src/data/storage/memoryDirectory.ts`
- Test: `src/data/storage/memoryDirectory.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/storage/memoryDirectory.test.ts`:
```ts
import { expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";

test("missing file getFileHandle throws a NotFoundError", async () => {
  const dir = createMemoryDirectory("root");
  await expect(
    dir.getFileHandle("missing.json", { create: false })
  ).rejects.toMatchObject({ name: "NotFoundError" });
});

test("write then read round-trips text", async () => {
  const dir = createMemoryDirectory("root");
  const handle = await dir.getFileHandle("a.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("hello");
  await writable.close();

  const file = await handle.getFile();
  expect(await file.text()).toBe("hello");
});

test("createWritable truncates previous contents", async () => {
  const dir = createMemoryDirectory("root");
  const handle = await dir.getFileHandle("a.json", { create: true });
  let writable = await handle.createWritable!();
  await writable.write("first-and-longer");
  await writable.close();

  writable = await handle.createWritable!();
  await writable.write("second");
  await writable.close();

  const file = await handle.getFile();
  expect(await file.text()).toBe("second");
});

test("nested directories are created and persist", async () => {
  const dir = createMemoryDirectory("root");
  const sub = await dir.getDirectoryHandle(".system", { create: true });
  await sub.getDirectoryHandle("locks", { create: true });

  const reread = await dir.getDirectoryHandle(".system", { create: false });
  const locks = await reread.getDirectoryHandle("locks", { create: false });
  expect(locks.name).toBe("locks");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/data/storage/memoryDirectory.test.ts`
Expected: FAIL — "Cannot find module './memoryDirectory'".

- [ ] **Step 3: Implement the double**

Create `src/data/storage/memoryDirectory.ts`:
```ts
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
```
> Note: the handle is re-created on each call but shares the same backing `MemoryNode`, mirroring how the real API returns fresh handle objects over persistent storage.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/data/storage/memoryDirectory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/storage/memoryDirectory.ts src/data/storage/memoryDirectory.test.ts
git commit -m "test: add in-memory FileSystem double for storage tests"
```

---

## Task 3: Web Locks wrapper (§11A.6 Tier 1)

Serialize this machine's writes to a named resource. Uses `navigator.locks.request` when present; otherwise falls back to a per-resource in-process promise chain (so tests and non-supporting contexts still serialize correctly within the page).

**Files:**
- Create: `src/data/storage/webLocks.ts`
- Test: `src/data/storage/webLocks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/storage/webLocks.test.ts`:
```ts
import { expect, test } from "vitest";

import { withResourceLock } from "./webLocks";

test("same-resource calls run serially, never interleaved", async () => {
  const events: string[] = [];

  async function critical(tag: string): Promise<void> {
    await withResourceLock("res-a", async () => {
      events.push(`${tag}:start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`${tag}:end`);
    });
  }

  await Promise.all([critical("one"), critical("two")]);

  // Whichever runs first must fully finish before the other starts.
  expect(events).toEqual(
    events[0] === "one:start"
      ? ["one:start", "one:end", "two:start", "two:end"]
      : ["two:start", "two:end", "one:start", "one:end"]
  );
});

test("returns the callback result", async () => {
  const value = await withResourceLock("res-b", async () => 42);
  expect(value).toBe(42);
});

test("releases the lock even when the callback throws", async () => {
  await expect(
    withResourceLock("res-c", async () => {
      throw new Error("boom");
    })
  ).rejects.toThrow("boom");

  // Lock must be free now — a second acquire resolves.
  const after = await withResourceLock("res-c", async () => "ok");
  expect(after).toBe("ok");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/data/storage/webLocks.test.ts`
Expected: FAIL — "Cannot find module './webLocks'".

- [ ] **Step 3: Implement the wrapper**

Create `src/data/storage/webLocks.ts`:
```ts
type LockManagerLike = {
  request: (
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<unknown>
  ) => Promise<unknown>;
};

function getNativeLockManager(): LockManagerLike | null {
  const nav = globalThis.navigator as Navigator & {
    locks?: LockManagerLike;
  };
  return nav?.locks ?? null;
}

// Fallback: one promise chain per resource name, serializing within this thread.
const fallbackChains = new Map<string, Promise<unknown>>();

async function withFallbackLock<T>(
  name: string,
  callback: () => Promise<T>
): Promise<T> {
  const previous = fallbackChains.get(name) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fallbackChains.set(
    name,
    previous.then(() => gate)
  );

  await previous.catch(() => undefined);
  try {
    return await callback();
  } finally {
    release();
    // Drop the chain entry if no one queued behind us.
    if (fallbackChains.get(name) === previous.then(() => gate)) {
      fallbackChains.delete(name);
    }
  }
}

export async function withResourceLock<T>(
  resourceName: string,
  callback: () => Promise<T>
): Promise<T> {
  const manager = getNativeLockManager();
  if (!manager) {
    return withFallbackLock(resourceName, callback);
  }

  return manager.request(
    `xray:${resourceName}`,
    { mode: "exclusive" },
    callback as () => Promise<unknown>
  ) as Promise<T>;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/data/storage/webLocks.test.ts`
Expected: PASS (3 tests). Tests use the fallback path (Node has no `navigator.locks`), which is exactly what we need to prove the serialization contract.

- [ ] **Step 5: Commit**

```bash
git add src/data/storage/webLocks.ts src/data/storage/webLocks.test.ts
git commit -m "feat: add Web Locks wrapper with same-thread fallback"
```

---

## Task 4: Safe-write layer (§16.3)

`safeWriteJson` snapshots the current file to `<name>.bak` (only if the current file parses), writes the new content, re-reads and validates it parses, and restores from `.bak` if validation fails — all inside a Web Lock for that file. `safeReadJson` parses the file and falls back to `.bak` on corruption, flagging recovery.

**Files:**
- Create: `src/data/storage/safeWrite.ts`
- Test: `src/data/storage/safeWrite.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/storage/safeWrite.test.ts`:
```ts
import { expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";

async function readRaw(
  dir: ReturnType<typeof createMemoryDirectory>,
  name: string
): Promise<string> {
  const handle = await dir.getFileHandle(name, { create: false });
  const file = await handle.getFile();
  return file.text();
}

test("write then read round-trips an object", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { hello: "world" });

  const result = await safeReadJson<{ hello: string }>(dir, "a.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.hello).toBe("world");
    expect(result.recoveredFromBak).toBe(false);
  }
});

test("second write snapshots the previous content to .bak", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { v: 1 });
  await safeWriteJson(dir, "a.json", { v: 2 });

  const bak = JSON.parse(await readRaw(dir, "a.json.bak")) as { v: number };
  const live = JSON.parse(await readRaw(dir, "a.json")) as { v: number };
  expect(bak.v).toBe(1);
  expect(live.v).toBe(2);
});

test("safeReadJson recovers from .bak when the live file is corrupt", async () => {
  const dir = createMemoryDirectory();
  await safeWriteJson(dir, "a.json", { v: 1 });
  await safeWriteJson(dir, "a.json", { v: 2 }); // a.json.bak now holds {v:1}

  // Corrupt the live file directly.
  const handle = await dir.getFileHandle("a.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("{ not valid json");
  await writable.close();

  const result = await safeReadJson<{ v: number }>(dir, "a.json");
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.value.v).toBe(1);
    expect(result.recoveredFromBak).toBe(true);
  }
});

test("safeReadJson reports missing files", async () => {
  const dir = createMemoryDirectory();
  const result = await safeReadJson(dir, "nope.json");
  expect(result).toMatchObject({ ok: false, reason: "missing" });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/data/storage/safeWrite.test.ts`
Expected: FAIL — "Cannot find module './safeWrite'".

- [ ] **Step 3: Implement the safe-write layer**

Create `src/data/storage/safeWrite.ts`:
```ts
import type { DirectoryHandleLike } from "./fileSystemAccess";
import { withResourceLock } from "./webLocks";

export type SafeReadResult<T> =
  | { ok: true; value: T; recoveredFromBak: boolean; rawText: string }
  | { ok: false; reason: "missing" | "corrupt" };

function isNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: string }).name === "NotFoundError"
  );
}

async function readText(
  dir: DirectoryHandleLike,
  name: string
): Promise<string | null> {
  try {
    const handle = await dir.getFileHandle(name, { create: false });
    const file = await handle.getFile();
    return await file.text();
  } catch (error) {
    if (isNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function writeText(
  dir: DirectoryHandleLike,
  name: string,
  content: string
): Promise<void> {
  const handle = await dir.getFileHandle(name, { create: true });
  if (!handle.createWritable) {
    throw new Error(`Browser cannot write ${name}.`);
  }
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

function parses(text: string | null): boolean {
  if (text === null) {
    return false;
  }
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export async function safeWriteJson<T>(
  dir: DirectoryHandleLike,
  fileName: string,
  value: T
): Promise<void> {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;

  await withResourceLock(fileName, async () => {
    const current = await readText(dir, fileName);
    if (parses(current)) {
      await writeText(dir, `${fileName}.bak`, current as string);
    }

    await writeText(dir, fileName, serialized);

    const verify = await readText(dir, fileName);
    if (!parses(verify)) {
      const bak = await readText(dir, `${fileName}.bak`);
      if (parses(bak)) {
        await writeText(dir, fileName, bak as string);
      }
      throw new Error(`Safe-write validation failed for ${fileName}.`);
    }
  });
}

export async function safeReadJson<T>(
  dir: DirectoryHandleLike,
  fileName: string
): Promise<SafeReadResult<T>> {
  const live = await readText(dir, fileName);
  if (parses(live)) {
    return {
      ok: true,
      value: JSON.parse(live as string) as T,
      recoveredFromBak: false,
      rawText: live as string
    };
  }

  const bak = await readText(dir, `${fileName}.bak`);
  if (parses(bak)) {
    return {
      ok: true,
      value: JSON.parse(bak as string) as T,
      recoveredFromBak: true,
      rawText: bak as string
    };
  }

  if (live === null && bak === null) {
    return { ok: false, reason: "missing" };
  }
  return { ok: false, reason: "corrupt" };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/data/storage/safeWrite.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/data/storage/safeWrite.ts src/data/storage/safeWrite.test.ts
git commit -m "feat: add safe-write layer with .bak snapshot and restore"
```

---

## Task 5: Route existing writes through safe-write

`fileSystemAccess.ts` currently writes via a bare `writeJsonFile` (truncate + write, no snapshot). Re-implement it on top of `safeWriteJson` so every existing call site (`createWorkspaceStructure`, `acquireEditLock`, `saveJsonWithRevisionCheck`) gains the `.bak`+validate guarantee with no signature change.

**Files:**
- Modify: `src/data/storage/fileSystemAccess.ts:407-423` (the `writeJsonFile` function)
- Test: `src/data/storage/fileSystemAccess.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/data/storage/fileSystemAccess.test.ts`:
```ts
import { expect, test } from "vitest";

import { createMemoryDirectory } from "./memoryDirectory";
import { readJsonFile, writeJsonFile } from "./fileSystemAccess";

test("writeJsonFile produces a .bak snapshot on the second write", async () => {
  const dir = createMemoryDirectory();
  await writeJsonFile(dir, "x.json", { a: 1 });
  await writeJsonFile(dir, "x.json", { a: 2 });

  const live = await readJsonFile<{ a: number }>(dir, "x.json");
  const bak = await readJsonFile<{ a: number }>(dir, "x.json.bak");

  expect(live.ok && live.file.a).toBe(2);
  expect(bak.ok && bak.file.a).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/data/storage/fileSystemAccess.test.ts`
Expected: FAIL — no `.bak` file exists yet, so the `bak` read returns `ok:false` and the assertion fails.

- [ ] **Step 3: Re-implement `writeJsonFile` over safeWriteJson**

In `src/data/storage/fileSystemAccess.ts`, add this import near the top (after the existing imports):
```ts
import { safeWriteJson } from "./safeWrite";
```

Replace the existing `writeJsonFile` function body (currently at lines 407-423) with:
```ts
export async function writeJsonFile<TFile>(
  directoryHandle: DirectoryHandleLike,
  fileName: string,
  value: TFile
): Promise<void> {
  await safeWriteJson(directoryHandle, fileName, value);
}
```
> Behaviour preserved: `safeWriteJson` serializes with `JSON.stringify(value, null, 2)` + trailing newline, identical to the previous implementation, and still creates the file when absent.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/data/storage/fileSystemAccess.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the whole suite + typecheck**

Run: `npm run test:run && npx tsc -b`
Expected: all tests PASS; tsc exits 0 (no type errors introduced).

- [ ] **Step 6: Commit**

```bash
git add src/data/storage/fileSystemAccess.ts src/data/storage/fileSystemAccess.test.ts
git commit -m "feat: route workspace writes through the safe-write layer"
```

---

## Task 6: Argon2id + PBKDF2-600k password hashing (§5.1)

Extend the hash record to support Argon2id (preferred, via `hash-wasm`) and keep PBKDF2-SHA256 as a fallback with the default bumped 210k → 600k. `verifyPasswordHash` handles both algorithms; `needsRehash` flags records below current parameters so login can transparently upgrade them.

**Files:**
- Modify: `src/auth/passwordCrypto.ts`
- Modify: `src/auth/authConfig.ts:7` (`PASSWORD_HASH_ITERATIONS`)
- Test: `src/auth/passwordCrypto.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/auth/passwordCrypto.test.ts`:
```ts
import { expect, test } from "vitest";

import {
  createPasswordHash,
  needsRehash,
  verifyPasswordHash
} from "./passwordCrypto";

test("Argon2id hash verifies the correct password and rejects a wrong one", async () => {
  const record = await createPasswordHash("correct horse");
  expect(record.algorithm).toBe("argon2id");
  expect(await verifyPasswordHash("correct horse", record)).toBe(true);
  expect(await verifyPasswordHash("wrong horse", record)).toBe(false);
});

test("a PBKDF2-600k record still verifies (fallback compatibility)", async () => {
  const record = await createPasswordHash("pw", { algorithm: "PBKDF2-SHA256" });
  expect(record.algorithm).toBe("PBKDF2-SHA256");
  expect(record.iterations).toBeGreaterThanOrEqual(600000);
  expect(await verifyPasswordHash("pw", record)).toBe(true);
});

test("needsRehash flags weak/legacy parameters", async () => {
  const legacy = {
    algorithm: "PBKDF2-SHA256" as const,
    iterations: 210000,
    saltBase64: "AAAA",
    hashBase64: "AAAA"
  };
  expect(needsRehash(legacy)).toBe(true);

  const modern = await createPasswordHash("pw");
  expect(needsRehash(modern)).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/auth/passwordCrypto.test.ts`
Expected: FAIL — `createPasswordHash` does not accept options / `needsRehash` is undefined / `algorithm` is not `argon2id`.

- [ ] **Step 3: Bump the PBKDF2 default**

In `src/auth/authConfig.ts`, change line 7:
```ts
export const PASSWORD_HASH_ITERATIONS = 600000;
```

- [ ] **Step 4: Rewrite `passwordCrypto.ts`**

Replace the entire contents of `src/auth/passwordCrypto.ts` with:
```ts
import { argon2id, argon2Verify } from "hash-wasm";

export type PasswordHashAlgorithm = "argon2id" | "PBKDF2-SHA256";

export type PasswordHashRecord = {
  algorithm: PasswordHashAlgorithm;
  // PBKDF2 fields (absent/ignored for argon2id, which self-describes in its encoded string)
  iterations?: number;
  saltBase64?: string;
  hashBase64?: string;
  // argon2id stores the full PHC-encoded string here
  encoded?: string;
};

const PBKDF2_MIN_ITERATIONS = 600000;
const PBKDF2_HASH_LENGTH_BITS = 256;
const SALT_LENGTH_BYTES = 16;

// Argon2id baseline per OWASP 2026: m=19 MiB, t=2, p=1.
const ARGON2_MEMORY_KIB = 19456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH_BYTES = 32;

type CreateOptions = {
  algorithm?: PasswordHashAlgorithm;
  iterations?: number;
};

export async function createPasswordHash(
  password: string,
  options: CreateOptions = {}
): Promise<PasswordHashRecord> {
  const normalized = normalizePassword(password);

  if (options.algorithm === "PBKDF2-SHA256") {
    return createPbkdf2Hash(normalized, options.iterations ?? PBKDF2_MIN_ITERATIONS);
  }

  // Default: Argon2id, falling back to PBKDF2 if the WASM module is unavailable.
  try {
    const salt = createRandomSalt();
    const encoded = await argon2id({
      password: normalized,
      salt,
      parallelism: ARGON2_PARALLELISM,
      iterations: ARGON2_ITERATIONS,
      memorySize: ARGON2_MEMORY_KIB,
      hashLength: ARGON2_HASH_LENGTH_BYTES,
      outputType: "encoded"
    });
    return { algorithm: "argon2id", encoded };
  } catch {
    return createPbkdf2Hash(normalized, PBKDF2_MIN_ITERATIONS);
  }
}

export async function verifyPasswordHash(
  password: string,
  record: PasswordHashRecord
): Promise<boolean> {
  const normalized = normalizePassword(password);

  if (record.algorithm === "argon2id") {
    if (!record.encoded) {
      return false;
    }
    try {
      return await argon2Verify({ password: normalized, hash: record.encoded });
    } catch {
      return false;
    }
  }

  if (record.algorithm === "PBKDF2-SHA256") {
    if (
      !record.saltBase64 ||
      !record.hashBase64 ||
      !Number.isInteger(record.iterations) ||
      (record.iterations ?? 0) <= 0
    ) {
      return false;
    }
    const salt = base64ToBytes(record.saltBase64);
    const calculated = new Uint8Array(
      await derivePbkdf2(normalized, salt, record.iterations as number)
    );
    return constantTimeEqual(calculated, base64ToBytes(record.hashBase64));
  }

  return false;
}

export function needsRehash(record: PasswordHashRecord): boolean {
  if (record.algorithm === "argon2id") {
    return false;
  }
  if (record.algorithm === "PBKDF2-SHA256") {
    return (record.iterations ?? 0) < PBKDF2_MIN_ITERATIONS;
  }
  return true;
}

async function createPbkdf2Hash(
  normalizedPassword: string,
  iterations: number
): Promise<PasswordHashRecord> {
  const effectiveIterations = Math.max(iterations, PBKDF2_MIN_ITERATIONS);
  const salt = createRandomSalt();
  const hashBuffer = await derivePbkdf2(
    normalizedPassword,
    salt,
    effectiveIterations
  );
  return {
    algorithm: "PBKDF2-SHA256",
    iterations: effectiveIterations,
    saltBase64: bytesToBase64(salt),
    hashBase64: bytesToBase64(new Uint8Array(hashBuffer))
  };
}

function normalizePassword(password: string): string {
  return password.normalize("NFKC");
}

function createRandomSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LENGTH_BYTES);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

async function derivePbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<ArrayBuffer> {
  const encoded = new TextEncoder().encode(password);
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    "raw",
    copyBytesToArrayBuffer(encoded),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  return globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: copyBytesToArrayBuffer(salt),
      iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    PBKDF2_HASH_LENGTH_BITS
  );
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function constantTimeEqual(first: Uint8Array, second: Uint8Array): boolean {
  if (first.length !== second.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < first.length; index += 1) {
    difference |= first[index] ^ second[index];
  }
  return difference === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
```
> Note: `createPasswordHashFromKnownSalt` (used only to regenerate the bootstrap admin hash) is intentionally dropped — Step 7 replaces the bootstrap hashing approach. If `npx tsc -b` reports it is still imported anywhere, see Step 7.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run -- src/auth/passwordCrypto.test.ts`
Expected: PASS (3 tests). Argon2id in `hash-wasm` runs in Node, so the default path is exercised directly.

- [ ] **Step 6: Find any remaining references to the removed helper**

Run: `npx tsc -b`
Expected: either exits 0, or errors pointing at `createPasswordHashFromKnownSalt` / `BOOTSTRAP_ADMIN_PASSWORD_HASH` usage. Resolve them in Step 7.

- [ ] **Step 7: Regenerate the bootstrap admin hash**

The bootstrap admin in `authConfig.ts` ships as a `PasswordHashRecord`. Regenerate it for the new format. Create a throwaway script `scripts/gen-admin-hash.mjs`:
```js
import { argon2id } from "hash-wasm";
import { webcrypto } from "node:crypto";

const salt = new Uint8Array(16);
webcrypto.getRandomValues(salt);
const encoded = await argon2id({
  password: "admin".normalize("NFKC"),
  salt,
  parallelism: 1,
  iterations: 2,
  memorySize: 19456,
  hashLength: 32,
  outputType: "encoded"
});
console.log(JSON.stringify({ algorithm: "argon2id", encoded }, null, 2));
```
Run: `node scripts/gen-admin-hash.mjs`
Copy the printed JSON into `authConfig.ts`, replacing the `BOOTSTRAP_ADMIN_PASSWORD_HASH` object literal. Keep the existing `PasswordHashRecord` import/type. Then:
```bash
rm scripts/gen-admin-hash.mjs
```
> Decide the bootstrap password with the user before shipping; `"admin"` is a placeholder for local dev only. Re-run `npx tsc -b` to confirm the new literal type-checks.

- [ ] **Step 8: Verify login still works end-to-end (manual)**

Run: `npm run dev`, open in Chrome, log in as `admin` / the chosen bootstrap password.
Expected: login succeeds. (If `AuthGate`/`authSession` reference the removed helper, update them to call `verifyPasswordHash`.)

- [ ] **Step 9: Commit**

```bash
git add src/auth/passwordCrypto.ts src/auth/passwordCrypto.test.ts src/auth/authConfig.ts
git commit -m "feat: Argon2id password hashing with PBKDF2-600k fallback and rehash"
```

---

## Task 7: Per-user CertScan license flag (§4, §8, §13.5)

Add `hasCertScanLicense: boolean` to the managed-user model so distribution (Phase 3) can route CertScan rows only to licensed users. Default `false`.

**Files:**
- Modify: `src/data/workspace/workspaceTypes.ts:84-95` (`ManagedUser` type)
- Modify: `src/auth/userManagement.ts` (`ManagedLoginUser`, `createManagedUser`)
- Test: `src/auth/userManagement.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/auth/userManagement.test.ts`:
```ts
import { expect, test } from "vitest";

import { createManagedUser } from "./userManagement";

const baseParams = {
  username: "Sara",
  displayName: "Sara Q",
  role: "employee" as const,
  passwordHash: { algorithm: "argon2id" as const, encoded: "x" },
  isActive: true
};

test("createManagedUser defaults hasCertScanLicense to false", () => {
  const user = createManagedUser(baseParams);
  expect(user.hasCertScanLicense).toBe(false);
  expect(user.username).toBe("sara");
});

test("createManagedUser honours an explicit license flag", () => {
  const user = createManagedUser({ ...baseParams, hasCertScanLicense: true });
  expect(user.hasCertScanLicense).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/auth/userManagement.test.ts`
Expected: FAIL — `hasCertScanLicense` is not a property on the returned user / not an accepted param.

- [ ] **Step 3: Add the field to the disk type**

In `src/data/workspace/workspaceTypes.ts`, add `hasCertScanLicense` to the `ManagedUser` type (after `isActive` on line 91):
```ts
export type ManagedUser = {
  id: string;
  username: string;
  displayName: string;
  password: string;
  role: AuthRole;
  isActive: boolean;
  hasCertScanLicense: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};
```

- [ ] **Step 4: Add the field to the login-user model and constructor**

In `src/auth/userManagement.ts`, extend the `ManagedLoginUser` type and `createManagedUser`. Change the type (lines 4-8):
```ts
export type ManagedLoginUser = LoginUser & {
  id: string;
  hasCertScanLicense: boolean;
  createdAt: string;
  updatedAt: string;
};
```
And update `createManagedUser` (its params object and return) to accept and set the flag:
```ts
export function createManagedUser(params: {
  username: string;
  displayName: string;
  role: AuthRole;
  passwordHash: PasswordHashRecord;
  isActive: boolean;
  hasCertScanLicense?: boolean;
}): ManagedLoginUser {
  const now = new Date().toISOString();

  return {
    id: createUserId(),
    username: normalizeUsername(params.username),
    displayName: params.displayName.trim(),
    role: params.role,
    passwordHash: params.passwordHash,
    isActive: params.isActive,
    hasCertScanLicense: params.hasCertScanLicense ?? false,
    createdAt: now,
    updatedAt: now
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run -- src/auth/userManagement.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Typecheck for fallout**

Run: `npx tsc -b`
Expected: exits 0. If `UserManagement/index.tsx` constructs users or renders a user table, it may need a license checkbox/column — note any errors; a minimal fix is to pass `hasCertScanLicense: false` at existing call sites and add the admin UI checkbox in this step (a labelled `<input type="checkbox">` bound to the flag, Arabic label "رخصة CertScan").

- [ ] **Step 7: Commit**

```bash
git add src/data/workspace/workspaceTypes.ts src/auth/userManagement.ts src/auth/userManagement.test.ts src/components/Sidebar/Tabs/UserManagement/index.tsx
git commit -m "feat: add per-user hasCertScanLicense flag"
```

---

## Integration tasks (browser-verified, no unit tests)

These three tasks are inherently browser/UI glue — they touch `navigator`, IndexedDB, `showDirectoryPicker`, and React rendering, which the node test environment cannot exercise. Implement them with manual verification in Chrome. Each should still be a small, focused commit.

### Task 8: Persist the workspace handle in IndexedDB (§16.2)

**Files:** Create `src/data/storage/handleStore.ts`; modify `src/data/workspace/WorkspaceProvider.tsx`.

- [ ] **Step 1:** Implement `handleStore.ts` with `saveWorkspaceHandle(handle)`, `loadWorkspaceHandle()`, `clearWorkspaceHandle()` using a single IndexedDB store (`xray-workspace` → `handles` → key `current`). `FileSystemDirectoryHandle` is structured-cloneable, so it persists directly.
- [ ] **Step 2:** On `WorkspaceProvider` mount: call `loadWorkspaceHandle()`; if a handle is returned, call its `queryPermission({mode:"readwrite"})`. If `"granted"`, adopt it silently. If `"prompt"`, surface a "reconnect workspace" button that calls `requestPermission` on click (gesture required). If `"denied"` or absent, fall back to the existing pick flow. On successful pick, `saveWorkspaceHandle`.
- [ ] **Step 3 (manual verify):** `npm run dev`; pick a folder; reload the page; confirm the workspace reconnects without re-picking (one permission click at most).
- [ ] **Step 4:** Commit `feat: persist workspace handle across sessions via IndexedDB`.

### Task 9: Extend the `.system` scaffold (§6)

**Files:** Modify `src/data/storage/fileSystemAccess.ts` (`createWorkspaceStructure`) and `src/data/workspace/workspaceDefaults.ts`.

- [ ] **Step 1:** Add `backups` to `SYSTEM_SUBFOLDERS` and a top-level `templates` folder constant in `workspaceDefaults.ts`.
- [ ] **Step 2:** In `createWorkspaceStructure`, create `.system/backups/` and `templates/` alongside the existing `.system/{locks,audit}/`. (Per-month `Population/MM-MonthName-YYYY/` folders are Phase 1 — not created here.)
- [ ] **Step 3:** Add a quick unit test in `fileSystemAccess.test.ts` using `createMemoryDirectory` asserting `.system/backups` and `templates` exist after `createWorkspaceStructure`. Run `npm run test:run`.
- [ ] **Step 4:** Commit `feat: scaffold .system/backups and templates folders`.

### Task 10: Wire the workspace bootstrap into the app shell

**Files:** Create `src/data/workspace/WorkspaceGate.tsx`; modify `src/App.tsx`.

> Context: today `WorkspaceProvider` is mounted in `main.tsx` but `App.tsx` never consumes it — the on-disk layer is dead-wired. This task makes workspace selection a real gate.

- [ ] **Step 1:** Build `WorkspaceGate` that, in order: feature-detects `showDirectoryPicker` (else render the Arabic `unsupported_browser` message — "هذا التطبيق يتطلب Chrome أو Edge على سطح المكتب"); restores/picks the workspace (Task 8); runs `checkWorkspaceStructure`; offers structure creation when `missing_structure` and the user is admin; renders children only when status is `ready`.
- [ ] **Step 2:** Wrap `AppContent` with `WorkspaceGate` inside `App.tsx` (alongside `AuthGate`). Decide order with the spec: AuthGate first (who are you), then WorkspaceGate (where is the data).
- [ ] **Step 3 (manual verify):** Fresh load in Chrome → prompted to pick workspace → structure check → app renders. In Firefox → unsupported message.
- [ ] **Step 4:** Commit `feat: gate the app behind workspace selection`.

---

## Self-Review

**Spec coverage (Phase 0 scope):**
- §16.3 safe-write → Tasks 4, 5 ✓
- §11A.6 T1 Web Locks → Task 3 ✓
- §5.1/§16.4 auth (Argon2id + PBKDF2-600k + rehash) → Task 6 ✓
- §4/§8/§13.5 CertScan license flag → Task 7 ✓
- §16.2 handle persistence → Task 8 ✓
- §6 `.system/backups` + `templates` scaffold → Task 9 ✓
- §2.1/§16.1 Chromium gate + workspace wiring → Task 10 ✓
- Test harness (enables all later TDD) → Tasks 1, 2 ✓
- **Out of Phase 0 (correctly deferred):** per-month folder tree (§6 Population/) → Phase 1; Tier-2 advisory-lock revision retries beyond what exists (§11A.6 T2) → revisit when supervisors write shared logs in Phase 3; daily backup routine (§11B) → Phase 7.

**Type consistency:** `PasswordHashRecord` gains optional `encoded` + optional PBKDF2 fields (Task 6) and is consumed unchanged by `createManagedUser` (Task 7, passes the record through). `DirectoryHandleLike`/`FileHandleLike` are imported from `fileSystemAccess.ts` by both `memoryDirectory.ts` and `safeWrite.ts` — same names. `withResourceLock` signature is identical across `webLocks.ts` and its consumer `safeWrite.ts`. `safeWriteJson(dir, fileName, value)` matches its call in the re-implemented `writeJsonFile`.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The one human decision (bootstrap admin password, Task 6 Step 7) is explicitly flagged for user input, not left vague.
