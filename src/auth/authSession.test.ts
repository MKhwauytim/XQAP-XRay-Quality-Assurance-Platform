import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  readSession,
  readRealSession,
  writeSession,
  clearSession,
  setPreviewRole,
  readPreviewRole,
  __dropRuntimeSessionForTests,
} from "./authSession";
import {
  endAuthActivitySession,
  readAuthActivityLog,
  resetAuthActivityLogForTests,
} from "./authActivityLog";
import type { AuthSession } from "./authTypes";

describe("authSession", () => {
  beforeEach(() => {
    clearSession();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null initially when no session exists", () => {
    expect(readSession()).toBeNull();
    expect(readRealSession()).toBeNull();
  });

  it("reads and writes a valid session", () => {
    const session: AuthSession = {
      username: "john_doe",
      role: "employee",
      loginAt: new Date().toISOString(),
    };

    writeSession(session);
    expect(readRealSession()).toEqual(session);
    expect(readSession()).toEqual(session);
  });

  it("identifies and discards expired sessions based on TTL", () => {
    const now = new Date();
    const session: AuthSession = {
      username: "john_doe",
      role: "employee",
      loginAt: now.toISOString(),
    };

    writeSession(session);

    // Session is valid initially
    expect(readSession()).toEqual(session);

    // Fast forward time by 7 days + 1 second (SESSION_TTL_MS = 7 days)
    vi.advanceTimersByTime(7 * 24 * 60 * 60 * 1000 + 1000);

    expect(readSession()).toBeNull();
    expect(readRealSession()).toBeNull();
  });

  it("ignores preview role if user is not an admin", () => {
    const session: AuthSession = {
      username: "employee_user",
      role: "employee",
      loginAt: new Date().toISOString(),
    };

    writeSession(session);
    setPreviewRole("supervisor");

    // Effective session role should still be employee because the real user is not admin
    expect(readSession()?.role).toBe("employee");
    expect(readRealSession()?.role).toBe("employee");
  });

  describe("demo sessions (LOG-01)", () => {
    // authSession runs in a node test env where localStorage is undefined;
    // stub a minimal Storage so persistence behavior is observable.
    const backing = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    };

    beforeEach(() => {
      backing.clear();
      vi.stubGlobal("localStorage", fakeStorage);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("is readable through the module but never persisted", () => {
      const demo: AuthSession = {
        username: "viewer",
        role: "admin",
        loginAt: new Date().toISOString(),
        mode: "demo",
      };

      writeSession(demo);

      // Permission consumers (usePermissions → readSession) must see it…
      expect(readSession()).toEqual(demo);
      expect(readRealSession()).toEqual(demo);
      // …but nothing may reach localStorage.
      expect(backing.size).toBe(0);
    });

    it("persists normal sessions and clears them when a demo session replaces one", () => {
      const real: AuthSession = {
        username: "john_doe",
        role: "employee",
        loginAt: new Date().toISOString(),
      };
      writeSession(real);
      expect(backing.size).toBe(1);

      const demo: AuthSession = {
        username: "viewer",
        role: "admin",
        loginAt: new Date().toISOString(),
        mode: "demo",
      };
      writeSession(demo);
      expect(backing.size).toBe(0);
      expect(readSession()).toEqual(demo);
    });

    it("survives a simulated browser restart — module state reset but localStorage retained (B task 3)", async () => {
      const real: AuthSession = {
        username: "restart_user",
        role: "manager",
        loginAt: new Date().toISOString(),
      };
      writeSession(real);
      expect(backing.size).toBe(1);

      // Simulate a full browser restart: re-import the module fresh (its
      // module-level runtimeSession variable is gone, exactly like a new page
      // load) while `localStorage` — unlike sessionStorage — keeps its contents
      // across the restart. writeSession's switch from sessionStorage to
      // localStorage (SEC-02 relaxation) is what makes this pass.
      vi.resetModules();
      const fresh = await import("./authSession");
      expect(fresh.readRealSession()).toEqual(real);
    });
  });

  it("applies preview role override for admins", () => {
    const session: AuthSession = {
      username: "admin_user",
      role: "admin",
      loginAt: new Date().toISOString(),
    };

    writeSession(session);

    // Check pre-condition
    expect(readSession()?.role).toBe("admin");

    // Set preview role to supervisor
    setPreviewRole("supervisor");
    expect(readPreviewRole()).toBe("supervisor");

    // readSession returns overridden role, readRealSession returns actual identity
    expect(readSession()?.role).toBe("supervisor");
    expect(readRealSession()?.role).toBe("admin");

    // Resetting preview role
    setPreviewRole(null);
    expect(readSession()?.role).toBe("admin");
  });

  describe("session restore stamps activity from the reconnect moment (not the stale loginAt)", () => {
    const backing = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => void backing.set(key, value),
      removeItem: (key: string) => void backing.delete(key),
    };

    beforeEach(() => {
      backing.clear();
      vi.stubGlobal("localStorage", fakeStorage);
      resetAuthActivityLogForTests();
    });

    afterEach(() => {
      endAuthActivitySession("logout");
      resetAuthActivityLogForTests();
      vi.unstubAllGlobals();
    });

    it("a session restored a day later gets a fresh signedInAt, not the original login time", async () => {
      const loginAt = new Date("2026-06-01T08:00:00.000Z");
      vi.setSystemTime(loginAt);
      const session: AuthSession = {
        username: "reconnect_user",
        role: "employee",
        loginAt: loginAt.toISOString(),
      };
      writeSession(session);

      // Simulate closing the browser (module state gone, localStorage kept)
      // and reopening the next day.
      const reconnectAt = new Date("2026-06-02T09:00:00.000Z");
      vi.setSystemTime(reconnectAt);
      __dropRuntimeSessionForTests();
      readRealSession();

      const entries = await readAuthActivityLog();
      const restored = entries.find((e) => e.signedOutAt === null);
      expect(restored).toBeDefined();
      expect(restored?.signedInAt).toBe(reconnectAt.toISOString());
      // Before the fix this was ~25 hours (reconnectAt minus the ORIGINAL loginAt).
      expect(restored?.durationMs).toBeLessThan(60 * 1000);
    });
  });
});
