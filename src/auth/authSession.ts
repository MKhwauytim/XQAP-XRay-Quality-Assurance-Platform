import type { AuthRole, AuthSession } from "./authTypes";

// Auth state is intentionally runtime-only. Durable app data belongs in the
// selected workspace folder, not in browser storage.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Admin-only role impersonation for testing other roles' views/permissions.
// Runtime-only and never persisted.
const VALID_ROLES: AuthRole[] = ["guest", "employee", "supervisor", "manager", "admin"];
let runtimeSession: AuthSession | null = null;
let runtimePreviewRole: AuthRole | null = null;

export function readPreviewRole(): AuthRole | null {
  return runtimePreviewRole;
}

export function setPreviewRole(role: AuthRole | null): void {
  runtimePreviewRole = role && VALID_ROLES.includes(role) ? role : null;
}

function isExpired(session: AuthSession): boolean {
  const loginTime = Date.parse(session.loginAt);
  if (Number.isNaN(loginTime)) {
    return true;
  }
  return Date.now() - loginTime > SESSION_TTL_MS;
}

function isValidSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const session = value as Partial<AuthSession>;

  const hasValidRole =
    session.role === "guest" ||
    session.role === "employee" ||
    session.role === "supervisor" ||
    session.role === "manager" ||
    session.role === "admin";

  const hasValidUsername =
    typeof session.username === "string" && session.username.trim().length > 0;

  const hasValidLoginDate =
    typeof session.loginAt === "string" &&
    !Number.isNaN(Date.parse(session.loginAt));

  return hasValidRole && hasValidUsername && hasValidLoginDate;
}

// The real authenticated session, ignoring any role-preview override. Use this for
// identity/auth decisions (login validation, gating the impersonation control itself).
export function readRealSession(): AuthSession | null {
  if (!runtimeSession || !isValidSession(runtimeSession) || isExpired(runtimeSession)) {
    runtimeSession = null;
    return null;
  }

  return runtimeSession;
}

// The effective session used throughout the app UI: the real identity, with the role
// swapped to the preview role when a real admin is impersonating another role. Username
// and identity stay real, so actions remain attributed to the actual admin.
export function readSession(): AuthSession | null {
  const real = readRealSession();
  if (!real || real.role !== "admin") {
    return real;
  }
  const preview = readPreviewRole();
  return preview && preview !== real.role ? { ...real, role: preview } : real;
}

export function writeSession(session: AuthSession): void {
  runtimeSession = session;
}

export function clearSession(): void {
  runtimeSession = null;
  setPreviewRole(null);
}
