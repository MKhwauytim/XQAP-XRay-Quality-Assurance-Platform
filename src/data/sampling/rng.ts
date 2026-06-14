// Mulberry32 PRNG — fast, seedable, uniform distribution on [0, 1)

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

// djb2-style hash: string → u32 seed
export function hashSeedString(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 33) ^ seed.charCodeAt(i)) >>> 0;
  }
  return h === 0 ? 1 : h;
}

// Fisher-Yates in-place shuffle using the provided RNG
export function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j]!;
    arr[j] = tmp!;
  }
}

// Draw `count` items from arr without replacement using seeded RNG
export function drawWithoutReplacement<T>(
  arr: readonly T[],
  count: number,
  rng: Rng
): T[] {
  const copy = arr.slice();
  shuffleInPlace(copy, rng);
  return copy.slice(0, Math.min(count, copy.length));
}
