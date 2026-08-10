import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";
import { STORAGE_REGISTRY } from "./storageRegistry";

// Any string literal passed to a web-storage method. Captures the key argument.
const STORAGE_CALL = /(?:localStorage|sessionStorage)\s*\.\s*(?:getItem|setItem|removeItem)\s*\(\s*"([^"]+)"/g;

function isRegistered(key: string): boolean {
  return STORAGE_REGISTRY.some((entry) =>
    entry.prefix ? key.startsWith(entry.id) : key === entry.id
  );
}

describe("storage key coverage", () => {
  it("has every literal storage key in src/ registered in STORAGE_REGISTRY", () => {
    const files = globSync("src/**/*.{ts,tsx}", { exclude: (p) => p.includes(".test.") });
    const unregistered: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(STORAGE_CALL)) {
        const key = match[1];
        if (!isRegistered(key)) unregistered.push(`${file}: "${key}"`);
      }
    }

    expect(unregistered).toEqual([]);
  });

  // Without this, the test above passes vacuously if the regex or the
  // registry lookup silently stops matching anything.
  it("actually detects an unregistered key", () => {
    const sample = 'localStorage.setItem("some_other_app_key", value);';
    const found = [...sample.matchAll(STORAGE_CALL)].map((m) => m[1]);
    expect(found).toEqual(["some_other_app_key"]);
    expect(isRegistered("some_other_app_key")).toBe(false);
    expect(isRegistered("xray_auth_session_v1")).toBe(true);
  });

  it("scans a non-empty set of source files", () => {
    const files = globSync("src/**/*.{ts,tsx}", { exclude: (p) => p.includes(".test.") });
    expect(files.length).toBeGreaterThan(100);
  });
});
