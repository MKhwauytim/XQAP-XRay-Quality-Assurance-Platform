import { beforeEach, describe, expect, it } from "vitest";
import {
  DEAD_SEGMENT_MIN_AGE_MS, DEAD_SEGMENT_MIN_SCANS, clearDeadSegmentRegistry, confirmedDeadNames,
  isConfirmedDead, markDeadLoggedOnce, recordOpenableSegment, recordUnopenableSegment,
} from "./deadSegmentRegistry";

describe("deadSegmentRegistry", () => {
  beforeEach(() => clearDeadSegmentRegistry());

  it("one failed open is not dead", () => {
    recordUnopenableSegment("k", "a.ndjson", 0);
    expect(isConfirmedDead("k", "a.ndjson", 0)).toBe(false);
  });

  it("MIN_SCANS failures inside MIN_AGE are still not dead", () => {
    for (let i = 0; i < DEAD_SEGMENT_MIN_SCANS; i += 1) recordUnopenableSegment("k", "a.ndjson", i * 1000);
    expect(isConfirmedDead("k", "a.ndjson", DEAD_SEGMENT_MIN_SCANS * 1000)).toBe(false);
  });

  it("MIN_SCANS failures spanning >= MIN_AGE → dead; logged once", () => {
    recordUnopenableSegment("k", "a.ndjson", 0);
    recordUnopenableSegment("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS / 2);
    recordUnopenableSegment("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS);
    expect(isConfirmedDead("k", "a.ndjson", DEAD_SEGMENT_MIN_AGE_MS)).toBe(true);
    expect(confirmedDeadNames("k", DEAD_SEGMENT_MIN_AGE_MS)).toEqual(new Set(["a.ndjson"]));
    expect(markDeadLoggedOnce("k", "a.ndjson")).toBe(true);
    expect(markDeadLoggedOnce("k", "a.ndjson")).toBe(false);
  });

  it("a successful open resets; scopes independent; clear resets", () => {
    for (let i = 0; i < 3; i += 1) recordUnopenableSegment("k1", "a.ndjson", i * DEAD_SEGMENT_MIN_AGE_MS);
    expect(isConfirmedDead("k2", "a.ndjson", 10 * DEAD_SEGMENT_MIN_AGE_MS)).toBe(false);
    recordOpenableSegment("k1", "a.ndjson");
    expect(isConfirmedDead("k1", "a.ndjson", 10 * DEAD_SEGMENT_MIN_AGE_MS)).toBe(false);
    for (let i = 0; i < 3; i += 1) recordUnopenableSegment("k1", "b.ndjson", i * DEAD_SEGMENT_MIN_AGE_MS);
    clearDeadSegmentRegistry("k1");
    expect(isConfirmedDead("k1", "b.ndjson", 10 * DEAD_SEGMENT_MIN_AGE_MS)).toBe(false);
  });
});
