import { expect, test } from "vitest";

import { createMemoryDirectory, setSimulatedWritePermission } from "./memoryDirectory";

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

// ── Simulated write-permission state (added for PR #36's write-gate follow-up) ──

test("default permission is granted (no options) — every pre-existing fixture is unaffected", async () => {
  const dir = createMemoryDirectory("root");
  expect(await dir.queryPermission?.({ mode: "readwrite" })).toBe("granted");
  await expect(dir.getFileHandle("a.json", { create: true })).resolves.toBeTruthy();
});

test("a create:true call throws a simulated NotAllowedError while permission is only \"prompt\"", async () => {
  const dir = createMemoryDirectory("root", { initialWritePermission: "prompt" });
  await expect(
    dir.getFileHandle("a.json", { create: true })
  ).rejects.toMatchObject({ name: "NotAllowedError" });
  await expect(
    dir.getDirectoryHandle("sub", { create: true })
  ).rejects.toMatchObject({ name: "NotAllowedError" });
});

test("requestPermission transitions prompt -> the configured outcome, unblocking create:true on \"granted\"", async () => {
  const dir = createMemoryDirectory("root", {
    initialWritePermission: "prompt",
    writePermissionRequestOutcome: "granted",
  });
  const result = await dir.requestPermission?.({ mode: "readwrite" });
  expect(result).toBe("granted");
  await expect(dir.getFileHandle("a.json", { create: true })).resolves.toBeTruthy();
});

test("requestPermission transitioning to \"denied\" still blocks create:true afterward", async () => {
  const dir = createMemoryDirectory("root", {
    initialWritePermission: "prompt",
    writePermissionRequestOutcome: "denied",
  });
  await dir.requestPermission?.({ mode: "readwrite" });
  await expect(dir.queryPermission?.({ mode: "readwrite" })).resolves.toBe("denied");
  await expect(
    dir.getFileHandle("a.json", { create: true })
  ).rejects.toMatchObject({ name: "NotAllowedError" });
});

test("a \"read\" mode query always reports granted regardless of the readwrite state", async () => {
  const dir = createMemoryDirectory("root", { initialWritePermission: "prompt" });
  await expect(dir.queryPermission?.({ mode: "read" })).resolves.toBe("granted");
  await expect(dir.queryPermission?.()).resolves.toBe("granted");
});

test("permission state is shared between a directory and its children, in both directions", async () => {
  const dir = createMemoryDirectory("root", { initialWritePermission: "prompt" });
  const child = await dir.getDirectoryHandle("sub", { create: false }).catch(() => null);
  // create:false does not require write permission — reads a nonexistent dir as NotFoundError, not NotAllowedError.
  expect(child).toBeNull();

  await dir.requestPermission?.({ mode: "readwrite" }); // -> granted (default outcome)
  const sub = await dir.getDirectoryHandle("sub", { create: true });
  // The child handle must observe the SAME (now-granted) shared state, not its own fresh "granted" default.
  await expect(sub.getFileHandle("nested.json", { create: true })).resolves.toBeTruthy();
});

test("setSimulatedWritePermission flips an already-connected handle's state after the fact", async () => {
  const dir = createMemoryDirectory("root"); // granted by default
  await expect(dir.getFileHandle("a.json", { create: true })).resolves.toBeTruthy();

  setSimulatedWritePermission(dir, "prompt", "denied");
  await expect(
    dir.getFileHandle("b.json", { create: true })
  ).rejects.toMatchObject({ name: "NotAllowedError" });
});

test("setSimulatedWritePermission is a no-op on a handle that isn't a memory directory", () => {
  expect(() => setSimulatedWritePermission({} as never, "denied")).not.toThrow();
});
