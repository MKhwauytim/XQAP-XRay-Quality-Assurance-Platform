import type { PasswordHashRecord } from "./passwordCrypto";

export const LOGIN_SYSTEM_VERSION = "1.2.0";

export const SESSION_KEY = "xray_local_login_session_v1";

export const ADMIN_SHORTCUT_KEYS = ["a", "t", "ش", "ف"] as const;

export const BOOTSTRAP_ADMIN_USERNAME = "admin";

export const BOOTSTRAP_ADMIN_PASSWORD_HASH: PasswordHashRecord = {
  algorithm: "argon2id",
  encoded: "$argon2id$v=19$m=19456,t=2,p=1$Q0EXc66ZzrZ7R+3ZeFyg/w$hr4m5BK1wKMt5JwvYnSVyGZqHKC95FbPsoR9nVsoUIo"
};
