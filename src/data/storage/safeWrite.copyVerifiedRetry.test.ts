// Fix round 2 (Task 4 / A2 review): `copyFileBytesVerified`'s opt-in
// `retryMissingSource` option. See its own doc comment in `safeWrite.ts` for
// the full rationale — this file pins the contract in both directions: the
// default (option OFF) behaviour is byte-for-byte unchanged from before this
// option existed, and the new option actually rides the retryMissing ladder
// when turned on.

import { describe, expect, it } from "vitest";

import { createMemoryDirectory, setSimulatedFaults } from "./memoryDirectory";
import { copyFileBytesVerified } from "./safeWrite";
import { VERIFY_READBACK_RETRY_DELAYS_MS } from "./transientFileErrors";

describe("copyFileBytesVerified — retryMissingSource opt-in", () => {
  it("default (option omitted): a missing source resolves to source_missing immediately, with no retry", async () => {
    const root = createMemoryDirectory("root");
    const startedAt = performance.now();
    const outcome = await copyFileBytesVerified(root, "never-written.bin", root, "archive.bin");
    const elapsed = performance.now() - startedAt;

    expect(outcome).toEqual({ status: "source_missing" });
    // Comfortably under even the shortest rung of the retry ladder — no wait
    // happened at all.
    expect(elapsed).toBeLessThan(VERIFY_READBACK_RETRY_DELAYS_MS[0]!);
  });

  it("retryMissingSource: false (explicit) behaves exactly like the option being omitted", async () => {
    const root = createMemoryDirectory("root");
    const outcome = await copyFileBytesVerified(root, "never-written.bin", root, "archive.bin", {
      retryMissingSource: false,
    });
    expect(outcome).toEqual({ status: "source_missing" });
  });

  it("retryMissingSource: true survives a transient NotFound on the source and copies it", async () => {
    const root = createMemoryDirectory("root");
    const dir = await root.getDirectoryHandle("d", { create: true });
    const handle = await dir.getFileHandle("thing.bin", { create: true });
    const writable = await handle.createWritable?.();
    if (!writable) throw new Error("memory directory handle must support createWritable");
    await writable.write("hello-bytes");
    await writable.close();

    // Fails 3 times then lets it through — well inside the 8-rung ladder's
    // budget, so this resolves in well under a second.
    setSimulatedFaults(root, [
      { operation: "getFileHandle", name: "thing.bin", create: false, errorName: "NotFoundError", times: 3 },
    ]);

    const outcome = await copyFileBytesVerified(dir, "thing.bin", dir, "archive.bin", {
      retryMissingSource: true,
    });
    setSimulatedFaults(root, []);

    expect(outcome).toEqual({ status: "copied", bytes: 11 });
  });

  it(
    "retryMissingSource: true still resolves to source_missing for a genuinely absent file, after exhausting the ladder",
    async () => {
      const root = createMemoryDirectory("root");
      const outcome = await copyFileBytesVerified(root, "never-written.bin", root, "archive.bin", {
        retryMissingSource: true,
      });
      expect(outcome).toEqual({ status: "source_missing" });
    },
    20_000
  );
});
