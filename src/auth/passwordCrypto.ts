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
