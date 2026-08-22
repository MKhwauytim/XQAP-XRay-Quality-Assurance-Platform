import type { AuthRole, AuthSession } from "./authTypes";
import { clearSubTabSelections } from "../app/subTabSelection";
import {
  endAuthActivitySession,
  startAuthActivitySession,
} from "./authActivityLog";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_STORAGE_KEY = "xray_auth_session_v1";

// Admin-only role impersonation for testing other roles' views/permissions.
// Runtime-only and never persisted.
const VALID_ROLES: AuthRole[] = ["guest", "employee", "supervisor", "manager", "admin"];
let runtimeSession: AuthSession | null = null;
let runtimePreviewRole: AuthRole | null = null;

// SEC-02 (deliberately relaxed, 2026-08-07): the session is persisted to
// localStorage — not sessionStorage — so it survives a full browser restart, not
// just a page reload. This is a UX convenience, not a security control — with the
// client-only trust model a user can still forge this object (see SEC-01 /
// CLAUDE.md security note). The owner explicitly accepted the unattended-machine
// risk (a closed browser no longer logs the user out) in exchange for not having
// to re-login after every restart. The 7-day TTL guard (SESSION_TTL_MS, checked
// in isExpired) is unchanged and still bounds how long a persisted session is
// honored. See docs/architecture/SECURITY_MODEL.md for the recorded rationale.
function sessionStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStoredSession(): AuthSession | null {
  try {
    const store = sessionStore();
    if (!store) return null;
    const raw = store.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: AuthSession): void {
  try {
    sessionStore()?.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Runtime session still works even when browser storage is unavailable.
  }
}

function clearStoredSession(): void {
  try {
    sessionStore()?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

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
  if (!runtimeSession) {
    runtimeSession = readStoredSession();
    if (runtimeSession && !isExpired(runtimeSession)) {
      startAuthActivitySession(runtimeSession);
    }
  }

  if (!runtimeSession || !isValidSession(runtimeSession) || isExpired(runtimeSession)) {
    if (runtimeSession) endAuthActivitySession("expired");
    runtimeSession = null;
    clearStoredSession();
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
  // Demo sessions are runtime-only: never persisted, so a read-only demo
  // identity can't survive a reload and attach to a real workspace (LOG-01).
  if (session.mode === "demo") {
    clearStoredSession();
  } else {
    writeStoredSession(session);
  }
  startAuthActivitySession(session);
}

export function clearSession(): void {
  endAuthActivitySession("logout");
  runtimeSession = null;
  clearStoredSession();
  setPreviewRole(null);
  // Where the previous user had navigated is theirs, not the next user's. The
  // rail's recorded sub-tab selection outlives a logout otherwise (it is
  // module state, and logging out does not reload the page), and the next
  // session would mount its tabs on sub-tabs that user may not be permitted
  // to open. See src/app/subTabSelection.ts.
  clearSubTabSelections();
}
