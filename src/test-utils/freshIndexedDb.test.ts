import { describe, expect, it } from "vitest";
import { installFreshIndexedDb } from "./freshIndexedDb";

describe("installFreshIndexedDb", () => {
  it("installs an IndexedDB factory on globalThis", () => {
    installFreshIndexedDb();
    expect(globalThis.indexedDB).toBeDefined();
  });

  it("gives each call a different factory object", () => {
    installFreshIndexedDb();
    const first = globalThis.indexedDB;
    installFreshIndexedDb();
    expect(globalThis.indexedDB).not.toBe(first);
  });
});
