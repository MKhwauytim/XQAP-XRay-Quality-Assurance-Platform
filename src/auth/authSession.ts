import { SESSION_KEY } from "./authConfig";
import type { AuthSession } from "./authTypes";

// Sessions persist across browser/tab restarts for this long, measured from loginAt.
// After expiry the user must sign in again. (Stored in localStorage, not sessionStorage.)
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

export function readSession(): AuthSession | null {
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

export function writeSession(session: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}