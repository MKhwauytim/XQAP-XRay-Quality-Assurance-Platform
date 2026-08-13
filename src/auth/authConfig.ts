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

// Rotated 2026-08-13 (owner request): the shipped DEFAULT admin passcode is now
// "admin" — Argon2id (m=19456,t=2,p=1).
//
// This is only the FALLBACK. Once an admin sets a passcode from the Settings tab
// ("حساب المدير"), the workspace-stored hash in `UserManagementState.adminAccount`
// wins and this constant is never consulted again for that workspace — see
// `resolveAdminPasswordHash` in userManagement.ts.
//
// NOTE: this hash ships in the client bundle. Security here is advisory-only (no backend);
// a trivially-guessable default passcode gives no protection at all against anyone who can
// open the app, so change it from Settings before the app is used with real data.
export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$uRYUUaiwO/CalHp5WPGDvQ$X4tdyVAkKZvI3o/JSYqpLXFRYVmPdRX0gsupAzKjIs8"
};
