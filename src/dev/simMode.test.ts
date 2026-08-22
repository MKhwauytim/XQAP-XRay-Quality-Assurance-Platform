/* @vitest-environment jsdom */
import { describe, expect, it } from "vitest";

import { readSimModeConfig, SIM_WORKSPACE_HANDLE_NAME } from "./simMode";
import { SIM_ROLE_USERNAMES, SIM_WORKSPACE_NAME } from "./simWorkspace";

describe("simulated workspace URL contract", () => {
  it("names the handle the auto-login keys on", () => {
    expect(SIM_WORKSPACE_HANDLE_NAME).toBe(SIM_WORKSPACE_NAME);
  });

  function withSearch<T>(search: string, run: () => T): T {
    const original = window.location.search;
    // jsdom's location is not writable; replace the whole descriptor for the call.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, search },
    });
    try {
      return run();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: { ...window.location, search: original },
      });
    }
  }

  it("is off unless ?sim=1 (or sim=true) is present", () => {
    expect(withSearch("", readSimModeConfig)).toBeNull();
    expect(withSearch("?sim=0", readSimModeConfig)).toBeNull();
    expect(withSearch("?sim=yes", readSimModeConfig)).toBeNull();
    expect(withSearch("?role=admin", readSimModeConfig)).toBeNull();
    expect(withSearch("?sim=true", readSimModeConfig)).not.toBeNull();
  });

  it("defaults to the bootstrap admin", () => {
    expect(withSearch("?sim=1", readSimModeConfig)).toEqual({
      role: "admin",
      username: "admin",
    });
  });

  it("maps every role to its seeded account", () => {
    for (const role of ["guest", "employee", "supervisor", "manager", "admin"] as const) {
      expect(withSearch(`?sim=1&role=${role}`, readSimModeConfig)).toEqual({
        role,
        username: SIM_ROLE_USERNAMES[role],
      });
    }
  });

  it("falls back to admin for an unknown role", () => {
    expect(withSearch("?sim=1&role=wizard", readSimModeConfig)).toEqual({
      role: "admin",
      username: "admin",
    });
  });

  it("lets ?user= override the username while keeping the role", () => {
    expect(withSearch("?sim=1&role=employee&user=saalhijji", readSimModeConfig)).toEqual({
      role: "employee",
      username: "saalhijji",
    });
  });
});
