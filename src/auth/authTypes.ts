import type { PasswordHashRecord } from "./passwordCrypto";

export type AuthRole = "guest" | "employee" | "supervisor" | "manager" | "admin";

export type LoginUser = {
  username: string;
  displayName: string;
  role: AuthRole;
  passwordHash: PasswordHashRecord;
  isActive: boolean;
};

export type PublicLoginUser = {
  username: string;
  displayName: string;
};

export type AuthSession = {
  role: AuthRole;
  username: string;
  loginAt: string;
  /** "demo" = read-only, in-memory preview session (the built-in viewer account). */
  mode?: "demo";
};

export type MessageType = "ok" | "bad" | "";