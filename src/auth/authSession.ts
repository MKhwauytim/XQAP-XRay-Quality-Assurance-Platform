import { SESSION_KEY } from "./authConfig";
import type { AuthRole, AuthSession } from "./authTypes";

// Sessions persist across browser/tab restarts for this long, measured from loginAt.
// After expiry the user must sign in again. (Stored in localStorage, not sessionStorage.)
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Admin-only role impersonation for testing other roles' views/permissions.
// Stored in sessionStorage so it never outlives the tab and can't permanently change
// what a user sees. Only applied when the real role is admin.
const PREVIEW_ROLE_KEY = "xray_preview_role_v1";
const VALID_ROLES: AuthRole[] = ["guest", "employee", "supervisor", "manager", "admin"];

export function readPreviewRole(): AuthRole | null {
  try {
    const value = sessionStorage.getItem(PREVIEW_ROLE_KEY);
    return value && (VALID_ROLES as string[]).includes(value)
      ? (value as AuthRole)
      : null;
  } catch {
    return null;
  }
}

export function setPreviewRole(role: AuthRole | null): void {
  try {
    if (role) {
      sessionStorage.setItem(PREVIEW_ROLE_KEY, role);
    } else {
      sessionStorage.removeItem(PREVIEW_ROLE_KEY);
    }
  } catch {
    /* sessionStorage unavailable — ignore */
  }
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
  try {
    const rawValue = localStorage.getItem(SESSION_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isValidSession(parsedValue) || isExpired(parsedValue)) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }

    return parsedValue;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
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
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  setPreviewRole(null);
}