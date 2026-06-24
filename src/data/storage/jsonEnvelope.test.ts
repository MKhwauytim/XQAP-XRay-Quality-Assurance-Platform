import { describe, it, expect } from "vitest";
import { isEnvelope, unwrap, wrap } from "./jsonEnvelope";

describe("jsonEnvelope", () => {
  it("wrap produces an envelope with metadata", () => {
    const result = wrap({ name: "test" });
    expect(result.metadata.schemaVersion).toBe(1);
    expect(result.metadata.revision).toBe(1);
    expect(result.data).toEqual({ name: "test" });
  });

  it("isEnvelope returns true for wrapped objects", () => {
    expect(isEnvelope(wrap({ x: 1 }))).toBe(true);
  });

  it("isEnvelope returns false for bare objects", () => {
    expect(isEnvelope({ name: "test" })).toBe(false);
  });

  it("unwrap returns data from envelope", () => {
    const env = wrap({ val: 42 });
    expect(unwrap(env)).toEqual({ val: 42 });
  });

  it("unwrap returns value as-is when not an envelope (legacy)", () => {
    expect(unwrap({ val: 42 })).toEqual({ val: 42 });
  });

  it("increments revision from previous", () => {
    const first = wrap({ x: 1 }, 0);
    const second = wrap({ x: 2 }, first.metadata.revision);
    expect(second.metadata.revision).toBe(2);
  });
});
