/* @vitest-environment jsdom */

/**
 * Who the error log says hit an error, across the two ways a user arrives.
 *
 * jsdom, not the default node environment: the whole point of these tests is
 * the RESTORE path, which reads the persisted session out of `localStorage` —
 * a store that does not exist under node, where `readRealSession` would find
 * nothing to restore and the tests would pass vacuously.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  __dropRuntimeSessionForTests,
  clearSession,
  readRealSession,
  setPreviewRole,
  writeSession,
} from "./authSession";
import { clearErrorActor, readErrorContext } from "../data/storage/errorContext";
describe("authSession — the error log's actor survives a session RESTORE", () => {
  // `setErrorActor` used to be called only from `writeSession`, i.e. only on an
  // explicit login. Since the session is persisted, a restore is the normal way
  // a user arrives — so every error logged during a restored session carried
  // `role: null`. The 2026-08-25 XQ-IO-032 export shows it cleanly: the one
  // user who logged in fresh has a role on all 22 of their rows; the two on
  // restored sessions have none on any of their 18.
  beforeEach(() => {
    clearSession();
    clearErrorActor();
  });

  it("attributes an error logged after a login", () => {
    writeSession({
      username: "jalgahamdi",
      role: "employee",
      loginAt: new Date().toISOString(),
    });
    expect(readErrorContext()).toMatchObject({ username: "jalgahamdi", role: "employee" });
  });

  it("attributes an error logged after a RESTORE, with no login this page load", () => {
    // Seed storage the way a previous page load left it, then drop the runtime
    // session the way a reload does.
    writeSession({
      username: "saalhijji",
      role: "supervisor",
      loginAt: new Date().toISOString(),
    });
    clearErrorActor();
    __dropRuntimeSessionForTests();

    expect(readErrorContext().role).toBeNull();
    expect(readRealSession()?.username).toBe("saalhijji");
    expect(readErrorContext()).toMatchObject({ username: "saalhijji", role: "supervisor" });
  });

  it("records the REAL role, never an admin's previewed one", () => {
    writeSession({ username: "admin", role: "admin", loginAt: new Date().toISOString() });
    clearErrorActor();
    __dropRuntimeSessionForTests();
    setPreviewRole("employee");

    readRealSession();
    // The preview changes what the UI shows, never who the log says you are.
    expect(readErrorContext().role).toBe("admin");
    setPreviewRole(null);
  });

  it("does not attribute an expired restored session to anyone", () => {
    const stale = new Date();
    stale.setDate(stale.getDate() - 30);
    writeSession({ username: "ghost", role: "employee", loginAt: stale.toISOString() });
    clearErrorActor();
    __dropRuntimeSessionForTests();

    expect(readRealSession()).toBeNull();
    expect(readErrorContext().role).toBeNull();
  });
});
