import type { PasswordHashRecord } from "./passwordCrypto";

export const ADMIN_SHORTCUT_KEYS = ["a", "t", "ش", "ف"] as const;

export const BOOTSTRAP_ADMIN_USERNAME = "admin";

// ── Demo / preview viewer account ───────────────────────────────────────────
// Typing these credentials at the login screen mounts an in-memory demo
// workspace (no real folder, read-only) so the app can be explored end-to-end
// without picking a workspace. The session gets admin-level visibility but all
// writes/saves are disabled (exports still work). It only ever touches a fake
// in-memory workspace — never the user's real data.
//
// To REMOVE this account entirely, delete this block and its uses in
// AuthGate.tsx (the viewer-credential check in `loginAsEmployee`).
export const VIEWER_USERNAME = "viewer";
export const VIEWER_PASSWORD = "view";

// Rotated 2026-06-23: strong passcode, Argon2id (m=19456,t=2,p=1). See docs/EDIT_LOG.md v2.
// NOTE: this hash ships in the client bundle. Security here is advisory-only (no backend);
// keep the passcode strong because the hash is offline-crackable by anyone with the build.
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$ptZbFeX582X4+1WJnQ53bw$xyPiz56XTjHm+9hpNiv1efZfLJGPMNZYW3mIT/7D3lI"
};
