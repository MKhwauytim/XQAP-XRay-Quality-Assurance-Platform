import type { PasswordHashRecord } from "./passwordCrypto";

export const LOGIN_SYSTEM_VERSION = "1.3.0";

export const ADMIN_SHORTCUT_KEYS = ["a", "t", "ش", "ف"] as const;

export const BOOTSTRAP_ADMIN_USERNAME = "admin";

// Rotated 2026-06-23: strong passcode, Argon2id (m=19456,t=2,p=1). See docs/EDIT_LOG.md v2.
// NOTE: this hash ships in the client bundle. Security here is advisory-only (no backend);
// keep the passcode strong because the hash is offline-crackable by anyone with the build.
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$ptZbFeX582X4+1WJnQ53bw$xyPiz56XTjHm+9hpNiv1efZfLJGPMNZYW3mIT/7D3lI"
};
