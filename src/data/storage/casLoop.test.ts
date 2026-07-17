import { describe, expect, it } from "vitest";

import { casLoop } from "./casLoop";
import { createMemoryDirectory } from "./memoryDirectory";
import { safeReadJson, safeWriteJson } from "./safeWrite";

describe("casLoop — lost-update hardening (verify callback)", () => {
  it("retries when a delayed verify detects a concurrent clobber", async () => {
    // Reproduces the interleaving: A read / B read / A commit-verify-ok /
    // B commit-clobbers / (A delayed verify) — without `verify`, A would report
    // success while B's write silently overwrote it. The delayed re-read catches it.
    let attempts = 0;
    let fileToken = "";
    const result = await casLoop<string>(
      async (writeToken) => {
        attempts += 1;
        fileToken = writeToken; // our committed write; in-attempt read-back is ours
        if (attempts === 1) {
          // A different machine clobbers AFTER our read-back verified but during
          // the post-success settle delay, before our verify re-read runs.
          setTimeout(() => {
            fileToken = "intruder-token";
          }, 0);
        }
        return {
          done: true,
          result: "A-committed",
          verify: async () => fileToken === writeToken,
        };
      },
      { maxRetries: 5, baseDelayMs: 1 }
    );

    expect(result).toBe("A-committed");
    expect(attempts).toBe(2); // first attempt's success was rejected by verify
  });

  it("catches a lost update against a memory directory and re-wins on retry", async () => {
    const dir = createMemoryDirectory("root");
    const FILE = "shared.json";
    type Doc = { revision: number; _writeToken?: string; value: string };

    const loadDoc = async (): Promise<Doc> => {
      const r = await safeReadJson<Doc>(dir, FILE);
      return r.ok ? r.value : { revision: 0, value: "" };
    };

    let attempts = 0;
    const outcome = await casLoop<string>(
      async (writeToken) => {
        attempts += 1;
        const existing = await loadDoc();
        const nextRevision = existing.revision + 1;
        await safeWriteJson<Doc>(dir, FILE, {
          revision: nextRevision,
          _writeToken: writeToken,
          value: "A",
        });
        const verify = await loadDoc();
        if (verify.revision !== nextRevision || verify._writeToken !== writeToken) {
          return { done: false };
        }
        if (attempts === 1) {
          // Intruder B (a different machine) clobbers the file after A's
          // read-back verified but before A's delayed verify re-read.
          setTimeout(() => {
            void safeWriteJson<Doc>(dir, FILE, {
              revision: nextRevision,
              _writeToken: "intruder",
              value: "B",
            });
          }, 0);
        }
        return {
          done: true,
          result: "A-committed",
          verify: async () => (await loadDoc())._writeToken === writeToken,
        };
      },
      { maxRetries: 5, baseDelayMs: 1 }
    );

    expect(outcome).toBe("A-committed");
    expect(attempts).toBe(2);
    const final = await loadDoc();
    expect(final._writeToken).not.toBe("intruder"); // A re-won on retry
    expect(final.value).toBe("A");
  });

  it("does not require verify — legacy done:true attempts still succeed", async () => {
    let attempts = 0;
    const result = await casLoop<number>(async () => {
      attempts += 1;
      return { done: true, result: 42 };
    });
    expect(result).toBe(42);
    expect(attempts).toBe(1);
  });
});

describe("casLoop — terminal permission-error classification", () => {
  it("aborts immediately (no retries) on a NotAllowedError", async () => {
    let attempts = 0;
    const result = await casLoop<string>(
      async () => {
        attempts += 1;
        const err = new Error("The request is not allowed by the user agent");
        err.name = "NotAllowedError";
        throw err;
      },
      { maxRetries: 5, baseDelayMs: 1 }
    );
    expect(attempts).toBe(1);
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("فقد الوصول إلى مجلد العمل"),
    });
  });

  it("aborts on a NoModificationAllowedError", async () => {
    const byName = await casLoop<string>(
      async () => {
        const err = new Error("boom");
        err.name = "NoModificationAllowedError";
        throw err;
      },
      { maxRetries: 5, baseDelayMs: 1 }
    );
    expect(byName).toEqual({
      ok: false,
      error: expect.stringContaining("فقد الوصول إلى مجلد العمل"),
    });

  });

  it("does not misclassify a transient NotReadableError as lost permission", async () => {
    let attempts = 0;
    const result = await casLoop<string>(
      async () => {
        attempts += 1;
        const error = new Error("Could not be read due to temporary permission problems");
        error.name = "NotReadableError";
        throw error;
      },
      { maxRetries: 3, baseDelayMs: 1 }
    );

    expect(attempts).toBe(3);
    expect(result).toEqual({
      ok: false,
      error: "Could not be read due to temporary permission problems",
    });
  });

  it("keeps retrying generic conflicts and returns the conflict error after exhaustion", async () => {
    let attempts = 0;
    const result = await casLoop<string>(
      async () => {
        attempts += 1;
        return { done: false };
      },
      { maxRetries: 3, baseDelayMs: 1, conflictError: "تعارض في الكتابة" }
    );
    expect(attempts).toBe(3);
    expect(result).toEqual({ ok: false, error: "تعارض في الكتابة" });
  });
});
