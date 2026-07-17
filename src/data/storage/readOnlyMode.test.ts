import { afterEach, describe, expect, it } from "vitest";
import {
  assertWritableMode,
  ReadOnlyModeError,
  setReadOnlyMode,
} from "./readOnlyMode";

describe("assertWritableMode", () => {
  afterEach(() => setReadOnlyMode(false));

  it("allows mutations in writable mode", () => {
    setReadOnlyMode(false);
    expect(() => assertWritableMode()).not.toThrow();
  });

  it("throws a typed error instead of silently succeeding in read-only mode", () => {
    setReadOnlyMode(true);
    expect(() => assertWritableMode()).toThrow(ReadOnlyModeError);

    try {
      assertWritableMode();
    } catch (error) {
      expect(error).toMatchObject({ code: "read_only" });
    }
  });
});
