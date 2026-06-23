import { SESSION_KEY } from "./authConfig";
import type { AuthSession } from "./authTypes";

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
    const rawValue = sessionStorage.getItem(SESSION_KEY);

    if (!rawValue) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isValidSession(parsedValue)) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }

    return parsedValue;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function writeSession(session: AuthSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}