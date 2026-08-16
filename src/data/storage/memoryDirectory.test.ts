import { expect, test } from "vitest";

import { createMemoryDirectory, setSimulatedWritePermission, getReadLog, clearReadLog } from "./memoryDirectory";

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

// ── Read-log harness (Large-Population Performance Proposal, Phase A characterization) ──

test("read log is empty by default (trackReads off) even after reads", async () => {
  const dir = createMemoryDirectory("root");
  const handle = await dir.getFileHandle("a.json", { create: true });
  await handle.getFile();
  expect(getReadLog(dir)).toEqual([]);
});

test("trackReads: true records the full relative path of every getFile() call", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  const sub = await dir.getDirectoryHandle("2-processed", { create: true });
  const handle = await sub.getFileHandle("population.final.json", { create: true });
  await handle.getFile();
  await handle.getFile();

  expect(getReadLog(dir)).toEqual([
    "2-processed/population.final.json",
    "2-processed/population.final.json",
  ]);
});

test("read log is shared and visible from any handle in the tree, root or descendant", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  const sub = await dir.getDirectoryHandle("raw", { create: true });
  const handle = await sub.getFileHandle("risk.raw.json", { create: true });
  await handle.getFile();

  expect(getReadLog(sub)).toEqual(["raw/risk.raw.json"]);
});

test("clearReadLog resets the log in place without needing a new directory", async () => {
  const dir = createMemoryDirectory("root", { trackReads: true });
  const handle = await dir.getFileHandle("a.json", { create: true });
  await handle.getFile();
  expect(getReadLog(dir)).toEqual(["a.json"]);

  clearReadLog(dir);
  expect(getReadLog(dir)).toEqual([]);

  await handle.getFile();
  expect(getReadLog(dir)).toEqual(["a.json"]);
});

test("getReadLog/clearReadLog are no-ops on a handle that isn't a memory directory", () => {
  expect(getReadLog({} as never)).toEqual([]);
  expect(() => clearReadLog({} as never)).not.toThrow();
});

/**
 * Byte fidelity. The double used to hold file content as a JS string, which
 * cannot represent a gzip member at all — a compressed fixture would have been
 * silently mangled by the UTF-8 round trip, so no test of the compressed storage
 * path could have been trusted. These pin the byte behaviour the string version
 * could not offer, alongside the text behaviour every other test still relies on.
 */
test("round-trips arbitrary bytes, including sequences that are not valid UTF-8", async () => {
  const dir = createMemoryDirectory();
  const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xfe, 0x00, 0x80, 0xc0, 0x41]);

  const handle = await dir.getFileHandle("body.gz", { create: true });
  const writable = await handle.createWritable!();
  await (writable as unknown as { write: (d: Uint8Array) => Promise<void> }).write(bytes);
  await writable.close();

  const file = await handle.getFile();
  expect(file.size).toBe(bytes.byteLength);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
});

test("mixes text and byte writes in one stream, concatenating them exactly", async () => {
  const dir = createMemoryDirectory();
  const handle = await dir.getFileHandle("mixed.bin", { create: true });
  const writable = await handle.createWritable!();
  const wide = writable as unknown as { write: (d: string | Uint8Array) => Promise<void> };
  await wide.write('{"format":"x"}\n');
  await wide.write(new Uint8Array([0x1f, 0x8b, 0x08]));
  await writable.close();

  const file = await handle.getFile();
  const actual = new Uint8Array(await file.arrayBuffer());
  expect(Array.from(actual.subarray(0, 15))).toEqual(
    Array.from(new TextEncoder().encode('{"format":"x"}\n'))
  );
  expect(Array.from(actual.subarray(15))).toEqual([0x1f, 0x8b, 0x08]);
});

test("text written as a string still decodes through file.text(), Arabic included", async () => {
  const dir = createMemoryDirectory();
  const handle = await dir.getFileHandle("ar.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write('{"note":"مراجعة الأشعة"}');
  await writable.close();

  expect(await (await handle.getFile()).text()).toBe('{"note":"مراجعة الأشعة"}');
});

test("a byte slice of a file with multi-byte characters is exact", async () => {
  const dir = createMemoryDirectory();
  const handle = await dir.getFileHandle("ar.json", { create: true });
  const writable = await handle.createWritable!();
  await writable.write("مراجعة");
  await writable.close();

  const file = await handle.getFile();
  // 6 Arabic characters, 2 bytes each — a byte-addressed slice must see 12.
  expect(file.size).toBe(12);
  expect(new Uint8Array(await file.slice(0, 2).arrayBuffer())).toEqual(
    new TextEncoder().encode("م")
  );
});
