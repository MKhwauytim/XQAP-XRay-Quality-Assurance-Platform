// Hamilton's method (largest remainder / Hare quota) for quota apportionment.
// Given a set of groups with sizes and a total number of seats to distribute,
// returns the seat count per group.

export type ApportionmentInput = {
  key: string;
  size: number;
}[];

export type ApportionmentResult = {
  key: string;
  exact: number;
  floor: number;
  remainder: number;
  allocated: number;
}[];

export function hamiltonApportionment(
  groups: ApportionmentInput,
  totalSeats: number
): ApportionmentResult {
  if (totalSeats <= 0 || groups.length === 0) {
    return groups.map((g) => ({
      key: g.key,
      exact: 0,
      floor: 0,
      remainder: 0,
      allocated: 0
    }));
  }

  const total = groups.reduce((s, g) => s + g.size, 0);
  if (total === 0) {
    return groups.map((g) => ({
      key: g.key,
      exact: 0,
      floor: 0,
      remainder: 0,
      allocated: 0
    }));
  }

  const initial: ApportionmentResult = groups.map((g) => {
    const exact = (g.size / total) * totalSeats;
    const floor = Math.floor(exact);
    return { key: g.key, exact, floor, remainder: exact - floor, allocated: floor };
  });

  const remaining = totalSeats - initial.reduce((s, r) => s + r.floor, 0);

  // Sort by remainder descending, breaking ties by key (stable)
  const sorted = initial.slice().sort((a, b) =>
    b.remainder !== a.remainder
      ? b.remainder - a.remainder
      : a.key.localeCompare(b.key)
  );

  // Build a set of keys that get an extra seat
  const bonus = new Set<string>();
  for (let i = 0; i < remaining && i < sorted.length; i++) {
    bonus.add(sorted[i]!.key);
  }

  return initial.map((r) => ({
    ...r,
    allocated: r.floor + (bonus.has(r.key) ? 1 : 0)
  }));
}
