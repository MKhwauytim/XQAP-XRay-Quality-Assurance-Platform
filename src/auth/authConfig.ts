import type { PasswordHashRecord } from "./passwordCrypto";

export const ADMIN_SHORTCUT_KEYS = ["a", "t", "ش", "ف"] as const;

export const BOOTSTRAP_ADMIN_USERNAME = "admin";

// ── Demo account (demo / demo) ──────────────────────────────────────────────
// The ONE demo entry (2026-08-26, owner request — replaces the old hidden
// viewer/view passcode): signing in with these credentials — from the
// workspace picker's «الدخول التجريبي» dialog or the ordinary login form —
// mounts a WRITABLE in-memory demo workspace seeded with a realistic month
// (~100-row sample, per-employee queues), so every flow (answering,
// reassignment, reports, exports) can be demonstrated end-to-end without the
// File System Access API and without ever touching real data. The session has
// the admin role plus the role-preview switch, so the demo can walk through
// every role's view; `mode: "demo"` keeps it runtime-only (never persisted)
// and everything it writes lives in memory and vanishes on logout.
//
// To REMOVE the demo entirely, delete this block and its uses in AuthGate.tsx
// (the demo-credential check in `loginAsEmployee` + the auto-login effect) and
// WorkspaceGate.tsx (the demo dialog).
export const DEMO_USERNAME = "demo";
export const DEMO_PASSWORD = "demo";

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
