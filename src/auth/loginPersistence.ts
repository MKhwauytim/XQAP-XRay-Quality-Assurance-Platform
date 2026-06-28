const LAST_USERNAME_KEY = "xray_last_login_username_v1";

export function readLastLoginUsername(): string {
  try {
    return localStorage.getItem(LAST_USERNAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeLastLoginUsername(username: string): void {
  try {
    const normalized = username.trim();
    if (normalized) {
      localStorage.setItem(LAST_USERNAME_KEY, normalized);
    } else {
      localStorage.removeItem(LAST_USERNAME_KEY);
    }
  } catch {
    // Ignore storage failures; login itself should still work.
  }
}

export function clearLastLoginUsername(): void {
  try {
    localStorage.removeItem(LAST_USERNAME_KEY);
  } catch {
    // Ignore storage failures.
  }
}
