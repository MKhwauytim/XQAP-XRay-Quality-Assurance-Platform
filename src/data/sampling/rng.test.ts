import { expect, test } from "vitest";

import {
  createRng,
  drawWithoutReplacement,
  hashSeedString,
  shuffleInPlace
} from "./rng";

test("hashSeedString is deterministic", () => {
  expect(hashSeedString("hello")).toBe(hashSeedString("hello"));
  expect(hashSeedString("hello")).not.toBe(hashSeedString("world"));
});

test("hashSeedString returns non-zero", () => {
  expect(hashSeedString("")).toBeGreaterThan(0);
  expect(hashSeedString("abc")).toBeGreaterThan(0);
});

test("createRng produces values in [0, 1)", () => {
  const rng = createRng(42);
  for (let i = 0; i < 1000; i++) {
    const v = rng();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  }
});

test("createRng is deterministic for same seed", () => {
  const rng1 = createRng(12345);
  const rng2 = createRng(12345);
  for (let i = 0; i < 100; i++) {
    expect(rng1()).toBe(rng2());
  }
});

test("createRng differs for different seeds", () => {
  const rng1 = createRng(1);
  const rng2 = createRng(2);
  const vals1 = Array.from({ length: 10 }, () => rng1());
  const vals2 = Array.from({ length: 10 }, () => rng2());
  expect(vals1).not.toEqual(vals2);
});

test("shuffleInPlace permutes all elements", () => {
  const arr = [1, 2, 3, 4, 5];
  const rng = createRng(99);
  shuffleInPlace(arr, rng);
  expect(arr.sort()).toEqual([1, 2, 3, 4, 5]);
});

test("shuffleInPlace is deterministic for same seed", () => {
  const arr1 = [1, 2, 3, 4, 5, 6, 7, 8];
  const arr2 = [...arr1];
  shuffleInPlace(arr1, createRng(777));
  shuffleInPlace(arr2, createRng(777));
  expect(arr1).toEqual(arr2);
});

test("drawWithoutReplacement returns correct count", () => {
  const arr = [1, 2, 3, 4, 5];
  const rng = createRng(1);
  const drawn = drawWithoutReplacement(arr, 3, rng);
  expect(drawn).toHaveLength(3);
});

test("drawWithoutReplacement never repeats elements", () => {
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const rng = createRng(42);
  const drawn = drawWithoutReplacement(arr, 10, rng);
  const unique = new Set(drawn);
  expect(unique.size).toBe(10);
});

test("drawWithoutReplacement clamps to available length", () => {
  const arr = [1, 2];
  const rng = createRng(1);
  const drawn = drawWithoutReplacement(arr, 100, rng);
  expect(drawn).toHaveLength(2);
});
