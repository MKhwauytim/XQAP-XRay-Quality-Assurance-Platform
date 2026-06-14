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
