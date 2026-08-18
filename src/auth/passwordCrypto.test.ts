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

// A damaged legacy record must authenticate-fail, not throw: the login submit
// handlers (`AuthGate.loginAsEmployee` / `loginAsBootstrapAdmin`) call this with
// no try/catch, so a rejection there kills the handler — no error message, no
// failed-attempt counter, no log entry, just a dead «دخول» button.
test("a malformed PBKDF2 record fails verification instead of throwing", async () => {
  const notBase64 = {
    algorithm: "PBKDF2-SHA256" as const,
    iterations: 600000,
    saltBase64: "!!!not base64!!!",
    hashBase64: "also***bad"
  };
  await expect(verifyPasswordHash("123", notBase64)).resolves.toBe(false);

  const truncated = {
    algorithm: "PBKDF2-SHA256" as const,
    iterations: 600000,
    saltBase64: "AAAA",
    hashBase64: "n1Rp8sQz1"
  };
  await expect(verifyPasswordHash("123", truncated)).resolves.toBe(false);
});

test("an unknown algorithm fails verification without throwing", async () => {
  const unknown = { algorithm: "md5" as unknown as "argon2id", encoded: "x" };
  await expect(verifyPasswordHash("123", unknown)).resolves.toBe(false);
});
