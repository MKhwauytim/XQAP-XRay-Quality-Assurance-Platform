import { describe, it, expect } from "vitest";
import { snap, snapRect, resize, hitTest } from "./geometry";

describe("geometry", () => {
  it("snaps to nearest grid multiple", () => {
    expect(snap(11, 8)).toBe(8);
    expect(snap(13, 8)).toBe(16);
  });
  it("snaps a whole rect", () => {
    expect(snapRect({ x: 11, y: 13, w: 31, h: 5 }, 8)).toEqual({ x: 8, y: 16, w: 32, h: 8 });
  });
  it("resizes from the SE handle by growing w/h", () => {
    expect(resize({ x: 0, y: 0, w: 100, h: 100 }, "se", 20, 30)).toEqual({ x: 0, y: 0, w: 120, h: 130 });
  });
  it("resizes from the NW handle by moving origin and shrinking", () => {
    expect(resize({ x: 10, y: 10, w: 100, h: 100 }, "nw", 20, 20)).toEqual({ x: 30, y: 30, w: 80, h: 80 });
  });
  it("enforces a minimum size", () => {
    expect(resize({ x: 0, y: 0, w: 50, h: 50 }, "se", -100, -100, 10, 10)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });
  it("hit-tests a point inside the rect", () => {
    expect(hitTest({ x: 0, y: 0, w: 100, h: 100 }, 50, 50)).toBe(true);
    expect(hitTest({ x: 0, y: 0, w: 100, h: 100 }, 150, 50)).toBe(false);
  });
});
